/**
 * @openbuddy/ui-state — 渲染层共享状态（stores）契约面（阶段2a 骨架）。
 * 接线由单一生成源维护：package.json#exports → sync-ui-aliases.mjs →
 * 根 tsconfig.json paths + alias-list.json（再驱动 vite alias）。
 * 依赖方向：packages/ui/* → 本包 → shared/runtime 库包；不得导入 `@/`。
 */
export const UI_STATE_PACKAGE = "@openbuddy/ui-state" as const;
