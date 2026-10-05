/* Copyright Elysia © 2025 */

import { spawn } from "child_process";
import path from "path";
import process from "process";
import { existsSync, renameSync, rmSync, readFileSync, writeFileSync } from "fs";

function runCommand(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd: opts.cwd ?? process.cwd(),
            stdio: "inherit",
            shell: false,
        });

        child.on("error", err => reject(err));
        child.on("close", (code, signal) => {
            if (signal) {
                return reject(new Error(`Command terminated by signal ${signal}`));
            }
            if (code !== 0) {
                return reject(new Error(`Command exited with code ${code}`));
            }
            resolve();
        });
    });
}

async function buildEquicord() {
    const root = process.cwd();
    const equicordDir = path.join(root, "Equicord");

    console.log("➡️  Building Equicord (web) ...");
    await runCommand(
        process.execPath,
        ["--require", "./scripts/suppressExperimentalWarnings.js", "scripts/build/buildWeb.mjs"],
        {
            cwd: equicordDir,
        },
    );
    console.log("✅ Equicord build finished.");
}

function copyAndPatch() {
    const root = process.cwd();
    const finalFolder = path.resolve(root, "EquicordExtension");

    if (existsSync(finalFolder)) {
        rmSync(finalFolder, { recursive: true });
        console.info("Removed the old Equicord Extension folder:", finalFolder);
    }

    const vencordBuildPath = path.resolve(root, "Equicord", "dist", "browser", "chromium-unpacked");
    renameSync(vencordBuildPath, finalFolder);

    rmSync(path.resolve(root, "Equicord", "dist"), { recursive: true });
    console.info("Moved the newly built Equicord Extension folder to", finalFolder);

    // patch Equicord.js
    const equicordPath = path.resolve(finalFolder, "dist", "Equicord.js");
    const equicordContent = readFileSync(equicordPath, "utf-8");

    const patchedEquicord = equicordContent.replace(
        "getInfoRows(){",
        "getInfoRows(){let rows = this.getInfoRowsDefault();rows.unshift(`${window.BotClientNative.getBotClientName()} ${window.BotClientNative.getBotClientVersion()}`);return rows},getInfoRowsDefault(){",
    );

    if (patchedEquicord === equicordContent) {
        console.info("Equicord.js is already patched / Cannot patch Equicord.js");
        console.info("Please check if the file is already patched or if the patch is correct.");
        process.exit(0);
    }

    writeFileSync(equicordPath, patchedEquicord);
    console.info("Patched Equicord.js successfully");
}

async function main() {
    try {
        await buildEquicord();
        copyAndPatch();
        console.log("🎉 All done.");
    } catch (err) {
        console.error("❌ Build failed:", err);
        process.exitCode = 1;
    }
}

main();
