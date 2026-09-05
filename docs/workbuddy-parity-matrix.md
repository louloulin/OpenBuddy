# OpenBuddy / WorkBuddy 能力对标矩阵

更新时间：2026-08-29

详细的代码入口、真实/fixture 证据分级和公开 Agent benchmark 映射见 `docs/agent-evaluation-matrix.md`。本表不把 fixture smoke 当成外部模型通过。

本矩阵只记录 OpenBuddy 当前仓库已声明、并能从 Electron UI 或 typed preload IPC 观察的能力。它不是对 WorkBuddy 私有后端、商业账号或未公开服务的兼容承诺。

| 能力 | OpenBuddy 当前实现 | 真实验证证据 | 限制/缺口 | 纳入本 change |
| --- | --- | --- | --- | --- |
| AI Chat 与会话 | Electron Main 内嵌 Pi `AgentSession`，Renderer 只调用 preload | Electron smoke；MiniMax 五轮、流式 delta、上下文、reload/restart | 外部验证依赖网络与临时凭据 | 是 |
| Provider/Model | Anthropic Messages、OpenAI-compatible、自定义 provider/base URL/model，脱敏持久化 | 设置 UI CRUD、协议计数、MiniMax `MiniMax-M3` | 不承诺第三方账号登录 | 是 |
| 工具、权限、问题、计划 | Pi 事件映射为 UI 请求并支持响应，计划/任务有 Main facade | permission/question 双向 smoke；Pi event log | 未宣称覆盖 WorkBuddy 私有策略服务 | 是 |
| Skills、MCP、teams/subagents | Main capability packages、Pi 插件/资源加载、typed IPC | capability tests、Electron Main smoke、插件加载验证 | 远端企业 MCP 需用户自行配置 | 是 |
| Filesystem、clipboard、通知 | workspace-scoped filesystem facade、系统剪贴板、通知记录 | 路径边界测试；中文/多行粘贴；notification/automation smoke | 二进制预览按本地应用策略处理 | 是 |
| Automations、tasks、inspiration | 本地持久化 capability services 与 UI/IPC projection | scheduler/record 生命周期 smoke | 不模拟外部调度平台 | 是 |
| Plugins、marketplace、connectors | Pi/OpenBuddy plugin host、profile/plugin entries、Harness event transport | plugin loader tests；Harness HTTP/WebSocket smoke | 尚非完整 DeepSeek Harness 生态 parity | 是 |
| DevTools/debug | Electron 原生菜单和快捷键 | `View` 菜单、`F12`、`Ctrl/Cmd+Shift+I` smoke | 无常驻 debug toolbar，按产品要求 | 是 |
| WorkBuddy 私有云/商业账号 | 未实现、未伪造 | 不纳入真实通过项 | 需要公开协议或用户账号授权 | 否 |

## 主链路证据

真实 MiniMax 验证使用进程级临时变量：`OPENBUDDY_E2E_REQUIRED=1`、`OPENBUDDY_E2E_API_KEY`、`OPENBUDDY_E2E_BASE_URL`、`OPENBUDDY_E2E_MODEL_ID`。密钥不写入源码、fixture、模型配置、截图或日志；输出只保留 provider/backend、模型名、session 摘要、事件计数和 fixture 请求计数。

已验证的顺序是：新 session 首轮真实回复 → 第二轮引用首轮 → 第三轮连续控制流/工具 → renderer reload 后第四轮 → Electron restart 后第五轮。Pi event log 同时观察到 `session/input`、`assistant/update`、`assistant/end`、`agent/settled` 及工具开始/结束事件，且同一 session/model 在 reload/restart 后恢复。

## 仍需明确的边界

- Comet Native 的 Runtime 检查已完成，但独立语义 Verifier 当前没有可用进程/回调；不能把 Runtime 的 `pending` 状态伪称为 Comet 已验收通过。
- 当前实现是 Pi-first 的 OpenBuddy 适配层，不宣称替代 DeepSeek Harness 全部网络 carrier、Typert authority/interceptor 或完整生态包。
- 用户提供过的真实 API key 已经暴露，验证结束后应立即轮换；本仓库不保存该凭据。
