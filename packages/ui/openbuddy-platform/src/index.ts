/**
 * @openbuddy/platform — 渲染层平台能力契约面（阶段2a 骨架）。
 * 本包 28 个模块已实测零 node: / 零 electron 导入，可安全被 renderer 消费。
 * 接线由单一生成源维护：package.json#exports → sync-ui-aliases.mjs →
 * 根 tsconfig.json paths + alias-list.json（再驱动 vite alias）。
 * 依赖方向：packages/ui/* → 本包 → shared/runtime 库包；不得导入 `@/`。
 */
export const PLATFORM_PACKAGE = "@openbuddy/platform" as const;
