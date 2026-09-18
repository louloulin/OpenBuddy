# 本地审计与遥测(Audit Trail + Local Telemetry)

> OpenBuddy 相对 WorkBuddy 的**隐私差异化核心** — 审计与遥测**全部本地优先**,
> 任何云端同步都必须是显式 opt-in。

## 三层边界

| 层 | 落盘位置 | 范围 | 上云? |
|---|---|---|---|
| L1 — 用户审计(`~/.openbuddy/audit.jsonl`) | 本机 JSONL | 设置打开 / 登录 / 插件市场安装 / 关键文件操作 | 否 |
| L2 — Pi 扩展审计(渲染端 accumulator) | 内存 | 插件策略报告(allowed / denied / needs-review) | 否 |
| L3 — 遥测(`@/lib/telemetry/*`) | 内存 + opt-in OTLP | 事件名 / level / 属性 | 默认仅 console;OTLP 端点显式设置才上行 |

L1 持久化,L2 / L3 进程内常驻;**关闭应用就清空**。

## L1 — 本地审计 JSONL

主进程入口 `electron/main/casdoor/casdoor-audit.ts`(EventStore 持久化到
`~/.openbuddy/audit.jsonl`)。Renderer 侧 3 个 IPC 通道:

| IPC | 入参 | 返回 |
|---|---|---|
| `audit:list` | `{ limit?: number }` | `AuditEvent[]`(按 ts desc) |
| `audit:export` | `{ path, format: "jsonl"\|"json" }` | `{ ok, bytes }` |
| `audit:clear` | — | `{ ok, removed }` |

UI:Settings → 「本地审计追踪」面板(`AuditSettingsPanel` in
`packages/ui/openbuddy-ui-settings/src/SettingsSections.tsx`):
- 搜索(事件名 / 主体 / 详情)
- 刷新 / 导出 JSONL / 导出 JSON / 清空
- 文案明确写「本地优先,不上传,不与 WorkBuddy 等云端 AI 工作台共享」

## L2 — Pi 扩展策略报告

`src/hooks/useExtensionAuditPanel.ts` 订阅 `openbuddy://plugin-event` 上
`pi/extension-policy-report` 事件,聚合到 `ExtensionAuditAccumulator`,供
Extension Audit 面板显示 `N allowed · M denied · K needs-review`。

Renderer 侧:
- `src/lib/agent/extension-audit-accumulator.ts`(聚合 + 去重)
- `src/lib/agent/extension-audit-event-parser.ts`(策略报告解析)
- `src/hooks/useExtensionAuditPanel.ts`(React 订阅)
- `src/hooks/useExtensionAuditPanel.test.tsx`(契约)

主进程侧:`electron/main/agent/pi-extensions.ts::resolvePiExtensions` 每
次跑都 emit 一条 `pi/extension-policy-report`,Renderer 端实时聚合。

## L3 — 遥测

`src/lib/telemetry/telemetry-contract.ts` 定义 provider 接口:`id / isEnabled
/ reportEvent / reportMetric`。注册表是 module-level singleton,允许多 provider。

默认行为(`useAppShellRuntime.ts` 注册):
- **Console provider**:任何事件 `console.debug("[telemetry] ...")`(默认开启,仅本地)。
- **OTLP provider**:`localStorage.getItem("openbuddy.otlp.endpoint")` 非空才注册;
  走 `@/lib/telemetry/otlp-exporter` 批量 POST。

也就是说 — **没有设置 `openbuddy.otlp.endpoint` 就不会有任何外发**。这条默认
  行为是「本地优先」卖点的实操防线。

来源侧:
- `agentOnPiTelemetryEvent`(主进程 emit 的 Pi 内部事件) → renderer 端
  `reportEvent` 转发。
- 渲染端直接 `reportEvent("app_started", "info")` 之类的应用级事件。

## 与 WorkBuddy 的对比

| 维度 | OpenBuddy | WorkBuddy |
|---|---|---|
| 审计数据落盘 | 本机 JSONL | 云端仪表板 |
| 遥测默认 | console only | 强制上报 |
| OTLP 出口 | 显式 opt-in | 始终开启 |
| 策略报告可见性 | renderer 实时聚合 + 审计面板 | 闭源 |
| 关应用 → 数据 | 1 / 3 持久化;2 / 3 清零 | 全留存云端 |

**结论**:OpenBuddy 把「数据自决」做成产品级默认 — 不是营销话术,而是 IPC 边界
与默认 provider 行为共同保证的硬约束。

## 进一步阅读

- `src/lib/agent/extension-audit-event-parser.ts` — L2 报告结构
- `src/lib/telemetry/telemetry-contract.ts` — L3 provider 契约
- `docs/PI_EXTENSION_BRIDGE.md` — 配套 IPC 公开契约
- `docs/PI_PASSTHROUGH.md` — Pi 内部事件的转发边界
