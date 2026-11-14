# @openbuddy/kernel

端口接口与参数校验工具（`docs/plan/20261115-md.md` R2）。纯 TS，只允许依赖 `@openbuddy/protocol`；不依赖 electron、DOM、react。
`services`、`engine`、`host`、`apps/desktop` 可以依赖它；宿主（桌面，将来的 server）实现这些端口并注入。

- `ports/events.ts`：`Emit` / `EventSink`，引擎与服务向宿主发事件的函数（原在 `engine/src/permissions/permissions.ts`）。
- `ports/shell.ts`：`HostShell`，openPath / openExternal / showItemInFolder / 可选的 trash（原 `services/src/files/files.ts` 的 `DesktopShell`，旧名保留为别名）。
- `ports/secrets.ts`：`SafeStorage`，系统密钥加解密（原在 `services/src/settings/settings.ts`；仍沿用 Node 的 `Buffer` 类型）。
- `ports/clock.ts`、`ports/logger.ts`：`Clock`、`Logger`，§9 的小接口，暂未接线。
- `validate.ts`：`object` / `text` / `bool` / `unsupported`（原在 `services/src/settings/settings.ts`，旧位置继续 re-export）。

分层与依赖规则见 `docs/plan/20261115-md.md` §5.2，由 `tools/check-boundaries.mjs` 检查。
声明都是从旧位置原样搬来的，旧位置保留 re-export；新增的只有 `HostShell.trash?`、`EventSink` 别名和 `Clock` / `Logger`。
仓储（ConfigRepo 等、单写者队列、principal）会改变持久化行为，留到 R2 的后续步骤。
