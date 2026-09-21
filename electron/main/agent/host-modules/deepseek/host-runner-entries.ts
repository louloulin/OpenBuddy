/**
 * host-modules/deepseek/host-runner-entries.ts — core DeepSeek host-runner entries.
 *
 * Phase 8.3 Batch K: 从 agent-host.ts:2378-2430 抽出 (~53 行, 40 个 entry)。
 *
 *   - baseHostRunnerEntries: 返回 OpenBuddy 默认装配的 `@deepseek-ai/dsh-*`
 *     入口列表 (本地 id + 上游 npm name, 部分带 config/inject)。
 *   - composeHostRunnerEntries: 与 baseProfile / profileBundle 合并 + 规范化,
 *     产出可直接交给 `HarnessPluginLoader.loadProfile` 的 entries。
 *
 * 设计:
 *   - 数据与逻辑完全隔离: 这一模块只表达 "默认需要 mount 哪些 DSH 包",
 *     不依赖 `state`, 无 circular import。
 *   - `normalizeDeepSeekRuntimeEntry` 来自 sibling ./normalize-entry (Phase 8.3
 *     Architectural Refactor 抽出, 零反向依赖, 无 module-level mutable)。
 *   - `PluginEntryOptions` 类型从 @openbuddy/plugin-host 拿,保持与
 *     `HarnessPluginLoader.loadProfile` 签名一致。
 *
 * 维护说明:
 *   - 新增 DSH 默认入口时, 只需在 `BASE_HOST_RUNNER_ENTRIES` 数组中追加;
 *     排列顺序就是 harness loadProfile 的解析顺序 (前 → 后)。
 *   - 任何带 `config` 的入口必须在 PR 描述里说明上游 schema 来源。
 *   - Pi-取代的入口 (例如 `openbuddy-dsh-tool-bash`) 保持原样,
 *     让 DSH UI 仍能通过 adapter 名字找到 Pi 实现。
 */

import type { PluginEntryOptions } from "@openbuddy/plugin-host";
import { normalizeDeepSeekRuntimeEntry } from "./normalize-entry";

/**
 * OpenBuddy 默认装配的 `@deepseek-ai/dsh-*` 入口。
 *
 * 顺序敏感: 先注册的包提供后注册包所依赖的 Cordis service。
 * 任何新增项必须放在其依赖项之后;否则 `loadProfile` 会因
 * missing service 而 abort。
 *
 * LUM-1320 — 默认装配只包含**在本仓库里真能解析到实现**的 DSH 包。
 * 历史原因: 这里曾列出 43 个上游 `@deepseek-ai/dsh-*` 包,但仓库既没有声明
 * 这些依赖,也没有随包发布闭包,Phase L.4 又把 DSH 装配删掉了——结果是每次
 * `loadProfile` 都有 36 个条目以 `ERR_MODULE_NOT_FOUND` 失败(dev 与安装包
 * 都一样,一次 profile 加载 = 36 条 `plugin/failed`,UI 侧插件列表全红)。
 *
 * 所以现在分成两张表:
 *   - `BASE_HOST_RUNNER_ENTRIES` —— 真的能解析的 7 个入口(由
 *     `electron/main/deepseek/deepseek-runtime.ts` 的 `deepSeekRuntimeAliases`
 *     提供本地 shim),默认参与装配。
 *   - `UNSHIPPED_DSH_HOST_RUNNER_ENTRIES` —— 另外 36 个上游包名。本仓库没有
 *     它们的依赖,装了也解析不到,因此**不进入默认 profile**;保留在这里作为
 *     PI-native 迁移对照表,用户/市场 profile 仍可按包名声明加载(如果将来把
 *     这些闭包 pin 成依赖,把对应行搬回上面的表即可)。
 *
 * 注: `openbuddy-dsh-tool-*` 系列曾计划由 Pi 适配器覆盖 (见
 * `pi-extensions.ts` 的 compatibility adapter 注册);但 DSH 包名解析失败时
 * harness 根本拿不到 tool descriptor,Pi 侧的工具走的是 Pi 自己的注册路径。
 */
const BASE_HOST_RUNNER_ENTRIES: ReadonlyArray<PluginEntryOptions> = [
  { id: "openbuddy-dsh-session", name: "@deepseek-ai/dsh-session" },
  { id: "openbuddy-dsh-workspace", name: "@deepseek-ai/dsh-workspace" },
  { id: "openbuddy-dsh-typert", name: "@deepseek-ai/dsh-typert-registry" },
  { id: "openbuddy-dsh-client-connection", name: "@deepseek-ai/dsh-client-connection" },
  { id: "openbuddy-dsh-agent", name: "@deepseek-ai/dsh-agent" },
  { id: "openbuddy-dsh-session-persistence", name: "@deepseek-ai/dsh-session-persistence-jsonl" },
  { id: "openbuddy-dsh-session-query", name: "@deepseek-ai/dsh-session-query" },
] as const;

/**
 * 上游 DSH 包名清单 —— 本仓库没有依赖/闭包,解析不到实现,所以不参与默认装配。
 *
 * 保留完整的 id / name / config / inject 形状:
 *   - 迁移对照表 (docs/OPENBUDDY_PI_NATIVE_PLAN.md 的 DSH 残余清单);
 *   - 用户或市场 bundle 按包名重新声明时,可直接复用这里的 config 形状;
 *   - 将来若把 DSH 闭包 pin 成依赖,把对应行搬回 `BASE_HOST_RUNNER_ENTRIES`。
 */
export const UNSHIPPED_DSH_HOST_RUNNER_ENTRIES: ReadonlyArray<PluginEntryOptions> = [
  { id: "openbuddy-dsh-llm", name: "@deepseek-ai/dsh-llm" },
  { id: "openbuddy-dsh-settings", name: "@deepseek-ai/dsh-settings-file" },
  { id: "openbuddy-dsh-credentials", name: "@deepseek-ai/dsh-credentials-local" },
  { id: "openbuddy-dsh-typert-loader", name: "@deepseek-ai/dsh-typert-loader" },
  { id: "openbuddy-dsh-api-gateway", name: "@deepseek-ai/dsh-api-gateway" },
  { id: "openbuddy-dsh-agent-loop", name: "@deepseek-ai/dsh-agent-loop" },
  { id: "openbuddy-dsh-agent-instructions", name: "@deepseek-ai/dsh-agent-instructions", config: { maxBytes: 128 * 1024, maxSourceBytes: 1024 * 1024 } },
  { id: "openbuddy-dsh-agent-presets", name: "@deepseek-ai/dsh-agent-presets" },
  { id: "openbuddy-dsh-agent-default-model", name: "@deepseek-ai/dsh-agent-default-model", config: { provider: "pi", model: "" } },
  { id: "openbuddy-dsh-plan-mode", name: "@deepseek-ai/dsh-plan-mode", config: { section: "Use plan mode for complex multi-step work; present a complete plan before execution." } },
  { id: "openbuddy-dsh-commands", name: "@deepseek-ai/dsh-commands" },
  { id: "openbuddy-dsh-goal", name: "@deepseek-ai/dsh-goal" },
  { id: "openbuddy-dsh-file-reference", name: "@deepseek-ai/dsh-file-reference" },
  { id: "openbuddy-dsh-plugin-inventory", name: "@deepseek-ai/dsh-host-plugin-inventory" },
  { id: "openbuddy-dsh-message-feedback", name: "@deepseek-ai/dsh-message-feedback" },
  { id: "openbuddy-dsh-session-reference", name: "@deepseek-ai/dsh-session-reference" },
  { id: "openbuddy-dsh-cordis-host-runner", name: "@deepseek-ai/dsh-cordis-host-runner" },
  { id: "openbuddy-dsh-user-questions", name: "@deepseek-ai/dsh-user-questions" },
  { id: "openbuddy-dsh-user-approval", name: "@deepseek-ai/dsh-user-approval" },
  { id: "openbuddy-dsh-tool-bash", name: "@deepseek-ai/dsh-tool-bash" },
  { id: "openbuddy-dsh-tool-fs", name: "@deepseek-ai/dsh-tool-fs" },
  { id: "openbuddy-dsh-tool-fs-search", name: "@deepseek-ai/dsh-tool-fs-search" },
  { id: "openbuddy-dsh-tool-subagent", name: "@deepseek-ai/dsh-tool-subagent" },
  { id: "openbuddy-dsh-tool-jobs", name: "@deepseek-ai/dsh-tool-jobs", inject: [] as readonly string[] },
  { id: "openbuddy-dsh-terminal", name: "@deepseek-ai/dsh-terminal" },
  { id: "openbuddy-dsh-terminal-bash", name: "@deepseek-ai/dsh-terminal-bash" },
  { id: "openbuddy-dsh-tool-terminal", name: "@deepseek-ai/dsh-tool-terminal" },
  { id: "openbuddy-dsh-tool-todo", name: "@deepseek-ai/dsh-tool-todo", config: { allowParallelInProgress: false } },
  { id: "openbuddy-dsh-tool-session-query", name: "@deepseek-ai/dsh-tool-session-query" },
  { id: "openbuddy-dsh-tool-goal", name: "@deepseek-ai/dsh-tool-goal" },
  { id: "openbuddy-dsh-tool-web", name: "@deepseek-ai/dsh-tool-web", config: { search: true, fetch: true } },
  { id: "openbuddy-dsh-tool-editor", name: "@deepseek-ai/dsh-tool-str-replace-editor" },
  { id: "openbuddy-dsh-skill", name: "@deepseek-ai/dsh-skill" },
  { id: "openbuddy-dsh-tool-skill", name: "@deepseek-ai/dsh-tool-skill" },
  { id: "openbuddy-dsh-tool-workflow", name: "@deepseek-ai/dsh-tool-workflow", config: { maxTotalAgents: 32, maxResultChars: 50000 } },
  { id: "openbuddy-dsh-web", name: "@deepseek-ai/dsh-web" },
] as const;

/** Frozen view of the base entries — exposed for tests / introspection. */
export function baseHostRunnerEntries(): readonly PluginEntryOptions[] {
  return BASE_HOST_RUNNER_ENTRIES;
}

/** 未随包发布、因而不参与默认装配的 DSH 包名清单(迁移对照表)。 */
export function unshippedDshHostRunnerEntries(): readonly PluginEntryOptions[] {
  return UNSHIPPED_DSH_HOST_RUNNER_ENTRIES;
}

/**
 * Compose final entries array passed to `HarnessPluginLoader.loadProfile`.
 *
 * Order: baseProfile.entries (from `createOpenBuddyProfile`) → base host-runner
 * entries → core capability entries (Phase K.2 SDK-serialised) → profileBundle.entries
 * (marketplace + runtime overrides). The merged list is normalized via
 * `normalizeDeepSeekRuntimeEntry` so `disabled` flags and `config` shapes
 * become Cordis-compatible.
 *
 * LUM-1320: 默认装配的 host-runner 条目只剩真能解析到实现的 7 个(见
 * `BASE_HOST_RUNNER_ENTRIES`);无法解析的 36 个上游包名不再默认入 profile,
 * 否则每次加载都会产生 36 条 `plugin/failed` (`ERR_MODULE_NOT_FOUND`)。
 * 用户/市场 bundle 仍可在 `profileBundleEntries` 里按包名声明它们。
 */
export function composeHostRunnerEntries(
  baseProfileEntries: readonly PluginEntryOptions[] = [],
  profileBundleEntries: readonly PluginEntryOptions[] = [],
  coreCapabilityEntries: readonly PluginEntryOptions[] = [],
): PluginEntryOptions[] {
  return [
    ...baseProfileEntries,
    ...BASE_HOST_RUNNER_ENTRIES,
    ...coreCapabilityEntries,
    ...profileBundleEntries,
  ].map((entry) => normalizeDeepSeekRuntimeEntry(entry));
}
