/**
 * re-export 兼容层（阶段2b）。
 *
 * 实现已迁至 `@openbuddy/platform/electron-api`。保留本路径转发，使 `src/`
 * 内部既有的 `@/lib/platform/electron-api` 引用与行为完全不变；`electron/` 侧
 * 引用同样经此转发。阶段2c 会把 `packages/ui/*` 侧引用直接改为契约包导入，
 * 但本 shim 仍保留供 `src/` 内部自用（阶段3 只封死 packages/ui 方向）。
 */
export * from "@openbuddy/platform/electron-api";
