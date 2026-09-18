/**
 * node-setup.ts — Vitest setup that has to run before anything else, from
 * outside the renderer source tree.
 *
 * Why it lives in `test/` and not `src/`
 * --------------------------------------
 * `src/lib/__tests__/ipc-contract.test.ts` asserts that every non-test file
 * under `src/**` is free of Node / Electron / pi-SDK imports, because that whole
 * tree is bundled into the renderer. This sandbox legitimately needs
 * `node:fs` / `node:os`, so putting it in `src/test-setup.ts` meant either
 * violating the boundary or weakening the assertion. Keeping it here preserves
 * both: the boundary stays enforced, and the sandbox still executes before the
 * first pi module is imported (`vitest.config.ts` loads this file first).
 *
 * Loaded before `src/test-setup.ts` — see the `setupFiles` order there.
 */

// ── 测试期 agent 根沙箱(必须在任何 pi 模块被 import 之前执行)─────────────
//
// 为什么必须做
// ------------
// `@earendil-works/pi-coding-agent` 的 `getAgentDir()` **只读**
// `process.env.PI_CODING_AGENT_DIR`,不认任何参数。没设时它回落到
// `~/.pi/agent` —— 那是 pi 自己的目录,不是 OpenBuddy 的。
//
// 于是 `SessionManager.create(cwd)`(不传 sessionDir 的那种写法)会把 JSONL
// 写进**开发者真实的 `~/.pi/agent/sessions/`**。实测本机:
//
//     ls ~/.pi/agent/sessions/ | wc -l   →  1884
//     du -sh ~/.pi/agent/sessions        →  59M
//
// 其中 1812 个是 `--var-folders-.../T-ob-session-tree-XXXX--` 这类临时 cwd
// 留下的空壳目录 —— 全部来自 `session-tree.test.ts` 的
// `SessionManager.create(dir)`。每跑一次测试就多 7 个,永不回收。
//
// 这不只是"脏":测试写到与生产同名的目录里,会让"会话从哪来"这类排查带上
// 噪音,而且任何按 `~/.pi/agent` 判断"全新安装"的逻辑在开发机上永远为假。
//
// 策略
// ----
//   - 只补默认值:`PI_CODING_AGENT_DIR` 已由调用方(CI / 单个测试文件)显式
//     设置时完全不动 —— 那是刻意的覆盖。
//   - 沙箱按 pid 隔离,退出时删除。
//   - `OPENBUDDY_TEST_REAL_AGENT_DIR=1` 可以关掉沙箱。用于"确实要读开发者
//     真实配置"的极少数场景;默认永远不开,以免哪天又悄悄污染。
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sandboxRoot = join(tmpdir(), "openbuddy-vitest-agent", String(process.pid));

if (process.env.PI_CODING_AGENT_DIR === undefined && process.env.OPENBUDDY_TEST_REAL_AGENT_DIR !== "1") {
  mkdirSync(sandboxRoot, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = sandboxRoot;
  // Pin the canonical flat user-agents dir too — otherwise
  // `userAgentsHome()` would resolve to `dirname(sandboxRoot)/agents`,
  // i.e. the shared sandbox parent. That breaks hermeticity across pids
  // when multiple vitest workers run in parallel.
  const userAgentsRoot = join(sandboxRoot, "user-agents");
  mkdirSync(userAgentsRoot, { recursive: true });
  process.env.OPENBUDDY_USER_AGENTS_DIR = userAgentsRoot;

  // 进程退出时回收。`exit` 里不能做异步,`rmSync` 足够(目录很小)。
  process.once("exit", () => {
    try {
      rmSync(sandboxRoot, { recursive: true, force: true });
    } catch {
      /* 沙箱清理是尽力而为,绝不能因此让测试进程以非零码退出 */
    }
  });
}
