/**
 * re-export 兼容层（阶段2b）。实现已迁至 `@openbuddy/ui-state/session-store`。
 * 保留本路径转发，使 `src/` 内部既有的 `@/stores/session-store` 引用与行为不变。
 */
export * from "@openbuddy/ui-state/session-store";
