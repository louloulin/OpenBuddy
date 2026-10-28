#!/usr/bin/env node
// scripts/postinstall.mjs — 安装后同步 moon 工作区，**永不**让 install 失败
//
// 为什么单独一个脚本：
//   原来的 postinstall 是 `moon sync projects || true`。理论上 `|| true`
//   就能吞掉非零退出，但 2026-10-26 的 CI 实测是
//
//     . postinstall: Error: Cannot find module '@moonrepo/core-linux-x64-gnu/package.json'
//     [ELIFECYCLE] Command failed with exit code 1
//
//   失败发生在 **shell 解析 `moon` 之前**——pnpm 的脚本跑器在解析
//   `node_modules/.bin/moon` 这个 shim 时就 require 失败了，`|| true`
//   根本没有机会生效。于是 `pnpm install` 退出码 1，
//   **CI 的每一个 job 都死在安装期**，一行代码都没跑过。
//
//   也就是说：moon 的原生二进制（@moonrepo/cli 的 optionalDependency
//   平台包）装不上 = 整个仓库装不上 = 门禁全线失效。
//
// 本脚本的契约：
//   1. moon 不可用 → 打印可操作的告警，exit 0。
//   2. moon sync 失败 → 打印告警，exit 0。
//   3. 任何情况下都不让 `pnpm install` 失败。
//
//   为什么可以放心的原因是：CI 的门禁(typecheck / test)已经不再依赖
//   moon 的原生二进制 —— 见 scripts/run-workspace-task.mjs（纯 Node
//   执行 moon.yml 里的 task）。moon 只用于 build / dev 这类本地任务。
//
// 用法：由 package.json 的 postinstall 钩子调用，不要手工跑。

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const moonShim = join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "moon.cmd" : "moon");

if (!existsSync(moonShim)) {
  console.warn(
    "[postinstall] 未找到 moon 可执行文件（node_modules/.bin/moon），跳过 `moon sync projects`。\n" +
      "  这不影响 `pnpm install` 成功；CI 的 typecheck / test 门禁走纯 Node 实现\n" +
      "  (scripts/run-workspace-task.mjs)，不依赖 moon 的原生二进制。\n" +
      "  本地需要 moon 时再单独执行 `pnpm moon:sync`。",
  );
  process.exit(0);
}

const child = spawn(moonShim, ["sync", "projects"], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("error", (err) => {
  console.warn(`[postinstall] 启动 moon 失败（${err.message}），跳过 moon sync。`);
  process.exit(0);
});

child.on("close", (code) => {
  if (code !== 0) {
    console.warn(
      `[postinstall] \`moon sync projects\` 退出码 ${code}，已忽略。\n` +
        "  moon 同步失败不影响安装结果；CI 门禁不依赖它（见 scripts/run-workspace-task.mjs）。",
    );
  }
  process.exit(0);
});
