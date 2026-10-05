/* Copyright Elysia © 2025 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const cloneDir = path.join(".", "Equicord");
const userPluginDir = path.join(cloneDir, "src", "userplugins", "botClient");

function runCommand(command: string, cwd?: string) {
    execSync(command, {
        stdio: "inherit",
        cwd,
    });
}

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

function patchPlugin() {
    fs.writeFileSync(path.join(userPluginDir, "utils", "toasts.ts"), toastsShim);
    for (const [file, from, to, skipIfPresent] of pluginPatches) {
        const target = path.join(userPluginDir, file);
        const src = fs.readFileSync(target, "utf8");
        if (skipIfPresent && src.includes(skipIfPresent)) continue;
        const out = src.replace(from, to);
        if (out !== src) fs.writeFileSync(target, out);
        else if (skipIfPresent) console.warn(`> Patch did not apply to ${file}: ${from}`);
    }
    const leftovers = ["cannot use Relationships Module", "cannot join guilds", "Cannot send messages to this bot", "data.relationships = [];", "defaultPrivateChannel"];
    const code = ["index.tsx", "utils/patches.ts"].map(f => fs.readFileSync(path.join(userPluginDir, f), "utf8")).join("\n");
    for (const text of leftovers) if (code.includes(text)) console.warn(`> Plugin block still present: ${text}`);
    if (!code.includes("normalizeFlatGuilds(data, eventName);")) console.warn("> Flat guild fix was not applied");
    console.log("> Patched VencordDBCPlugin for Equicord.");
}

(async () => {
    // clone or update equicord fork
    if (!fs.existsSync(cloneDir)) {
        console.log("> Cloning meownyaaa/Equicord-FermiEndpoint...");
        runCommand(`git clone --depth 1 https://github.com/meownyaaa/Equicord-FermiEndpoint.git ${cloneDir}`);
        console.log("> Equicord clone complete.");
    } else {
        console.log("> Equicord already exists, updating main branch...");
        try {
            runCommand("git fetch origin main", cloneDir);
            runCommand("git reset --hard origin/main", cloneDir);
            console.log("> Equicord updated to latest main.");
        } catch (err) {
            console.error("> Failed to update Equicord:", err);
        }
    }

    // Clone user plugin only if not exists
    if (!fs.existsSync(userPluginDir)) {
        console.log("> Cloning aiko-chan-ai/VencordDBCPlugin...");
        runCommand(`git clone --depth 1 https://github.com/aiko-chan-ai/VencordDBCPlugin.git ${userPluginDir}`);
        console.log("> VencordDBCPlugin clone complete.");
    } else {
        console.log("> VencordDBCPlugin already exists, skipping clone.");
    }

    patchPlugin();

    // Install dependencies
    console.log("> Installing Equicord dependencies...");
    runCommand("npx pnpm install --frozen-lockfile", cloneDir);
    console.log("> Equicord dependencies installed.");
})();
