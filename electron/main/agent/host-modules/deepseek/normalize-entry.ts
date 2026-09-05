/**
 * host-modules/deepseek/normalize-entry.ts — entry normalization (no agent-host dep).
 *
 * Phase 8.3 Architectural Refactor — 阶段 A5.
 *
 * 把 cordis-runtime.ts 里的 `normalizeDeepSeekRuntimeEntry` 抽到独立模块.
 *
 * 为什么独立:
 *   - 该函数被 host-runner-entries.ts 用来规范化 40 个 DSH 默认入口.
 *   - 原先 host-runner-entries.ts → cordis-runtime.ts → agent-host.ts 形成
 *     3 层间接反向依赖. 抽到独立模块后, host-runner-entries.ts 直接依赖
 *     本文件, 不再触及 cordis-runtime.ts (后者保留旧引用以便逐步迁移).
 *   - 函数只依赖 piHome() + node:path/join, 完全可以独立成模块.
 *
 * 设计:
 *   - 纯函数, 输入 entry → 输出 entry. 无 module-level mutable.
 *   - 与 cordis-runtime.ts 里的实现保持字节级一致 (move-only refactor),
 *     所有现有的 call site 行为不变.
 *   - 调用方仍可继续从 cordis-runtime.ts 引用同名函数 (向后兼容 wrapper
 *     留着, 等所有 call site 迁移完再删除).
 */

import { join } from "node:path";

import { piHome } from "../_host-paths";

/**
 * Apply runtime-derived defaults to a DeepSeek profile entry. Mirrors
 * the original implementation in cordis-runtime.ts:69 exactly.
 *
 * Default injection rules:
 *   - `@deepseek-ai/cordis-plugin-hmr`         → config.root = ["."]
 *   - `@deepseek-ai/dsh-session-persistence-jsonl` → config.root = <piHome>/sessions
 *   - `openbuddy-dsh-tool-fs-search`            → config.sampleOverCapGlobResults = false
 *   - `openbuddy-dsh-agent-default-model`       → config.provider/model = "pi"/"default"
 *   - `openbuddy-dsh-tool-subagent`             → config.provider/toolName/backgroundMode
 */
export function normalizeDeepSeekRuntimeEntry<
  T extends { id: string; name: string; config?: unknown },
>(entry: T): T {
  if (
    entry.name === "@deepseek-ai/cordis-plugin-hmr" &&
    (!entry.config || typeof entry.config !== "object" || !("root" in entry.config))
  ) {
    return { ...entry, config: { root: ["."] } };
  }
  if (
    entry.name === "@deepseek-ai/dsh-session-persistence-jsonl" &&
    (!entry.config || typeof entry.config !== "object" || !("root" in entry.config))
  ) {
    return { ...entry, config: { root: join(piHome(), "sessions") } };
  }
  if (
    (entry.id === "tool-fs-search" || entry.id === "openbuddy-dsh-tool-fs-search") &&
    (!entry.config || typeof entry.config !== "object" || !("sampleOverCapGlobResults" in entry.config))
  ) {
    return { ...entry, config: { sampleOverCapGlobResults: false } };
  }
  if (
    (entry.id === "agent-default-model" || entry.id === "openbuddy-dsh-agent-default-model") &&
    (!entry.config ||
      typeof entry.config !== "object" ||
      typeof (entry.config as { provider?: unknown }).provider !== "string" ||
      !(entry.config as { model?: unknown }).model ||
      typeof (entry.config as { model?: unknown }).model !== "string")
  ) {
    return { ...entry, config: { provider: "pi", model: "default" } };
  }
  if (
    (entry.id === "tool-subagent" || entry.id === "openbuddy-dsh-tool-subagent") &&
    (!entry.config ||
      typeof entry.config !== "object" ||
      typeof (entry.config as { provider?: unknown }).provider !== "string")
  ) {
    return {
      ...entry,
      config: { provider: "spawn", toolName: "subagent", backgroundMode: "continuable" },
    };
  }
  return entry;
}
