/* Copyright Elysia © 2025 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

import { patchPlugin } from "./patchPlugin";

const cloneDir = path.join(".", "Equicord");
const userPluginDir = path.join(cloneDir, "src", "userplugins", "botClient");

function runCommand(command: string, cwd?: string) {
    execSync(command, {
        stdio: "inherit",
        cwd,
    });
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

    patchPlugin(userPluginDir);

    // Install dependencies
    console.log("> Installing Equicord dependencies...");
    runCommand("npx pnpm install --frozen-lockfile", cloneDir);
    console.log("> Equicord dependencies installed.");
})();
