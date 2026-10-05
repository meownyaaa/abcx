/* Copyright Elysia © 2025 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// the patterns below are written against this exact plugin commit
export const pluginCommit = "31ba52dc92221cddf612e6f4ef276263661d974e";

// equicord's Toasts has no genId/Type/Position and a different show() shape
const toastsShim = `import { showToast as baseShowToast, Toasts as BaseToasts } from "@webpack/common";

const genId = () => Math.random().toString(36).slice(2);

// the pinned discord build has no createToast, but its raw show() still takes the old shape
export const showToast = (message: string, type: any = "message", options?: any) => {
    try {
        (BaseToasts.show as any)({ message, type, id: genId(), options });
    } catch {
        try {
            baseShowToast(message, type, options);
        } catch (e) {
            console.warn("[BotClient] toast failed:", message, e);
        }
    }
};

export const Toasts = {
    Type: { MESSAGE: "message", SUCCESS: "success", FAILURE: "failure" } as const,
    Position: { TOP: 0, BOTTOM: 1 } as const,
    genId,
    show: ({ message, type, options }: { message: string; id?: string; type?: any; options?: any; }) =>
        showToast(message, type, options),
};
`;

// the bot gateway sends flat guilds, but the client expects them nested under properties
const flatGuildFn = `
const GUILD_TOP_LEVEL = new Set([
    "id", "properties", "channels", "threads", "roles", "emojis", "stickers", "members", "presences", "voice_states",
    "stage_instances", "guild_scheduled_events", "joined_at", "member_count", "premium_subscription_count", "lazy",
    "large", "version", "data_mode", "unavailable", "partial_updates", "channel_updates", "unable_to_sync_deletes",
    "has_threads_subscription", "experiments", "application_command_counts", "embedded_activities", "geo_restricted",
]);

function nestGuildProperties(guild: any) {
    if (!guild || guild.properties != null || guild.unavailable || guild.name == null) return;
    const properties: any = { id: guild.id };
    for (const key of Object.keys(guild)) {
        if (GUILD_TOP_LEVEL.has(key)) continue;
        properties[key] = guild[key];
        delete guild[key];
    }
    guild.properties = properties;
    console.log("[BotClient] nested flat guild", guild.id);
}

function normalizeFlatGuilds(data: any, eventName: string) {
    if (eventName === "GUILD_CREATE") nestGuildProperties(data);
    else if (eventName === "READY") data?.guilds?.forEach(nestGuildProperties);
}
`;

const toastsImport = (rel: string) => `import { Toasts } from "${rel}/toasts";`;

// custom backends use their own token formats, so drop the discord-only token checks
const pluginPatches: [file: string, from: RegExp, to: string, skipIfPresent?: string][] = [
    ["utils/common.ts", /^export const RegExToken = .*$/m, "export const RegExToken = /\\S/;"],
    ["components/AuthBoxTokenLogin.tsx", /\n\s*maxLength=\{100\}/, ""],
    ["components/AuthBoxMultiTokenLogin.tsx", /\n\s*maxLength=\{100\}/, ""],
    ["index.tsx", /replace\(\/bot\/gi,/, "replace(/^bot /i,"],
    ["index.tsx", /\n    Toasts,\n/, "\n"],
    ["index.tsx", /\} from "@webpack\/common";/, `} from "@webpack/common";\n${toastsImport("./utils")}`, "./utils/toasts"],
    ["index.tsx", /\n    showToast,\n/, "\n"],
    ["index.tsx", /import \{ Toasts \} from "\.\/utils\/toasts";/, 'import { showToast, Toasts } from "./utils/toasts";'],
    ["utils/patches.ts", /(export function handleDispatchPatch\([\s\S]*?\)\s*\{\n)/, "$1    normalizeFlatGuilds(data, eventName);\n", "normalizeFlatGuilds(data, eventName);"],
    ["utils/patches.ts", /\s*$/, flatGuildFn, "function normalizeFlatGuilds("],
    ["utils/patches.ts", /(\n    guild\.properties = properties;\n)\}/, '$1    console.log("[BotClient] nested flat guild", guild.id);\n}', "nested flat guild"],
    ["utils/patches.ts", /RestAPI, Toasts, UserStore \}/, "RestAPI, UserStore }"],
    ["utils/patches.ts", /(import \{[^}]*\} from "@webpack\/common";)/, `$1\n${toastsImport(".")}`, "./toasts"],
    // drop the hardcoded elysia dm, its avatar doesn't exist on custom backends
    ["utils/patches.ts", /^        const defaultPrivateChannel = .*\n/m, ""],
    ["utils/patches.ts", /^        data\.private_channels = \[defaultPrivateChannel\];\n/m, "        data.private_channels ??= [];\n"],
    ["utils/patches.ts", /^        data\.users = \[\n\s*defaultPrivateChannel\.recipients\[0\],\n\s*\.\.\.\(data\.users \|\| \[\]\),\n\s*\];\n/m, "        data.users ??= [];\n"],
    // spacebar treats bots like users, so drop the bot-only blocks
    ["index.tsx", /\n        \/\/ Invite Module\n[\s\S]*?(?=\n    \},\n    chatBarButton:)/, ""],
    ["index.tsx", /\n                \/\/ Disable Events:\n[\s\S]*?remoteCommand[^\n]*\n[^\n]*\n                \},/, ""],
    ["index.tsx", /replace: "!\$1\.user\.bot\?"/, 'replace: "false?"'],
    ["utils/patches.ts", /\n    if \(UserStore\.getUser\(userId\)\?\.bot\) \{[\s\S]*?\n    \}(?=\n)/, ""],
    ["utils/patches.ts", /\n    \/\/ Overwrite videoStreamParameters to null\n    data\.videoStreamParameters = null;/, ""],
    // let friend requests etc. reach the backend
    ["index.tsx", /        \/\/ Patch Relationships modules[\s\S]*?\n        \}\n(?=        \/\/ Patch getCurrentUser)/, ""],
    ["utils/patches.ts", /^        data\.relationships = \[\];\n/m, ""],
];

export function patchPlugin(userPluginDir: string) {
    // always patch a pristine copy, so earlier runs can't stack or half-apply
    execSync(`git checkout -f ${pluginCommit} -- .`, { cwd: userPluginDir, stdio: "inherit" });
    fs.writeFileSync(path.join(userPluginDir, "utils", "toasts.ts"), toastsShim);
    for (const [file, from, to, skipIfPresent] of pluginPatches) {
        const target = path.join(userPluginDir, file);
        // windows checkouts use crlf, which the patterns below don't expect
        const raw = fs.readFileSync(target, "utf8");
        const src = raw.replace(/\r\n/g, "\n");
        if (skipIfPresent && src.includes(skipIfPresent)) {
            if (src !== raw) fs.writeFileSync(target, src);
            continue;
        }
        const out = src.replace(from, to);
        if (out !== raw) fs.writeFileSync(target, out);
        if (out === src && skipIfPresent) console.warn(`> Patch did not apply to ${file}: ${from}`);
    }
    const leftovers = ["cannot use Relationships Module", "cannot join guilds", "Cannot send messages to this bot", "data.relationships = [];", "defaultPrivateChannel"];
    const code = ["index.tsx", "utils/patches.ts"].map(f => fs.readFileSync(path.join(userPluginDir, f), "utf8")).join("\n");
    for (const text of leftovers) if (code.includes(text)) console.warn(`> Plugin block still present: ${text}`);
    if (!code.includes("normalizeFlatGuilds(data, eventName);") || !code.includes("nested flat guild")) console.warn("> Flat guild fix was not applied");
    console.log("> Patched VencordDBCPlugin for Equicord.");
}
