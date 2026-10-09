/**
 * @openbuddy/agent-rpc — 渲染层 ↔ 主进程的 agent RPC 契约面（阶段2a 骨架）。
 * 接线由单一生成源维护：package.json#exports → scripts/sync-ui-aliases.mjs →
 * 根 tsconfig.json paths + packages/ui/alias-list.json（再驱动 vite alias）。
 * 依赖方向：packages/ui/* → 本包 → shared/runtime 库包；不得导入 `@/`。
 */
export const AGENT_RPC_PACKAGE = "@openbuddy/agent-rpc" as const;
