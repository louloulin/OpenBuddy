# OpenBuddy AI Agent 真实测试闭环

更新时间：2026-08-30

这份计划把“全面测试”定义为可审计的证据链，而不是把所有按钮点击一遍。每项能力都必须标记证据等级：

机器可审计的场景登记在 `evals/agent-scenario-manifest.json`；`eval:audit` 与 `eval:capabilities` 会校验每个 capability 都有场景、每个场景入口存在、外部场景必须要求临时 provider 凭据，且 filesystem 保持策略关闭。

- **真实外部**：真实 Electron Main、真实 Pi `AgentSession`、真实 provider、真实事件日志和真实副作用均通过。
- **真实本地**：真实 Electron/Pi/IPC 通过，但 provider、MCP、marketplace 或连接器使用隔离本地服务；不能外推为云端通过。
- **fixture-only**：只验证协议分支或本地响应格式；不能作为真实模型证据。
- **未执行/策略跳过**：缺少外部凭据、Docker/VM、第三方服务或用户明确关闭 filesystem 时，必须保留为未验证。

## 一、统一执行链

```text
Playwright _electron.launch
  → Electron Main / preload bridge
  → Harness HTTP/RPC
  → Pi AgentSession
  → provider
  → agent.event-log + session history/surface/trace
```

## 一点五、顶级 Agent 测试集研究与适配边界

本项目采用“官方套件不冒充、项目闭环可重复”的双层策略。公开资料核对日期为
2026-08-30，链接和官方判定对象登记在 `evals/benchmark-manifest.json`。

| 套件/框架 | 官方真实判定所需 | OpenBuddy 当前适配 | 当前结论 |
| --- | --- | --- | --- |
| AgentDojo | 官方 suite/task、工具环境、attack/defense、官方安全与效用 scorer | `run_real_agent_capabilities.mjs` 的工具/拒绝边界 | 不能称 AgentDojo 通过 |
| BrowserGym/WebArena | Gym 环境、网站实例、任务集、agent loop、环境 reward/oracle | Electron UI 与本地 HTTP 页面 smoke | 不能称 BrowserGym/WebArena 通过 |
| OSWorld | VM、多应用桌面环境、任务状态检查、官方 evaluator | Electron 原生窗口/快捷键检查 | 不能称 OSWorld 通过 |
| SWE-bench Verified | 官方数据集、真实 issue repo、Docker 测试 harness、gold/test oracle | 临时 repo-fix 回归 | 只能称项目 adapter |
| Terminal-Bench/Harbor | 官方容器任务、task tests、Harbor runner | 本地 repo-fix marker | 只能称项目 adapter |
| τ-bench/τ³-bench | 官方 domain tools、user simulator、policy/world-state reward | Pi 多轮工具/状态任务 | 只能称 tau-shaped adapter |
| ToolSandbox | 官方 stateful tools、user simulator、milestone scorer | Pi tool start/end 和事件序列 | 只能称 adapter |
| BFCL | 官方 function-call 数据、并行/多轮 cases、AST/execution scorer | 单个 Pi 扩展工具调用 | 只能称 adapter |
| Inspect AI/DeepEval/Promptfoo/Langfuse | 对应框架安装、solver/provider、scorer/trace backend 和结果日志 | 已保存 adapter 配置 | 未运行，不宣称通过 |

因此顶级套件只作为能力模型和验收 oracle 的设计依据；真实交付证据仍分为
`real-external`、`real-local`、`adapter-only`、`official-not-run` 和 `disabled-by-policy` 五级。任何本地 Echo
provider、HTTP fixture、marker 或协议模拟都不能升级为官方 benchmark 或云端模型证据。

Playwright Electron 证据必须使用 `_electron.launch()` 启动真实 Main，并取得真实
`firstWindow()`；renderer DevTools 通过菜单/F12/平台快捷键验证。Electron Main 调试
使用 `--inspect`/`--inspect-brk` 的外部调试器，与 renderer DevTools 分开，不把常驻
debug toolbar 当成产品功能。

统一入口：

```bash
OPENBUDDY_FILESYSTEM_SMOKE=0 \
OPENBUDDY_E2E_REQUIRED=1 \
OPENBUDDY_E2E_API_KEY="$OPENBUDDY_E2E_API_KEY" \
OPENBUDDY_E2E_BASE_URL=https://api.minimaxi.com/anthropic \
OPENBUDDY_E2E_MODEL_ID=MiniMax-M3 \
node evals/node/run_full_acceptance.mjs
```

入口先执行 evaluation-suite audit、benchmark evidence audit、surface audit、renderer/Main typecheck、production build、串行 Vitest、diff check 和 Electron smoke；之后才执行真实 provider 阶段。缺少任一 `OPENBUDDY_E2E_*` 时，本地阶段仍运行，但最终退出码为 `2`，并输出 `externalBlocked`，绝不把 fixture 计为真实通过。官方 benchmark 只有在官方数据集、环境/runner、oracle/scorer 和脱敏证据同时存在时才可标记通过；当前清单全部为 `not-run` 或 `adapter-only`。

## 二、Agent 轨迹验收

`evals/node/run_agent_benchmark.mjs` 验证 JSONL 任务：

1. 每个任务新建独立 Pi session，防止前一任务污染上下文。
2. 每个 turn 验证 `session/input → agent/start → assistant/update* → assistant/end → agent/settled`。
3. 验证 event sequence 严格递增、session identity 一致、输入 marker、provider/model/api metadata 和 tool start/end 配对。
4. 失败任务继续执行，按 chat、tool-use、trace-integrity、input-boundary 汇总；错误只输出脱敏摘要。
5. 任务数据不包含 API key、真实 PII 或不可复现的时间依赖。

`evals/node/run_real_agent_capabilities.mjs` 是更严格的能力 runner，额外验证：

- `host.describe` 明确 runtime 是 Pi；
- 自定义 Anthropic provider 和 `MiniMax-M3` 出现在 live catalog；
- 两轮真实上下文、流式 delta、settled 和 provider metadata；
- `session.history`、`session.surface`、`session.traceEvent`、`session.readEvent`；
- `session.selectModel` 后继续对话；
- `capability.snapshot` 通过 Electron Main 汇总真实 Pi/Cordis provider、plugin、MCP、权限、资源和命令状态；不直接读取 renderer 状态，也不执行 filesystem；
- `capability.plan`、`capability.task`、`capability.permission` 的真实 Main IPC 生命周期，包括 plan 写入/拒绝、task 添加/清理和权限模式读取；
- Pi extensions reload、非法 prompt、未知 RPC 的 fail-closed 行为；
- 新 session 的 cancel/abort 终止事件；
- filesystem 保持 `not-run-by-policy`。

能力矩阵中的 `realEvidence` 只表示“存在可执行入口”，不表示已经通过。只有当前运行生成的
`OPENBUDDY_EVIDENCE_DIR` artifact 通过 schema、必需文件、失败计数和脱敏审计，能力才会标记为
`real-artifact-backed`；否则只能标记为 `ready-for-real-run` 或 `local-only`。历史日志不能替代当前证据。

每个真实阶段可以设置 `OPENBUDDY_EVIDENCE_DIR` 输出 `openbuddy.redacted-evidence.v1`。artifact 只包含脱敏 session 摘要、事件类型/序列摘要、provider/model/api、计数和 hash；`apiKey`、完整 prompt、token、headers 和完整 payload 都禁止写入。`evals/node/audit_evidence_artifacts.mjs` 会递归检查这些约束。

本地协议级闭环可用以下命令执行；它还包含专家目录 → plugin → agent file → hidden persona → Pi session → provider 的专家图 smoke：

```bash
npm run test:electron:real-evals
```

该命令启动真实 Electron Main、真实 Pi `AgentSession` 和一个监听本地端口的
Anthropic Messages SSE provider。provider 只替代外部网络，不替代 Pi、IPC、工具
或事件日志；因此它用于证明协议/链路闭环，不宣称 MiniMax 云端可用。它会顺序
执行 strict benchmark、capability audit、core regression 和 repo-fix，输出脱敏
`openbuddy.redacted-evidence.v1` artifacts。真实 MiniMax 验收仍使用
`OPENBUDDY_E2E_REQUIRED=1` 与临时凭据运行 `npm run eval:acceptance`。

JSONL 任务中的 `context.requiresPriorTurns=true` 还会禁止 follow-up prompt 直接重复答案，并要求答案只从同一 Pi session 的历史上下文恢复。工具任务必须同时看到对应 `tool/start` 和 `tool/end`，不能只用 assistant marker 代替工具证据。

## 三、能力覆盖矩阵

| 能力组 | 当前自动化证据 | 真实副作用 | 仍需单独验证 |
|---|---|---|---|
| Chat/session/context | strict benchmark + capability audit | Pi session event log | 真实 provider 凭据 |
| Provider/model CRUD | Electron smoke + Settings UI | models/auth 持久化、脱敏 | 真实 OpenAI-compatible provider |
| Tool/extension | Pi tool start/end、extension reload | tool result 和事件 pairing | 第三方 extension exact-version 矩阵 |
| Permission/question | server-request → response → capability event | request resolution | 真实模型触发的复杂权限分支 |
| Plan/task/steer/follow-up/abort | Main/IPC smoke、capability runner | lifecycle event | 真实模型长控制流 |
| Skills/agents/prompts/themes | resource/profile smoke | load/toggle/reload | 真实模型实际调用 skill |
| MCP/connectors/web | 本地 Main 服务与 connector fixture | config/auth/cancel/search/fetch | 真实 MCP server、OAuth、外部搜索 |
| Memory/automation/notification | Main capability lifecycle smoke | local persistence/records | OS notification、长时间调度 |
| Plugins/marketplace/teams | profile install/reload/remove、team lifecycle | local plugin/team state | 远程 marketplace 和跨进程协作 |
| Clipboard/UI | Electron smoke | system clipboard、中文/多行/大文本 | 多平台原生 dialog 与窗口控制 |
| Filesystem | 默认关闭 | 无 | 用户明确要求前不执行 |
| Harness/RPC/connection | HTTP/WebSocket/SSE、RPC store、authority tests | cursor/idempotency/error boundary | 跨设备签名 resume、真实远程 carrier |

## 四、顶级公开 Agent 基准映射

| 基准 | 官方验证对象 | OpenBuddy 当前 adapter | 不能声称的内容 |
|---|---|---|---|
| BrowserGym / WebArena | 浏览器环境、多步网页任务、任务 reward | 仅有 web-search/fetch facade 和 Electron UI smoke | 未运行官方 browser task |
| OSWorld | VM 中跨应用桌面 GUI | agent-cu/Playwright 可做本地 UI 验证 | 没有 VM/官方 OSWorld task |
| Terminal-Bench 2 / Harbor | 真实终端、任务测试脚本、oracle | `run_repo_fix.mjs` 是最小 repo-fix adapter | 不是官方 Terminal-Bench leaderboard |
| SWE-bench Verified | GitHub issue、patch、Docker tests | `run_repo_fix.mjs` 是小型本地仓库 verifier | 不是 SWE-bench Verified 数据集 |
| ToolSandbox | stateful tools、用户模拟、动态 milestone | Pi tool-loop + event/state assertions | 未导入官方 scenarios/user simulator |
| τ-bench / τ³-bench | 用户模拟、多轮业务工具、policy/state | `run_regression.mjs` 相似多轮工具样本 | 未运行官方 airline/retail/banking tasks |
| BFCL v3/v4 | simple/parallel/multi-turn/live tool calling | tool marker + start/end pairing | 未运行 BFCL 官方 test cases/scorer |
| Inspect-AI | dataset/solver/scorer 编排 | Python adapter 已存在 | 本机未安装/未执行 Inspect runner |
| DeepEval / Promptfoo / Langfuse | 断言、provider matrix、trace 观测 | adapters 已存在 | 未安装框架时不算通过 |

当前网络窗口成功读取并核对了 AgentDojo、BrowserGym 和 SWE-bench 的公开 README；ToolSandbox、OSWorld、BFCL、τ-bench、Inspect-AI 等部分请求超时或未成功读取。每个官方项目的环境、数据集、oracle 和依赖均不同，不能用 OpenBuddy 的本地 smoke 替代。

### 公开资料要求与当前结论

| 套件 | 真实运行最低要求 | 当前映射 | 结论 |
|---|---|---|---|
| AgentDojo | user tasks、工具环境、prompt-injection attack/defense、任务效用与安全 scorer | Pi 工具和拒绝边界 | `not-run` |
| ToolSandbox | 有状态工具、world-state snapshot、user simulator、动态 milestone | Pi tool start/end 和 capability 状态 | `adapter-only` |
| BFCL | 官方 function-call cases、参数/并行调用、多轮轨迹、execution scorer | 本地 extension tool pairing | `adapter-only` |
| BrowserGym/WebArena | Gym 环境、网站实例、任务集、环境 reward/oracle | Electron UI 与 web-search facade | `not-run` |
| OSWorld | VM、多应用桌面任务、环境状态检查 | OpenBuddy Electron smoke | `not-run` |
| SWE-bench Verified | 官方 issue dataset、Docker、patch prediction、官方测试 evaluator | 最小 `run_repo_fix.mjs` | `adapter-only` |
| Terminal-Bench/Harbor | 官方终端任务、隔离环境、任务 oracle | 最小 repo-fix runner | `adapter-only` |
| τ-bench | 业务状态工具、用户模拟器、policy/state oracle | `core_tasks.jsonl` 内部回归 | `adapter-only` |
| GAIA | 官方问题、附件/多模态输入、工具与答案 evaluator | 无官方数据和多模态 runner | `not-run` |
| AgentBench/ToolBench | 官方多环境/工具任务和环境 evaluator | 无官方数据导入 | `not-run` |

AgentDojo README 明确要求同时指定 suite/task、model、defense 和 attack；BrowserGym README 使用 Gym `reset()` / `step()` 并由环境返回 `reward`、`terminated`、`truncated`；SWE-bench README 要求数据集、Docker 可复现环境及 `swebench eval verified` 官方 evaluator。ToolSandbox、OSWorld、BFCL 等公开资料在当前网络窗口未全部成功读取，因此本项目保守保留为 `adapter-only` 或 `not-run`，不从名称推断通过。

OpenBuddy 自有严格闭环与上述官方 benchmark 分开：真实阶段必须是 Electron `_electron.launch()`、Pi `AgentSession`、真实 provider、真实事件日志和脱敏 artifact；缺凭据退出码为 `2`，不安装 fixture provider；filesystem 按策略保持 `not-run-by-policy`。能力矩阵只有在当前 artifact 声明对应 capability、全部阶段通过且脱敏审计通过时才显示 `real-artifact-backed`。

## 五、失败判定

- 只出现最终文本、没有 `agent.event-log`：失败。
- 使用 fixture provider 验证真实模型：失败。
- provider/model/api metadata 缺失：失败。
- reload/restart 后 session identity 或历史事件断裂：失败。
- tool start 没有对应 end、sequence 倒退、重复 RPC fingerprint 不一致却成功：失败。
- filesystem 未明确开启却产生文件读写：失败。
- 外部凭据缺失却报告 MiniMax 通过：失败。

## 六、下一步真实执行

需要一组新的、临时且已轮换的 provider 凭据后运行统一入口。不要使用历史聊天中已经暴露的 key；运行后删除临时用户数据并再次轮换 key。没有凭据时继续维护本地闭环和 adapter，但最终报告必须保留 external blocked，而不是降级为通过。
