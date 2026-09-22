/**
 * re-export 兼容层（阶段2b）。实现已迁至 `@openbuddy/platform/files/extract-text`。
 * 保留本路径转发，使 `src/` 与 `electron/` 侧既有的 `@/lib/files/extract-text` 引用与行为不变。
 */
export * from "@openbuddy/platform/files/extract-text";
