import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packagedExecutable = join(root, "release", "win-unpacked", "OpenBuddy.exe");

function run(command, arguments_, environment = process.env) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    env: environment,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(pnpmCommand, ["exec", "electron-vite", "build"]);
run(
  pnpmCommand,
  ["exec", "electron-builder", "--win", "--x64", "--publish", "never", "--config", "electron-builder.yml"],
  {
    ...process.env,
    ELECTRON_BUILDER_BINARIES_MIRROR:
      process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??
      "https://npmmirror.com/mirrors/electron-builder-binaries/",
  },
);

if (process.platform !== "win32" || !existsSync(packagedExecutable)) {
  throw new Error(`Packaged Windows executable was not found: ${packagedExecutable}`);
}

console.log(`[windows-runtime] validating packaged executable: ${packagedExecutable}`);
run(pnpmCommand, ["exec", "node", "scripts/windows-packaged-smoke.mjs"], {
  ...process.env,
  OPENBUDDY_ELECTRON_PATH: packagedExecutable,
});
