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
const toastsShim = `import { showToast } from "@webpack/common";

export const Toasts = {
    Type: { MESSAGE: "message", SUCCESS: "success", FAILURE: "failure" } as const,
    Position: { TOP: 0, BOTTOM: 1 } as const,
    genId: () => Math.random().toString(36).slice(2),
    show: ({ message, type, options }: { message: string; id?: string; type?: any; options?: any; }) =>
        showToast(message, type, options),
};
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
    ["utils/patches.ts", /RestAPI, Toasts, UserStore \}/, "RestAPI, UserStore }"],
    ["utils/patches.ts", /(import \{[^}]*\} from "@webpack\/common";)/, `$1\n${toastsImport(".")}`, "./toasts"],
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
    }
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
