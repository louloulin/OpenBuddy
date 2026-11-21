# @openbuddy/client

渲染层客户端：Electron 桥封装（ipc）与按命令封装的 API（agent-client）。

- `src/ipc.ts`：preload 桥的唯一入口。
- `src/api/<module>.ts`：按 §5.3 宿主模块拆开的命令包装；`src/api/events.ts` 是 `agent://…` / `app://…` 事件订阅；`src/api/deferred/*` 是主进程契约里没有的命令（附录 B，原样保留，未删除）。
- `src/agent-client.ts`：汇总导出，导出名与拆分前完全一致，`@openbuddy/client/agent-client` 的 import 和 `vi.mock` 路径不变。
- `src/transport.ts`：`Transport` 接口与 `ElectronTransport`（基于 ipc.ts）、`MemoryTransport`（测试用假宿主），契约测试见 `src/__tests__/transport.test.ts`。`api/*` 还没有切到 Transport。
- `src/types.ts`：还没进 protocol 的客户端类型（`QuestionRequest`、`UiDismissReason`）。

分层与依赖规则见 `docs/plan/20261115-md.md` §5.2，由 `tools/check-boundaries.mjs` 检查。R5 进行中，剩余事项见计划 R5。
