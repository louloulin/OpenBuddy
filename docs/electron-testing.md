# Electron 自动化验证

OpenBuddy 的桌面验证使用 Playwright Electron driver 直接启动真实 Electron 主进程，不使用 renderer mock 代替主链路。

## 本地验证

```bash
pnpm exec electron-vite build
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec tsc --noEmit -p tsconfig.node.json
pnpm exec vitest run
pnpm exec node scripts/electron/smoke.mjs
```

针对 Harness/Pi 边界的短时验证使用独立脚本，避免被完整产品 smoke 的长流程拖住：

```bash
pnpm test:electron:harness
# 或复用已构建的 out/：
node scripts/electron/harness-smoke.mjs
```

真实 provider 的 UI 闭环使用 `scripts/electron/real-ui-smoke.mjs`。它不调用 renderer mock：通过真实设置页面保存 provider/model，使用真实 textarea 和发送按钮完成五轮对话（含 Pi extension tool），然后执行 renderer reload 和 Electron restart，最后从同一 session 的 Pi event log 校验 `session/input → agent/start → assistant/update → assistant/end → agent/settled`、provider/model/api metadata 和 tool start/end。缺少完整 `OPENBUDDY_E2E_*` 时脚本以退出码 `2` fail-closed；filesystem smoke 始终保持关闭。

`harness-smoke.mjs` 在隔离的 Electron/Pi home 中验证 `harness:address`、Bearer 鉴权的 HTTP `host.describe`、真实 mux/host WebSocket、Harness `pi.extensions.reload`、`pi/extensions-reloaded` live frame，以及关闭 WebSocket 后通过 `openbuddy://plugin-event` 的 IPC 回退。脚本总超时为 45 秒，成功路径会清理定时器并立即退出；它不依赖外部 provider，也不替代完整产品 smoke。

`scripts/electron/smoke.mjs` 覆盖启动白屏保护、版本化 preload bridge、Pi 初始化、provider/model CRUD、真实 prompt/event、session 生命周期、abort、dispose/re-init、能力 IPC、通知、连接器、插件市场、剪贴板粘贴、渲染器 reload、Electron 重启持久化，以及原生 DevTools 菜单/快捷键可达性。filesystem smoke 默认关闭；只有显式设置 `OPENBUDDY_FILESYSTEM_SMOKE=1` 才执行 `shellfs:*`/`list_dir` 文件读写、打开、导入和删除探针。Debug toolbar 不作为常驻 UI。

Smoke 还会通过 `agent:extensions-reload` 注入一个故意损坏的 profile patch，验证 `pi/extensions-reload-failed` 的 `rolledBack=true`，并确认原 Pi command、skill、workspace registry 和主链路仍可用；随后恢复合法 patch 并再次 reload。`scripts/electron/audit-agent-surface.mjs` 对 preload allowlist、Main handler、能力证据和评测入口做静态闭环审计，`run_full_acceptance.mjs` 将该审计作为第一阶段。

Smoke 由 Playwright `_electron.launch()` 启动真实 Main，并通过内置 Harness Web transport 做第二条可观察链路验证：`window.api.invoke("harness:address")` 返回一次性本地地址和当前 Electron 进程 bearer token，HTTP `POST /api/host.describe`、WebSocket `/api/events.mux`、SSE `GET /api/events.mux?since=0` 均真实建立并鉴权。权限/question 使用同一条 server-request → UI → `/api/respond` 回路，不以 renderer mock 替代 Main/Pi。

历史构建记录曾显示短 Harness smoke 的 `runtime=pi`、HTTP/mux/host、Pi reload、断线 IPC fallback 均通过；也曾记录真实 MiniMax 的 5 轮对话、工具事件、renderer reload 和 Electron restart。它们都不是当前 shell 的新鲜外部证据。当前 `run_real_agent_capabilities.mjs` 进一步要求三轮真实 provider 对话、精确工具 start/end、Pi-backed team 成员完成态和 capability CRUD；filesystem smoke 仍按策略关闭。

测试分层如下：

- **启动层**：生产 build、首屏非空、DOM ready、bridge version/readiness、preload/renderer 诊断和 fallback。
- **协议层**：IPC allowlist、非法 payload、Harness HTTP/WebSocket/SSE 鉴权、RPC correlation/idempotency、事件序列、reconnect cursor、session ID 和插件边界。
- **产品层**：provider/model 保存、删除、刷新、选择、脱敏持久化、剪贴板中文/多行/reload、DevTools 快捷键。
- **真实链路层**：临时环境变量启用 MiniMax 后，验证流式多轮对话、上下文引用、Pi 工具/控制流、reload 续聊、Electron restart 恢复和 event log。

## 真实 Anthropic-compatible provider

专家图闭环使用 `scripts/electron/expert-graph-smoke.mjs`。它创建临时专家目录和两个真实 Pi agent 文件，通过 Playwright `_electron.launch()` 启动 Electron Main，依次验证目录 catalog、插件 manifest、agent prompt、团队成员链接、UI「召唤」与 badge、隐藏 persona 进入 `session/input`、真实 Anthropic Messages SSE 回复、Pi event log、session expert metadata，以及 renderer reload 后绑定恢复。多轮专家对话部分在同一个 Pi session 内继续输入两条新 prompt，逐轮校验每条 session/input 仍包含 EXPERT_PERSONA_BEGIN/END 隐藏前缀（与 persona + 用户文本拼接的 sha256 严格相等）且 assistant 回复包含预期 marker；Electron restart 部分先记录 before-sequence-max，关闭 Electron Main 后用同一 userData 重新 launch，校验 session metadata 的 expertId/expertName 仍为 "reviewer"、event-log sequence 没有回退、agent:load-session 成功恢复，并在重启后的会话里继续发送新一轮 prompt 验证 persona 仍被注入并收到 ACK-POST-RESTART 标记。证据只保存节点/边、摘要 digest、事件类型和计数，不保存完整 prompt、请求体或密钥；`OPENBUDDY_FILESYSTEM_SMOKE=0` 始终有效。

外部验证只从临时环境变量读取凭据，不把 API key 写入源码、fixture、日志或测试快照：

```bash
OPENBUDDY_E2E_REQUIRED=1 \
OPENBUDDY_E2E_API_KEY='临时轮换密钥' \
OPENBUDDY_E2E_BASE_URL='https://api.minimaxi.com/anthropic' \
OPENBUDDY_E2E_MODEL_ID='MiniMax-M3' \
pnpm exec node scripts/electron/smoke.mjs
```

外部分支会通过设置 UI 保存自定义 Anthropic provider，选择模型，完成真实多轮对话，并在 renderer reload 与 Electron 重启后继续同一个 Pi session。`OPENBUDDY_E2E_REQUIRED=1` 可避免变量缺失时误把本地 fixture 当成真实外部验证。统一入口 `evals/node/run_full_acceptance.mjs` 会按顺序执行 surface audit、renderer/Main typecheck、production build、全量 Vitest、`git diff --check`、真实 Electron smoke、strict agent benchmark、core regression 和 repo-fix。

最新本地闭环证据（2026-08-30）位于 `/tmp/openbuddy-echo-evidence-d5003265-c7f2-45f7-8574-cf23be2fae87`：`6/6` runner 通过，UI smoke 五轮对话、Pi tool、provider/model CRUD、renderer reload、Electron restart 和 event log 均通过，`rendererErrors=0`；专家图 smoke 也通过。该运行使用本地监听的 Anthropic Messages SSE echo provider，配置的协议元数据为 `custom_anthropic / MiniMax-M3 / anthropic-messages`，因此证明的是真实 `Electron → preload → Main → Pi → provider` 协议闭环，不等同于 MiniMax 云端模型结果。

证据审计同时通过：6 个脱敏 JSON artifact 均符合 `openbuddy.redacted-evidence.v1`，未发现 API key、完整 prompt、authorization header 或完整请求体；`audit_benchmark_evidence.mjs` 额外确认官方 benchmark 通过数为 `0`，本地 adapter 与项目自有套件分开归类。`OPENBUDDY_FILESYSTEM_SMOKE=0` 全程保持关闭。官方 BrowserGym/WebArena、OSWorld、MLE-bench、AgentDojo、GAIA、AgentBench/ToolBench 等环境未运行；SWE-bench、Terminal-Bench、τ-bench、ToolSandbox、BFCL、Inspect AI、DeepEval、Promptfoo、Langfuse 仅登记 adapter，不能把本地任务冒充官方 benchmark。

该结果证明请求链为 `Renderer → preload → Electron Main → Pi AgentSession → Anthropic Messages provider`。真实外部验证必须由调用方临时注入凭据；缺少 `OPENBUDDY_E2E_*` 时 smoke 失败关闭，不把本地 fixture 结果冒充外部通过。

## 当前进度与后续计划

- **已完成**：Electron 唯一生产壳、Pi `AgentSession` 主进程链路、typed preload bridge、黑屏诊断/fallback、快捷键 DevTools、中文多行剪贴板、provider/model 自定义配置、插件/专家图动态加载、renderer reload、Electron restart 恢复，以及真实 Playwright Electron 分层评测。
- **本轮修复**：Harness resume token 写入串行化并清理临时文件；父子 slot 声明兼容、directory picker 重复注册幂等；绑定 layout/theme 快照回调，消除真实 renderer `TypeError`；修复专家缩略图把完整 `data:image/*` URL 二次编码为无效 URL，避免专家面板触发 `ERR_INVALID_URL`。
- **验证结果**：最新串行 Vitest `148` 文件、`1539` 通过、`6` 跳过；生产 Electron build、typecheck、surface audit、`git diff --check` 通过；严格 Agent benchmark `8/8`、能力审计 `15/15`、核心回归 `4/4`、repo-fix `1/1`、专家图通过且 `rendererErrors=0`；filesystem smoke 按策略未运行。
- **后续计划**：由调用方临时注入并轮换真实 MiniMax 凭据，运行同一套 fail-closed smoke；补齐官方 benchmark 数据集、runner、环境和 scorer 后再声明官方结果；继续把新增 Pi/WorkBuddy 能力接入同一套脱敏 event-trace 契约。

## 调试与故障定位

- 菜单使用 `View → Toggle Developer Tools`；macOS 支持 `Alt+Command+I`，其他平台支持 `Ctrl+Shift+I` 和 `F12`。
- 主进程记录 renderer `did-fail-load` 和 `render-process-gone`，失败时显示可读 fallback 页面。
- Renderer 通过 `window.api` 访问 Electron；未知 channel、错误 payload 和越界路径必须返回可序列化错误，而不是让 Electron 进程崩溃。
- 不提供常驻 Debug toolbar；调试入口仅保留原生 `View` 菜单、`F12`、`Ctrl/Cmd+Shift+I`。

## 能力边界

OpenBuddy 对标 WorkBuddy 只覆盖仓库中已经实现且能从 Electron UI/IPC 观察的能力：会话、Pi 模型/provider、工具与权限、计划/任务、skills、MCP、teams/subagents、filesystem、通知、automations、插件/marketplace、连接器和剪贴板。WorkBuddy 私有云后端、商业账号、企业登录和不可公开观察的服务不作为通过项；本地能力可以使用隔离临时目录验证，但不会伪造云端结果。

## Agent 评测集最佳实践

本项目把 Agent 评测拆成四层，而不是只断言页面上出现一段文本：

1. **协议层**：使用 Playwright Electron driver 启动真实 Main，检查窗口非空、preload bridge readiness、IPC allowlist、RPC correlation、事件序号和重连游标；`console-message`、`pageerror`、`did-fail-load`、`render-process-gone` 都进入失败证据。
2. **轨迹层**：每个样本读取脱敏的 `agent.event-log`，断言 `session/input → agent/start → assistant/update* → assistant/end → agent/settled` 的顺序、同一 `sessionId`、provider/model/api 标记和工具 start/end 配对，不能只看最终答案。
3. **任务层**：用 JSONL 固定可复现样本，覆盖中文单轮、多轮记忆、真实 Pi extension、连续控制流和 repo-level 修复；每个样本有明确 marker、超时、失败原因和请求计数，缺少真实凭据时 fail-closed。
4. **恢复层**：在同一测试中执行 renderer reload 和 Electron restart，验证 session、模型、历史事件和 provider 持久化；剪贴板单独覆盖中文、多行、大文本、系统快捷键和 reload 后再次粘贴。

严格真实 Agent benchmark 使用 `evals/node/run_agent_benchmark.mjs`。它强制要求 `OPENBUDDY_E2E_REQUIRED=1`，每个任务新建真实 Pi session，并逐轮验证 `session/input → agent/start → assistant/update* → assistant/end → agent/settled`、严格递增序号、同一 session、provider/model/api 证据和 Pi tool start/end 配对；缺少任一证据即失败，不会将 fixture provider 计为通过。任务失败不会提前截断整套评测，结果会按 `chat`、`trace-integrity`、`tool-use`、`input-boundary` 等 category 汇总，并只输出脱敏错误摘要。

采用的公开工具契约分别对应 Playwright Electron、Promptfoo custom provider、Inspect-AI task/scorer、DeepEval pytest、Langfuse trace projection，以及 Terminal-Bench/SWE-bench 风格 repo task。它们共享同一条 Electron → preload → Main → Pi → provider 链路，不以 renderer mock 替代核心聊天；SSE/WebSocket 只用于实时观察，回归断言优先使用 Main 侧 `agent.event-log`，避免长连接断开造成假阴性。

公开参考：

- Playwright Electron API：`https://playwright.dev/docs/api/class-electron`
- Promptfoo custom providers：`https://www.promptfoo.dev/docs/providers/custom-api/`
- Inspect-AI tasks/scorers：`https://inspect.aisi.org.uk/`
- DeepEval：`https://deepeval.com/docs/getting-started`
- Langfuse tracing：`https://langfuse.com/docs/observability`
- SWE-bench：`https://www.swebench.com/`
