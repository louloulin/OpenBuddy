# OpenBuddy Agent Evaluation Suite

Real, no-mock AI-Agent evaluation suite for OpenBuddy. Every example drives
the **real** Electron harness HTTP / WebSocket / SSE surface and the real Pi
AgentSession. There is no mock fallback.

## Layout

```
evals/
├── datasets/core_tasks.jsonl          Inspect AI / SWE-bench style JSONL samples
├── inspect_ai/openbuddy_task.py      Real Inspect-AI-style dataset+solver+scorer
├── deepeval/test_openbuddy_chat.py    Real pytest + DeepEval style regression
├── promptfoo/
│   ├── promptfooconfig.yaml           Real promptfoo config
│   └── openbuddy_provider.js          Custom provider that calls the harness
├── langfuse/trace_realtime.py         Real Langfuse-style trace projection
└── node/
    ├── audit_evaluation_suite.mjs Machine-auditable benchmark/credential/policy audit
    ├── audit_capability_matrix.mjs Machine-auditable feature-to-evidence matrix
    ├── audit_official_benchmarks.mjs Local readiness audit for official benchmark prerequisites
    ├── harness_client.mjs             Tiny HTTP RPC + SSE helper
    ├── run_regression.mjs             MCP-Bench / tau-bench style tool+multi-turn
    ├── run_gaia_local.mjs            Local GAIA-style multi-step reasoning adapter
    ├── run_agentbench_tools.mjs      Local AgentBench/ToolBench-style tool selection adapter
    ├── run_agentdojo_safety.mjs      Local AgentDojo-style prompt-injection safety adapter
    ├── run_top_tier_local.mjs        Top-tier local adapter orchestrator (fail-closed)
    ├── run_agent_benchmark.mjs        Strict real-agent trace benchmark (fail-closed)
    ├── run_real_agent_capabilities.mjs Real provider capability/query/recovery audit
    ├── run_full_acceptance.mjs        Sequential real Electron/Pi acceptance suite
    └── run_repo_fix.mjs               Terminal-Bench / SWE-bench style repo fix
```

## Required env

| Var | Required for |
|-----|--------------|
| `OPENBUDDY_HARNESS_URL` | All examples (e.g. `http://127.0.0.1:42183`) |
| `OPENBUDDY_HARNESS_TOKEN` | All examples |
| `OPENBUDDY_E2E_REQUIRED=1` | Fail-closed gate for real-credential runs |
| `OPENBUDDY_E2E_API_KEY` | Real external provider key |
| `OPENBUDDY_E2E_BASE_URL` | Real provider base URL |
| `OPENBUDDY_E2E_MODEL_ID` | Real provider model id |
| `OPENBUDDY_EVAL_CWD` (optional) | Override the cwd the agent session starts in |

`OPENBUDDY_E2E_API_KEY` is read from the env only; never written to a file,
fixture, log, or result. After the run, rotate the key at the provider.

## Run

```bash
# 1. Launch OpenBuddy Electron with real MiniMax creds (or use the existing
#    smoke harness). The harness URL/token are printed at startup or can be
#    fetched with `window.api.invoke("harness:address")` from the renderer.

# 2. Real regression — multi-turn + tool-call (MCP-Bench / tau-bench style)
OPENBUDDY_HARNESS_URL=http://127.0.0.1:42183 \
OPENBUDDY_HARNESS_TOKEN=secret \
OPENBUDDY_E2E_API_KEY=$OPENBUDDY_E2E_API_KEY \
OPENBUDDY_E2E_BASE_URL=https://api.minimaxi.com/anthropic \
OPENBUDDY_E2E_MODEL_ID=MiniMax-M3 \
OPENBUDDY_E2E_REQUIRED=1 \
node evals/node/run_regression.mjs

# 2b. Strict real-agent benchmark. Never falls back to a fixture provider.
OPENBUDDY_E2E_REQUIRED=1 \
OPENBUDDY_E2E_API_KEY=$OPENBUDDY_E2E_API_KEY \
OPENBUDDY_E2E_BASE_URL=https://api.minimaxi.com/anthropic \
OPENBUDDY_E2E_MODEL_ID=MiniMax-M3 \
node scripts/electron/launch-harness.mjs -- node evals/node/run_agent_benchmark.mjs

# 3. Real Inspect-AI-style task (Python)
OPENBUDDY_HARNESS_URL=http://127.0.0.1:42183 \
OPENBUDDY_HARNESS_TOKEN=secret \
OPENBUDDY_E2E_API_KEY=$OPENBUDDY_E2E_API_KEY \
OPENBUDDY_E2E_BASE_URL=https://api.minimaxi.com/anthropic \
OPENBUDDY_E2E_MODEL_ID=MiniMax-M3 \
OPENBUDDY_E2E_REQUIRED=1 \
python3 evals/inspect_ai/openbuddy_task.py

# 4. Real pytest + DeepEval style
pip install deepeval pytest
OPENBUDDY_HARNESS_URL=http://127.0.0.1:42183 \
OPENBUDDY_HARNESS_TOKEN=secret \
OPENBUDDY_E2E_API_KEY=$OPENBUDDY_E2E_API_KEY \
OPENBUDDY_E2E_BASE_URL=https://api.minimaxi.com/anthropic \
OPENBUDDY_E2E_MODEL_ID=MiniMax-M3 \
OPENBUDDY_E2E_REQUIRED=1 \
pytest -q evals/deepeval/test_openbuddy_chat.py

# 5. Real promptfoo (custom provider)
npx promptfoo@latest eval -c evals/promptfoo/promptfooconfig.yaml

# 6. Real Langfuse-style trace projection
OPENBUDDY_HARNESS_URL=http://127.0.0.1:42183 \
OPENBUDDY_HARNESS_TOKEN=secret \
OPENBUDDY_E2E_API_KEY=$OPENBUDDY_E2E_API_KEY \
OPENBUDDY_E2E_BASE_URL=https://api.minimaxi.com/anthropic \
OPENBUDDY_E2E_MODEL_ID=MiniMax-M3 \
OPENBUDDY_E2E_REQUIRED=1 \
python3 evals/langfuse/trace_realtime.py

# 7. Real Terminal-Bench / SWE-bench style repo fix
OPENBUDDY_HARNESS_URL=http://127.0.0.1:42183 \
OPENBUDDY_HARNESS_TOKEN=secret \
OPENBUDDY_E2E_API_KEY=$OPENBUDDY_E2E_API_KEY \
OPENBUDDY_E2E_BASE_URL=https://api.minimaxi.com/anthropic \
OPENBUDDY_E2E_MODEL_ID=MiniMax-M3 \
OPENBUDDY_E2E_REQUIRED=1 \
node evals/node/run_repo_fix.mjs

# 8. Full sequential real acceptance (no fixture fallback; filesystem smoke stays off)
OPENBUDDY_E2E_REQUIRED=1 \
OPENBUDDY_E2E_API_KEY=$OPENBUDDY_E2E_API_KEY \
OPENBUDDY_E2E_BASE_URL=https://api.minimaxi.com/anthropic \
OPENBUDDY_E2E_MODEL_ID=MiniMax-M3 \
node evals/node/run_full_acceptance.mjs

# 9. Audit benchmark boundaries without contacting a provider
node evals/node/audit_evaluation_suite.mjs

# 10. Check official benchmark prerequisites without network or execution
node evals/node/audit_official_benchmarks.mjs

# 11. Audit the complete Electron + Pi capability matrix
npm run eval:capabilities
```

统一入口的本地阶段顺序是：surface audit、renderer/Main TypeScript、production build、full Vitest、`git diff --check`、Electron smoke；随后才启动真实 provider 阶段。真实阶段必须同时满足 `OPENBUDDY_E2E_REQUIRED=1`、API key、base URL、model id 和 Harness token。缺少任一项直接失败，不把 fixture provider、历史日志或未安装的第三方框架算作通过。`run_agent_benchmark.mjs` 会继续执行所有 JSONL 任务，输出 category 汇总和脱敏错误；不会输出 prompt、完整事件 payload 或 API key。

真实 provider 阶段还会执行 `run_real_agent_capabilities.mjs`：它验证 live provider catalog、provider/model CRUD、memory/skills/MCP/notification/automation/plugin/subagent/team 生命周期、三轮 Pi 上下文与精确工具参数、history/surface/trace/read 查询、模型选择后续聊、Pi extension reload、非法 RPC 拒绝和 cancel 终止事件。team 检查必须等待 Pi-backed 成员全部进入 `done`，工具检查必须看到唯一且有序的 `tool/start`、`tool/end` 与精确 marker。该脚本只接受真实 Electron Harness；没有凭据时退出 `2`，不会启动 fixture 替代。

## 当前真实验证边界

`evals/capability-matrix.json` 是仓库能力的逐项清单，不把“代码存在”或 fixture
smoke 当成真实模型证据。每项能力记录本地 Electron/Pi 证据入口；需要外部模型的
能力还必须由 `run_agent_benchmark.mjs` 或 `run_real_agent_capabilities.mjs` 在真实
provider 上产生脱敏 trace。

真实 provider 阶段只有在以下变量全部存在时才会运行：
`OPENBUDDY_E2E_REQUIRED=1`、`OPENBUDDY_E2E_API_KEY`、`OPENBUDDY_E2E_BASE_URL`、
`OPENBUDDY_E2E_MODEL_ID`、`OPENBUDDY_HARNESS_URL`、`OPENBUDDY_HARNESS_TOKEN`。
缺少任一项会明确报告 `externalBlocked`，不会回退成“真实通过”。
`OPENBUDDY_FILESYSTEM_SMOKE=0` 保持关闭，filesystem 不计入通过项。

## 顶级 Agent benchmark 对照

| 方向 | 官方基准/框架 | OpenBuddy 当前证据 | 不能冒充的部分 |
|---|---|---|---|
| Electron 桌面自动化 | Playwright `_electron.launch()` | `scripts/electron/smoke.mjs`、`surface-regression.mjs` | fixture provider 不是外部模型证据 |
| 浏览器任务 | BrowserGym / WebArena | 官方 URL 与 readiness audit | 未安装官方环境、任务集和 evaluator |
| 桌面任务 | OSWorld | 官方 URL 与 readiness audit | 没有官方 VM 和状态 evaluator |
| 工具/注入安全 | AgentDojo |  local prompt-injection safety adapter | 未执行官方 suite/scorer |
| 多步推理 | GAIA |  local multi-step reasoning adapter | 未执行官方 GAIA dataset/evaluator |
| 工具选择 | AgentBench / ToolBench |  local tool selection adapter | 未执行官方 AgentBench dataset/evaluator |
| 状态工具轨迹 | ToolSandbox | strict tool pair 与参数断言 | 未执行官方 stateful world/scorer |
| 函数调用 | BFCL | 精确工具名、参数和 start/end 校验 | 未执行 BFCL 数据集/官方 scorer |
| 软件工程 | SWE-bench / Terminal-Bench | `run_repo_fix.mjs` repo-fix 适配 | 合成 repo 不等于官方数据集成绩 |
| 评测框架 | Inspect AI / DeepEval / Promptfoo | 仓库内真实 harness adapters | 第三方 runner 未安装时不报告通过 |

官方 benchmark 只有同时满足“官方数据集已安装、官方 runner/environment 已执行、
官方 oracle/scorer 已执行、存在脱敏证据 artifact”才允许标记为 executed/pass；
`npm run eval:official-audit` 会对这些条件 fail-closed。

## What these prove

| File | What it proves (without mocks) |
|------|---------------------------------|
| `inspect_ai/openbuddy_task.py` | Pi AgentSession → MiniMax stream is reachable; markers land in `assistant/update` events for every multi-turn sample; tool-call sample triggers `openbuddy_e2e_tool`. |
| `deepeval/test_openbuddy_chat.py` | Hard-evidence assertion that `provider=custom_anthropic`, `model=MiniMax-M3`, `api=anthropic-messages` are stamped on the streamed generation (proves path: Renderer → preload → Main → Pi → provider). |
| `promptfoo/...` | Same harness via promptfoo's file-provider contract; allows side-by-side A/B across providers while sharing the exact same agent runtime. |
| `langfuse/trace_realtime.py` | Projects Pi events to Langfuse spans/generations/tool calls and asserts sequence, provider/model/api stamps, and tool pairings. |
| `node/run_regression.mjs` | Real multi-turn + tool-call regression sweep over the JSONL dataset. |
| `node/run_agent_benchmark.mjs` | Strict fail-closed benchmark checking every turn's Pi trace, session identity, ordering, provider/model/api evidence, and tool pairing. |
| `node/run_real_agent_capabilities.mjs` | Strict real-provider audit of capability CRUD/persistence, three-turn context plus exact tool lifecycle, Pi extension reload, team completion, RPC rejection, and abort lifecycle. |
| `node/run_repo_fix.mjs` | Real repo-level fix: builds a buggy Node project, asks the agent to read it, edit, run tests, and report `REPO-FIX-OK/FAIL`.
| `node/run_gaia_local.mjs` | GAIA-style local multi-step reasoning adapter: structural validation of multi-turn context recall, exact tool routing, instruction following. Redacted evidence artifact committed at `evidence/gaia-style-local/`.
| `node/run_agentbench_tools.mjs` | AgentBench/ToolBench-style local tool selection adapter: validates exact tool name, exact args, forbidden events (no-tool-needed case), and sequential multi-call scenarios. Redacted evidence at `evidence/agentbench-tools-local/`.
| `node/run_agentdojo_safety.mjs` | AgentDojo-style local prompt-injection safety adapter: validates dataset coverage of ignore-injection, secret-exfil, tool-restriction, tool-result-injection, and precise-marker cases. Redacted evidence at `evidence/agentdojo-safety-local/`.
| `node/run_top_tier_local.mjs` | Orchestrator that runs all three top-tier local adapters and produces a single redacted evidence artifact at `evidence/top-tier-local/top-tier-local-orchestrator.json`. Fail-closed when `OPENBUDDY_E2E_REQUIRED=1` without credentials. |
| `node/run_full_acceptance.mjs` | Runs the Electron/Pi surface audit, renderer/Main typecheck, production build, full Vitest, diff check, real Electron smoke, strict Pi trace benchmark, core regression, and repo-level fix sequentially; any phase failure fails the suite. |

## How to read the harness surface

```
POST /api/<method>        { type:"client-request", rpcId, method, payload }
POST /api/respond         (UI tool/permission/question responses)
POST /api/agent.event-log { type:"client-request", rpcId, method, payload }
GET  /api/events.mux      text/event-stream, bearer token required
WS   /api/events.mux      ?since=N&sinceSession=...  (token via header or query)
```

`harness:address` (called from `window.api.invoke`) returns
`{ host, port, baseUrl, token }`. The token is generated per Electron
launch and never persisted.

## No mocks, no shortcuts

* Every real evaluation requires `OPENBUDDY_E2E_REQUIRED=1` and complete `OPENBUDDY_E2E_*`; missing values → exit 2.
* Harness URL / token not exported → pytest `skip` (not pass), other tools `exit 2`.
* `OPENBUDDY_E2E_API_KEY` is never written to `models.json`, `auth.json`,
  fixtures, logs, or this README. After the run, rotate the key at the
  provider (e.g. minimaxi console).

## Real capability RPC audit

`electron/main/ipc.ts` exposes the typed harness methods `capability.providers`,
`capability.skills`, `capability.mcp`,
`capability.notifications`, `capability.automation`, `capability.plugins`,
`capability.subagents`, and `capability.teams`. These are not test doubles: each
method calls the same Electron Main service used by the renderer and Pi session.
`evals/node/run_real_agent_capabilities.mjs` exercises CRUD, persistence,
resource reload, cleanup, three-turn context, exact tool-call arguments/results,
Pi-backed team completion, and real-provider chat traces through the live harness.

A capability is marked as real evidence only when the runner is launched with a
new temporary provider credential and `OPENBUDDY_E2E_REQUIRED=1`. The runner
never enables filesystem smoke, never prints credentials, and marks disabled or
not-executed external scenarios separately from local Electron evidence.
