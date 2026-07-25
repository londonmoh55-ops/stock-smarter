import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import waitOn from "wait-on";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainOut = path.join(root, "dist-electron", "main.cjs");

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: "inherit",
      shell: true,
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

function buildMain() {
  return run("npx", [
    "esbuild",
    "electron/main.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--outfile=dist-electron/main.cjs",
    "--external:electron",
    "--packages=external",
  ]);
}

function launchElectron() {
  return spawn("npx", ["electron", "dist-electron/main.cjs"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
}

async function main() {
  fs.mkdirSync(path.join(root, "dist-electron"), { recursive: true });
  await buildMain();

  const devUrl = (process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
  const host = devUrl.replace(/^https?:\/\//, "");

  process.env.NODE_ENV = "development";
  process.env.VITE_DEV_SERVER_URL = devUrl;

  console.log("[electron-dev] Waiting for Vite at", devUrl);
  await waitOn({
    resources: [`http-get://${host}`],
    timeout: 120000,
    validateStatus: (status) => status >= 200 && status < 500,
  });

  await new Promise((r) => setTimeout(r, 2000));

  let electron = launchElectron();
  console.log("[electron-dev] Launching Electron (dist-electron/main.cjs)");

  electron.on("exit", (code) => process.exit(code ?? 0));

  let rebuildTimer = null;
  fs.watch(path.join(root, "electron"), { recursive: true }, (_event, filename) => {
    if (!filename || !/\.(ts|mjs|js)$/.test(filename)) return;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(async () => {
      console.log("[electron-dev] Electron sources changed — rebuilding main process…");
      try {
        await buildMain();
        console.log("[electron-dev] Restarting Electron…");
        electron.kill();
        electron = launchElectron();
        electron.on("exit", (code) => process.exit(code ?? 0));
      } catch (err) {
        console.error("[electron-dev] Rebuild failed:", err);
      }
    }, 300);
  });
}

main().catch((err) => {
  console.error("[electron-dev]", err);
  process.exit(1);
});
