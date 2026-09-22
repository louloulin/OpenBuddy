/**
 * re-export 兼容层（阶段2b）。
 *
 * 实现已迁至 `@openbuddy/ui-state/projects-store`。保留本路径转发，使 `src/`
 * 内部既有的 `@/stores/projects-store` 引用与行为完全不变。阶段2c 会把
 * `packages/ui/*` 侧引用直接改为契约包导入，本 shim 仍保留供 `src/` 内部自用。
 */
export * from "@openbuddy/ui-state/projects-store";
