/**
 * re-export 兼容层（阶段2b）。实现已迁至 `@openbuddy/ui-state/subagent-store`。
 * 保留本路径转发，使 `src/` 与 `electron/` 侧既有的 `@/stores/subagent-store` 引用与行为不变。
 */
export * from "@openbuddy/ui-state/subagent-store";
