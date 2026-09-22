/**
 * re-export 兼容层（阶段2b）。实现已迁至 `@openbuddy/agent-rpc/session-artifacts`。
 * 保留本路径转发，使 `src/` 与 `electron/` 侧既有的 `@/lib/agent/session-artifacts` 引用与行为不变。
 */
export * from "@openbuddy/agent-rpc/session-artifacts";
