# OpenBuddy Pi Passthrough Guide

OpenBuddy 已经在 `compatibilityAdapters` 上加了 `passthrough` 开关 —— 用户
显式配置后,高下载量的 pi.dev 包可以原样运行,不再被静默改写到 OpenBuddy 自有
服务。本文档说明如何配置和验证。

## 启用 passthrough

在 `~/.pi/agent/profile.json` 的 `piExtensions` 数组里给目标 spec 加
`passthrough: true`:

```json
{
  "piExtensions": [
    { "id": "pi-mcp-adapter", "source": "pi-mcp-adapter", "passthrough": true },
    { "id": "pi-web-access", "source": "pi-web-access", "passthrough": true },
    { "id": "pi-subagents", "source": "pi-subagents", "passthrough": true },
    { "id": "pi-todo", "source": "@juicesharp/rpiv-todo", "passthrough": true }
  ]
}
```

只有同时满足以下两个条件时才会放行:

1. spec 包含 `passthrough: true`。
2. 匹配到的 `compatibilityAdapters` 条目 `passthrough === true`(目前仅
   `pi-mcp-adapter` / `pi-web-access` / `pi-subagents` / `pi-todo` 四个
   高下载量条目)。

## 对应 pi 包源

| OpenBuddy adapter | 推荐 pi 包 | npm weekly downloads |
| --- | --- | --- |
| `pi-mcp-adapter` | `pi-mcp-adapter` | 252k |
| `pi-web-access` | `pi-web-access` | 132k |
| `pi-subagents` | `pi-subagents` | 122k |
| `pi-todo` | `@juicesharp/rpiv-todo` | 37k |

安装前需要:

```bash
pnpm add pi-web-access @juicesharp/rpiv-todo pi-subagents
```

未安装时,OpenBuddy 自动回退到对应自有 capability 服务(`openbuddy-mcp-client`
/ `openbuddy-web-search` / `openbuddy-subagent` / `openbuddy-task`),命令名
(`/mcp`、`/websearch`、`/subagent`、`/tasks` 等)依然有效。

## 回退矩阵(用户没装 pi 包时)

| 用户场景 | OpenBuddy 行为 | 备注 |
| --- | --- | --- |
| 未安装 `pi-mcp-adapter` | `openbuddy-mcp-client` 接管 `/mcp` 命令 | OAuth + StreamableHTTP 自管,与 pi 包行为不同 |
| 未安装 `pi-web-access` | `openbuddy-web-search` 接管 `/websearch` | 内置 DuckDuckGo 抓取,可在 flag 后切付费 API |
| 未安装 `pi-subagents` | `openbuddy-subagent` 接管 `/subagent` | 单 agent 委派 + Promise.all 并行 |
| 未安装 `@juicesharp/rpiv-todo` | `openbuddy-task` 接管 `/tasks` | JSON 文件 + SQLite ledger,FTS5 检索 |
| 未安装 `pi-memory` 系列 | `memory.search()` 仅走 FTS5 | 桥接关闭,语义召回被跳过 |
| 未安装任何 pi-memory | `Memory.search()` 返回纯 FTS 结果 | `source` 字段恒为 `"fts"` |
| 桥接开启但语义包抛错 | 回退到 FTS-only,记录 warning | 桥接失败**永不破坏** search |
| `OPENBUDDY_MEMORY_BRIDGE=1` 但 adapter 未注册 | 回退到 FTS-only | 配置错误不致命 |
| 没装任何 pi 包 | 全部回落到 OpenBuddy 自有 capability | 行为与未启用 passthrough 一致 |

`compatibilityAdapters` 通过 `piPackageHint` + `isPiPackageInstalled()`(在
`electron/main/agent/pi-package-installed.ts` 中实现)判定包是否真正落地于
`node_modules`,只在确认安装后才放行;仅放在 `pnpm-workspace.yaml` 不算。

## 回退路径中 TasksPanel 的兼容层

`openbuddy-task` 与 `@juicesharp/rpiv-todo` 共存时(用户装了 pi 包但 OpenBuddy
仍挂载自有服务),TasksPanel **仍渲染**,但读取优先级为:

1. `piSessionStore(ctx).readSessionEntries(sessionId)` 解析 `todo/write`
   自定义条目 → 来自 pi session log 的官方来源。
2. SQLite ledger (`TaskCatalog`) 里的快照。
3. `~/.pi/agent/openbuddy-tasks/<sessionId>.json` 镜像文件(老用户)。

写入路径只在 1 失败时才落到 2/3 —— 保证新 todo 不会覆盖 pi 包已经
持久化的版本。详见 `packages/capability/openbuddy-task/src/index.ts`。

## Aegis telemetry 模式

如果要让 pi SDK 的 span 事件以外部 WorkBuddy Aegis schema 暴露(命名空间
`wb.telemetry.*` 而不是 `pi.telemetry.*`),启动 OpenBuddy 时设置:

```bash
OPENBUDDY_AEGIS_MODE=1 openbuddy
```

> 默认关闭。开启后所有 pi SDK 产生的 span tree 会通过 OpenBuddy telemetry
> funnel 转写到 Aegis 命名空间;OpenBuddy 的 TelemetryProvider 仍负责
> level 过滤 + 采样 + counter/timing/gauge + 多 provider fan-out。

## 新增 UI 组件

- `FilterableList<T>` (`@openbuddy/ui-primitives/FilterableList`) —— 对照
  pi TUI 同名抽象。
- `ThemePreview` (`@openbuddy/ui-primitives/ThemePreview`) —— 主题切换
  实时预览 swatch 行。
- `Button` 新增 `pill` 变体与 `tone` prop,可逐步收敛 Pill/Spinner。

## 不可替代模块

- `electron/main/harness/harness-server.ts` (1253 行) —— multi-tenant
  HTTP/WS transport + RPC store + resume token + recovery claim +
  remote relay。pi SDK 无对应物。
- 5 个 OpenBuddy 专属 capability:`openbuddy-folder-trust` /
  `openbuddy-inspiration` / `openbuddy-notification` / `openbuddy-calendar` /
  `openbuddy-email`。