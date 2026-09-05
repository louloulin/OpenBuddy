import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";

const root = process.cwd();

function candidates() {
  const values = [
    process.env.OPENBUDDY_ELECTRON_EXEC_PATH,
    process.env.ELECTRON_EXEC_PATH,
    join(root, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
    join(root, "node_modules/electron/dist/electron"),
    "/Applications/Electron.app/Contents/MacOS/Electron",
  ];
  if (process.platform === "darwin") {
    try {
      const discoveredApps = execFileSync("mdfind", ["kMDItemCFBundleIdentifier == 'com.github.Electron' || kMDItemCFBundleIdentifier == 'com.electron.*'"], { encoding: "utf8" });
      values.push(...discoveredApps.split("\n").filter(Boolean).map((appPath) => join(appPath, "Contents/MacOS/Electron")));
    } catch {
      // Spotlight is optional; explicit paths and environment overrides still work.
    }
  }
  return values.filter((value) => typeof value === "string" && value.length > 0);
}

const electronPath = candidates().find((candidate) => existsSync(candidate));
if (!electronPath) {
  console.error("OpenBuddy 开发启动失败：未找到可用的 Electron runtime。");
  console.error("不会自动下载 Electron。请设置 OPENBUDDY_ELECTRON_EXEC_PATH 或 ELECTRON_EXEC_PATH 指向已有的 Electron 可执行文件。");
  process.exit(1);
}

const child = spawn(process.execPath, [join(root, "node_modules/electron-vite/bin/electron-vite.js"), "dev"], {
  cwd: root,
  env: { ...process.env, ELECTRON_EXEC_PATH: electronPath },
  stdio: "inherit",
});
child.once("error", (error) => {
  console.error(`OpenBuddy Electron 开发进程启动失败: ${error.message}`);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
