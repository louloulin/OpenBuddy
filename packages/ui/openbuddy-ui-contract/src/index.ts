/**
 * @openbuddy/ui-contract — 渲染层 UI 帮助层契约面（阶段2a 骨架）。
 * 非契约物（src/components/*、src/hooks/*、src/assets/*）按既定范围归入
 * @openbuddy/ui-primitives，不放入本包。
 * 接线由单一生成源维护：package.json#exports → sync-ui-aliases.mjs →
 * 根 tsconfig.json paths + alias-list.json（再驱动 vite alias）。
 * 依赖方向：packages/ui/* → 本包 → shared/runtime 库包；不得导入 `@/`。
 */
export const UI_CONTRACT_PACKAGE = "@openbuddy/ui-contract" as const;
