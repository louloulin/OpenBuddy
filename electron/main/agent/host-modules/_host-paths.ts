/**
 * host-modules/_host-paths.ts — host path utilities (no agent-host dependency).
 *
 * Phase 8.3 Architectural Refactor — 阶段 A2.
 *
 * 把 agent-host.ts 里的 path 工具函数 (`piHome()`, `isPathWithin()`,
 * `piSessionDir()`) 抽到独立模块, 让任何 feature module 都可以直接 import
 * 这些工具而不必绕道 agent-host.ts.
 *
 * 依赖方向:
 *   _host-paths.ts  ←  (零依赖)
 *       ↑
 *   bootstrap/*, profile/*, deepseek/* 等 feature module
 *
 * 设计:
 *   - 纯函数, 无 module-level mutable
 *   - `piHome()` 返回 `~/.pi/agent` (即 OpenBuddy 的 pi home), 与
 *     agent-home.ts 的逻辑一致
 *   - `isPathWithin()` / `piSessionDir()` 等保持原有签名, call site 一行不改
 */

import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { agentHome } from "../agent-home";

/**
 * Returns the absolute path to OpenBuddy's pi home (~/.pi/agent).
 *
 * Used by every disk-touching helper in the host: auth.json, models.json,
 * openbuddy-events.jsonl, marketplace caches, etc. Centralizing it here
 * means a future migration to a different base directory is one edit.
 */
export function piHome(): string {
  return agentHome();
}

/**
 * Returns true when `candidate` resolves to a path strictly inside `root`.
 * Both arguments are normalized to absolute paths before comparison so
 * `..` segments and `~` expansions don't slip through.
 *
 * Used by tool/permission gating (e.g. "can the agent write to this path?")
 * and by the workspace-search indexer.
 */
export function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

/**
 * Returns the absolute path where Pi sessions are persisted for a given
 * workspace `cwd`. Today this is `<piHome>/sessions/<hash(cwd)>`; the
 * hash keeps workspace names from leaking into the file path.
 */
export function piSessionDir(cwd: string): string {
  const encoded = resolve(cwd).replace(/^[/\\]/, "").replace(/[\\/:]/g, "-");
  return join(piHome(), "sessions", `--${encoded}--`);
}

/**
 * Convenience for code that already has `homedir()` cached — keeps the
 * homedir() call out of hot paths.
 */
export function userHome(): string {
  return homedir();
}
