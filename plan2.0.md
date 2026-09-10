# OpenBuddy Pi-native WorkBuddy 计划 2.0

> 本轮执行记录：已安全 `git fetch origin && git rebase origin/main`，从 `f673e1e` 更新到 `ffd8c5c`，无冲突；仅有计划文件未跟踪改动，未覆盖任何业务修改。已实现 Phase 1 的一个可独立验收项：Pi 官方扩展事件 canonical namespace 补齐并加测试（见 §12）。


## 1. 结论先行

OpenBuddy 不是“尚未接入 Pi”的原型，而是已经完成相当大一部分 Pi-native 基础设施的桌面产品：根 `package.json` 固定使用 `@earendil-works/pi-coding-agent`、`pi-agent-core`、`pi-ai` `^0.85.0`，并同时保留 Cordis、MCP、邮件、团队、协作、存储等产品能力；核心进程通过 `createAgentSession`、`SessionManager`、`DefaultResourceLoader`、`ExtensionAPI`、`registerTool`、`registerCommand`、`registerProvider` 与 Pi 交互（`package.json:dependencies`；`electron/main/agent/agent-host.ts:22-24`；`electron/main/agent/pi-session-runtime.ts:1-48`）。

当前真正的问题不是“再造一个 Agent Runtime”，而是四个收敛问题：

1. **Pi 复用已较深，但职责边界仍大**：`agent-host.ts` 1484 行、`pi-extensions.ts` 1222 行、`packages/runtime/openbuddy-plugin-host/src/index.ts` 1348 行，仍有历史桥接、产品适配与 Harness 兼容代码聚集。
2. **Pi 能力存在“已实现但未产品化”的断层**：Pi 官方已提供会话树、分支/克隆、自动压缩、上下文事件、provider 请求钩子、扩展 UI/RPC、包/skill/prompt/theme 发现和热重载；OpenBuddy 已接入其中一部分，但 UI、权限、诊断、用户可安装生态和产品验收尚未以同一套闭环指标证明。
3. **产品力不能由 Pi 能力表替代**：Pi 是单 Agent Runtime，不提供 OpenBuddy 的企业身份、多租户、计费、协作、邮件、工作台信息架构；这些必须继续由 OpenBuddy 拥有，且要和 Pi 的 session/credential/tool 生命周期明确分层。
4. **性能与真实外部验证证据不足**：仓库有 `perf:streaming`、`perf:ipc`、Electron smoke、eval 与 acceptance 脚本，但本次未执行依赖安装、构建、真实模型调用或 benchmark，因此不得把代码存在、fixture 通过或文档声称当成线上性能结论。

**战略判断：** OpenBuddy 应采用“Pi-first、OpenBuddy-owned product、single-owner per capability、transactional reload、evidence-gated release”五条原则，而不是继续扩大第二套 Agent/Harness 内核。

## 2. 调研方法与证据等级

### 2.1 已检查对象

- OpenBuddy 全仓目录、`package.json`、Git 历史与当前分支状态。
- Agent 主链路：`electron/main/agent/agent-host.ts`、`pi-session-runtime.ts`、`pi-extension-discovery.ts`、`pi-resource-loader.test.ts`、`pi-rpc-ui-context.ts`、`pi-runtime-coordinator.ts`、`agent-hooks.ts`、`pi-tool-bridge.ts`。
- Plugin/包链路：`packages/runtime/openbuddy-plugin-host`、`openbuddy-plugin-sdk`、`electron/main/agent/host-modules/profile*`、`pi-resources*`。
- 产品与架构资料：`docs/OPENBUDDY_PI_NATIVE_PLAN.md`、`docs/pi-extension-architecture.md`、`docs/openbuddy-product-vs-pi.md`、`docs/openbuddy-capability-matrix.md`、`docs/workbuddy-parity-matrix.md`、`docs/PERFORMANCE*.md`、`README*.md`。
- Pi 官方本地文档版本：extensions、skills、sdk、rpc、packages、compaction，并查看对应 examples/SDK。

### 2.2 证据分级

| 等级 | 含义 | 可用于发布结论 |
|---|---|---|
| E0 | 代码/类型/测试文件静态存在 | 只能说明实现入口存在 |
| E1 | 本地单测或 fixture 通过 | 只能说明受控场景成立 |
| E2 | Electron smoke、IPC contract、资源 reload、profile transaction 真实执行 | 可说明本机集成闭环 |
| E3 | 真实 provider、真实第三方 Pi 包、真实安装包/多平台执行 | 可说明外部兼容性 |
| E4 | 有固定环境、样本量、P50/P95/P99、失败率、成本与回归阈值的重复 benchmark | 才可作为性能/发布门禁 |

本次报告的仓库事实主要为 E0；仓库中已有测试和脚本的“设计覆盖”记为 E1/E2 候选，不宣称本轮执行通过。

## 3. 当前架构事实

### 3.1 目标架构（已经部分落地）

```text
WorkBuddy React renderer
        │ typed preload / IPC / optional loopback RPC
Electron Main shell ───── OpenBuddy product services
        │                         │
        └──── Pi adapter ─────────┘
                 │
  Pi AgentSession + SessionManager + ModelRuntime
  DefaultResourceLoader + ExtensionRunner + Pi tools/events
```

OpenBuddy 应拥有：Electron 生命周期、窗口/菜单/剪贴板、产品 UI、工作区/专家/邮件/协作/企业策略、产品元数据、审计与计费边界。Pi 应拥有：Agent loop、会话消息与树、模型/provider 调度、工具执行协议、扩展生命周期、资源发现、compaction/branch summary、标准 RPC 语义。适配层只做类型转换、权限/UI 请求路由、事件投影和产品元数据关联。

### 3.2 已有能力清单（代码证据）

| 域 | 当前实现/证据 | 状态判断 |
|---|---|---|
| Agent/session | `agent-host.ts` 创建 Pi session；`pi-session-runtime.ts` 封装工厂；`SessionManager` 用于 list/open/fork/rewind 等资源 | 已接入，需减薄桥接 |
| 事件/流式 | `agent-hooks.ts` 监听 `tool_call`；IPC 转发 tool start/update/end；`src/lib/agent/pi-subscribe-port.test.ts` 覆盖订阅边界 | 主链路存在，需统一事件 schema/背压指标 |
| 扩展 | `pi-extensions.ts`、`extensions/*`、`pi-tool-bridge.ts` 注册工具/命令/provider；已有 calendar、patch、markdown、model 等适配 | 已接入，需能力 owner 清单 |
| 用户扩展 | `pi-extension-discovery.ts` 将包路径交给 `DefaultResourceLoader`；`init-pi-user-extensions.ts` 与相关测试存在 | 接入存在，需安全、安装、回滚闭环 |
| 包/资源 | profile resource paths、Pi package installed、skills/marketplace/memory/agents 资源模块与大量 reload 测试 | 基础成熟，需统一 inventory/诊断 |
| RPC/UI | `pi-rpc-ui-context.ts` 和测试覆盖 RPC-safe `ctx.ui`；Pi 官方 RPC 对 select/confirm/input/editor 提供 request/response，TUI-only custom 降级 | 适合 WorkBuddy UI，需把所有 UI request 做超时/取消/审计 |
| reload | `pi-runtime-coordinator.ts` 串行 reload；`session.reload()` 与 `DefaultResourceLoader.reload()` 有测试；profile transaction 另有回滚 | 正确方向；必须保持“Pi 全 session reload”语义，不伪造单扩展 unload |
| provider | `agent-host-provider-registry.ts` 跟踪 `registerProvider`/`unregisterProvider` 来源；settings/provider IPC 存在 | 已有归属能力，需凭据/租户/成本隔离门禁 |
| compaction/tree | OpenBuddy 有 session/branch/summary 相关代码；Pi 官方提供 `session_before_compact`、`session_before_tree`、`context`、自动 retry/compaction | 需产品化 context pill、恢复语义和成本可见性 |
| 工具 | Pi 标准 read/write/edit/bash 由 session tools 提供；OpenBuddy 自有 `pi-tool-bridge`、capability tool、MCP/tool adapters | 需一项能力一个 owner，禁止重复注册 |
| 插件 SDK | `openbuddy-plugin-sdk` 有 types/serializer/fixture；plugin-host 有 profile/bundle/skills/hooks/persistence | 当前更像 OpenBuddy manifest/兼容层，不应取代 Pi Extension API |
| 产品壳 | `packages/ui/openbuddy-ui-*`、Electron preload、settings、mail/collaboration/team 等存在 | 这是 OpenBuddy 差异化，不应因 Pi-native 重构而削弱 |

### 3.3 关键规模事实

在当前 checkout 静态统计：`agent-host.ts` 1484 行、`pi-extensions.ts` 1222 行、`electron/main/ipc/index.ts` 1099 行、plugin-host barrel 1348 行；仓库约 2338 个 tracked files。规模本身不是缺陷，但这些文件同时承担生命周期、产品适配、兼容协议、IPC/诊断的迹象说明后续计划必须以模块边界和 owner 为验收，而不是只以“删了多少 LOC”为成功标准。

## 4. Pi 官方能力对照：应该复用什么，不能误用什么

### 4.0 官方资料索引与版本边界

本计划以当前安装的 Pi 官方文档（对应仓库依赖 `@earendil-works/pi-*` 0.85.x）为准，并保留可公开复核的 [pi.dev 文档](https://pi.dev/docs) 与 [pi.dev/packages](https://pi.dev/packages) 链接。文档描述的是能力契约，不等于 OpenBuddy 当前已经实现：

| 官方资料 | 本计划采用的事实 | OpenBuddy 对应代码/差距 |
|---|---|---|
| [Pi 首页](https://pi.dev/) | Pi 是可交互、可 print、可 RPC、可 SDK 嵌入的 coding agent；扩展、skills、packages 是资源边界 | OpenBuddy 选择 in-process SDK + Electron UI；`bin/openbuddy-cli.mjs` 是自有 harness RPC client，不应再复制 Pi agent loop |
| [Pi packages](https://pi.dev/packages) | Package gallery 是生态发现入口；package 的 `keywords: ["pi-package"]`、可选 gallery `image/video` 是分发/发现元数据，不是安全认证 | OpenBuddy 有 marketplace/profile/resource 代码，但必须增加 exact version、来源、hash、license、审核状态和真实兼容等级；不能把 gallery 展示当作已验证 |
| [SDK](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md) | `createAgentSession`、`AgentSession`、`AgentSessionRuntime`、`SessionManager`、`ModelRuntime`、`DefaultResourceLoader`、`defineTool` 是嵌入主面 | `electron/main/agent/agent-host.ts`、`pi-session-runtime.ts`、`host-modules/*` 已使用；需删除重复 session/provider/tool orchestration |
| [Extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) | `registerTool/Command/Shortcut/Flag/Provider`、生命周期事件、tool middleware、context/provider hooks、`ctx.ui` 构成标准插件 ABI | `pi-extensions.ts`、`agent-hooks.ts`、`pi-tool-bridge.ts` 已接入；用户 extension 的权限、撤销、错误和 inventory 仍需产品化 |
| [Packages](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md) | `pi` manifest、`extensions/skills/prompts/themes` convention dirs、glob filters、npm/git/local source、peer dependency 和 project/global scope | `pi-extension-discovery.ts`、profile resource paths、plugin-host 已做兼容层；安装/更新/锁定/回滚必须由 OpenBuddy 完整拥有 |
| [Skills](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md) | Skill 是按需加载的 `SKILL.md` capability package；名称/描述驱动 prompt 暴露，全文在命中后加载；project skill 受 trust 约束 | `pi-bridge/skill-utils.ts`、plugin-host skills、profile paths 已接入；缺产品级推荐、审核、依赖、启停、使用效果和审计 |
| [RPC](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md) | JSONL command/event 协议、steer/follow_up、session/tree/compact、extension UI request/response；TUI-only `custom()` 在 RPC 中降级 | `pi-rpc-ui-context.ts` 与 `bin/openbuddy-cli.mjs` 已覆盖部分语义；需补全命令 parity、cursor/reconnect、timeout/cancel/error contract |
| [Compaction](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md) | 自动/手动 compaction、split turn、branch summary、file tracking、retry 与 `session_before_compact` 可扩展 | OpenBuddy 有 session/summary/telemetry 适配，但必须证明 context/token/cost/恢复 UI，而不是只显示文本结果 |
| [Providers](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md) | Pi provider catalog、custom `models.json`、auth/runtime key、model scope 与 provider request hooks | OpenBuddy 有 provider registry/Settings/attribution；租户、凭据、计费和 provider lifecycle 仍由产品层控制 |
| [Security](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/security.md) | Extensions/skills/packages 具有完整进程权限；project trust 是资源加载前的安全边界 | OpenBuddy 必须把 trust、package review、权限模式、secret redaction、profile rollback 作为默认门禁 |

**官方机制的关键推论：** Pi package 的最小契约是“资源声明 + ExtensionFactory/skill 发现”，不是 OpenBuddy 的四轨业务插件协议；OpenBuddy SDK 应是可选的产品 manifest/适配层，不能替代 `DefaultResourceLoader`、`ExtensionRunner` 或 Pi 原生 package semantics。

### 4.1 Pi 原生能力（优先复用）

| Pi 能力 | 官方依据 | OpenBuddy 计划 |
|---|---|---|
| `createAgentSession`/`AgentSession`/runtime replacement | `docs/sdk.md`：session prompt、steer、followUp、subscribe、model/thinking、compact、abort、tree | 继续作为唯一 Agent 内核；OpenBuddy 只包 adapter |
| `SessionManager` JSONL tree、list/open/fork/clone/tree/labels | `docs/sdk.md` Session Management；`docs/rpc.md` get_entries/get_tree/fork/clone | Pi transcript 作为会话事实；OpenBuddy SQLite 仅保存产品 catalog/state/event/FTS，先完成权威性决策和 shadow compare |
| Extension lifecycle/events | `docs/extensions.md`：`session_start`、`resources_discover`、`before_agent_start`、`context`、provider/tool/message/compaction/tree hooks | 业务 AI 工具、策略、provider metadata 优先写 Pi extension；服务依赖仍走 Cordis |
| Standard tools and `defineTool` | `docs/sdk.md` Tools/Custom Tools | 统一 tool registry，避免 capability service 与 Pi extension 重复注册同名工具 |
| `ctx.ui` RPC-safe interaction | `docs/rpc.md` Extension UI Protocol | 将 select/confirm/input/editor/notify/status/widget 映射到 WorkBuddy UI；TUI-only custom 不直接带入 renderer |
| DefaultResourceLoader / packages / skills / prompts / themes | `docs/packages.md`、`docs/skills.md` | 原生遵循 `pi` manifest、convention dirs、filters、dependencies、trust；安装与审核由 OpenBuddy product layer 管理 |
| reload semantics | `docs/extensions.md` reload；`docs/sdk.md` runtime replacement | 采用事务化 whole-session reload；旧 context 视为 stale，失败保留诊断并不泄漏 listener/service |
| compaction / branch summary | `docs/compaction.md` | 用 Pi 的 summary/file tracking；OpenBuddy 增加 UI/telemetry/cost、失败恢复和验证，不重复造 summarizer |
| provider registration/auth/model scope | `docs/sdk.md` ModelRuntime/auth/model scope；extensions provider hooks | ModelRuntime 单一 owner；OpenBuddy 只做 UI、凭据存储适配、租户与 attribution |
| RPC mode | `docs/rpc.md` | 适合 headless harness/CLI/集成测试；Electron 主链路优先 in-process SDK，不为内部通信再造 NDJSON 协议 |

### 4.2 Pi 不提供、OpenBuddy 必须拥有

- 企业登录、OIDC/SAML/SCIM、租户/组织/RBAC、审计合规。
- 计费、积分/credits、SKU、退款、过期、成本分摊和企业管理员面板。
- WorkBuddy 产品信息架构：Home、Workbench、专家/skill marketplace、邮件、协作、通知、导航、品牌和 onboarding。
- OpenBuddy 的 capability service、邮件/日历/协作/团队/远程网络以及跨租户安全策略。
- 产品 metadata（置顶/归档/专家绑定/工作区标签）及其 SQLite 目录；不能污染 Pi transcript。
- Electron 权限、OS keychain、窗口/更新/签名、公证、跨平台打包。

### 4.3 明确不能做的事情

1. 不把 Pi TUI/Ink 组件直接塞进 React renderer；只适配语义事件和 RPC-safe UI。
2. 不把 OpenBuddy 的企业服务复制成第二套 Pi package backend；同一 capability 必须有一个状态 owner。
3. 不把“Pi 可加载 package”宣称为“第三方功能已交付”；必须区分 discovered、loaded、usable、real-provider verified。
4. 不把 DeepSeek/Harness 兼容层继续扩展成第三个 Agent 内核；只保留必要协议桥并设退役清单。
5. 不把不存在于公开协议的 WorkBuddy 私有云/商业能力推测为已实现；遵循 `docs/workbuddy-parity-matrix.md` 的“不伪造”边界。

## 5. 产品、功能与性能差距

### 5.1 功能差距

| 优先级 | 差距 | 代码/文档依据 | 结果 |
|---|---|---|---|
| P0 | 权限模式、危险工具、项目 trust 的产品语义必须统一 | Pi `tool_call` 可 block/mutate；OpenBuddy 有 `agent-hooks.ts` 与 `pi-rpc-ui-context` | 任何 bypass/plan/dontAsk 等高风险模式必须在 UI、IPC、审计、测试中同名同义 |
| P0 | reload/install/remove/失败恢复要成为用户可理解的闭环 | Pi package/install/reload 文档；OpenBuddy 有 resource/profile transaction 测试 | UI 必须展示 package/version/surface/diagnostic/disabledReason/generation，失败不破坏上一版本 |
| P0 | session transcript、产品元数据、凭据的权威性未形成单一对外契约 | `docs/openbuddy-product-vs-pi.md` 已指出 JSONL/SQLite/Keychain 冲突 | 发布前完成 schema/迁移/冷恢复/双写 shadow compare 决策 |
| P1 | Skills、prompt templates、experts、marketplace 的推荐/安装/启停体验不足以证明 WorkBuddy 产品力 | `docs/skills.md` 提供按需 skill；OpenBuddy 有 marketplace/pi-resources 代码 | 做可发现、可审核、可回滚、可解释的资源中心，不只列文件路径 |
| P1 | compaction/tree/branch/fork 还偏底层 | Pi `docs/compaction.md`、`docs/sdk.md` 有完整机制 | Workbench 展示上下文占用、压缩原因、恢复点、分支差异、成本和失败动作 |
| P1 | 多 agent/team/collaboration 需要与 Pi session/steer/followUp 统一 | OpenBuddy `team-runner.ts`、`subagent-runtime.ts` 存在；Pi SDK有 queue semantics | 一个任务/会话/取消/权限/证据协议，禁止另建消息代理 |
| P1 | 外部 Pi 包兼容性证据分级不一致 | `docs/pi-extension-architecture.md` 有候选包和 verification 叙述；本次未执行真实安装 | 维护 exact-version compatibility matrix，真实 provider 与 fixture 分开统计 |
| P2 | provider catalog、model scope、OAuth/API key 与企业租户/计费关联 | Pi `ModelRuntime` 和 auth 机制；OpenBuddy provider registry | 形成 provider capability/成本/配额/租户归属可审计模型 |
| P2 | CLI/headless/RPC 与桌面 UI 的功能 parity | `bin/openbuddy-cli.mjs` 有 sessions/exec/resume/tail/event-log/abort/wait | 把 CLI/RPC 作为自动化入口，补全 session name/tree/compact/model/thinking 等必要能力 |

### 5.2 性能与稳定性差距

当前仓库**有性能入口但没有本轮可引用的实测结果**：`package.json` 提供 `perf:streaming`、`perf:ipc`、`perf`、`perf:main-chunks`；也有 Electron smoke、closed-loop/eval 脚本。由于 `node_modules` 不存在，本次未安装依赖，未执行这些命令，也未进行真实 provider、Electron build 或多平台运行。因此以下是必须建立的基线，不是当前数值：

| 指标 | 测量定义 | 目标（首版门槛，需以真实基线校准） |
|---|---|---|
| 首次可交互 | app process start → renderer ready | P50 ≤ 3s，P95 ≤ 6s（本地 release build） |
| 首 token 延迟 | prompt accepted → first assistant text delta | 按 provider 分层记录；不得用 mock 混入真实值 |
| token 流延迟 | 相邻 text delta 间隔、UI commit 间隔 | P95 gap、长帧数、renderer dropped update 数 |
| IPC | main send → renderer receive；request round trip | P50/P95/P99，按 payload size 分桶 |
| tool | tool start → update/end；并发工具占用 | 失败率、取消延迟、最大输出截断率 |
| compaction | threshold detected → summary persisted → retry resumed | 记录耗时、token 前后、失败/重试、恢复正确性 |
| reload | idle wait → new extension active | P50/P95，旧 listener 残留=0，失败回滚=100% |
| 内存 | idle、长流、10/100 session、reload 20 次 | RSS/heap/native binding 增长曲线，无线性 listener 泄漏 |
| 崩溃恢复 | kill/restart 后 session/metadata/credential 恢复 | transcript、产品 metadata、event cursor 分层验证 |
| 包生态 | install/load/reload/remove exact package | 时间、失败分类、依赖冲突、回滚成功率 |

性能计划必须输出原始 JSON/CSV、环境（OS/CPU/RAM/Node/Electron/provider/model）、样本数、warm/cold、commit SHA 和脚本版本；没有这些字段的截图或单次日志不能成为性能结论。

## 6. 2.0 分阶段计划

### Phase 0：事实基线与合同冻结（1 周）

**目标**：停止文档与实现漂移，建立唯一能力清单。

- 生成 machine-readable `pi-capability-inventory`：Pi API、OpenBuddy adapter、owner、状态、证据等级、测试入口。
- 为每个 capability 指定唯一状态 owner：session/transcript、metadata、credential、provider、tool、permission、UI、event、billing。
- 为 Pi 版本、Node、Electron、OS、第三方 package 建兼容矩阵；固定精确版本策略，升级必须有 diff/测试。
- 将现有 `OPENBUDDY_PI_NATIVE_PLAN.md`、`pi-core-capabilities.md`、`pi-extension-architecture.md` 中过时版本/“已完成”声明标记为历史或迁移到此计划。

**出口门槛**：所有 P0 capability 有 owner、IPC schema、测试路径、证据等级；不存在“两个模块都拥有同一份 session/tool/provider 状态”的未决项。

**Phase 0/1 的具体命令门禁：** `pnpm typecheck`、`pnpm test`、`pnpm lint:eslint`、`pnpm lint:sheriff`、`pnpm test:electron:ipc-surface`、`pnpm test:closed-loop`；若依赖或桌面环境不可用，必须输出 `not-run` 和原因。Phase 2 的资源门禁至少运行 Pi 资源/扩展相关测试：`pnpm exec vitest run electron/main/agent/pi-resource-loader.test.ts electron/main/agent/pi-extensions.test.ts electron/main/agent/pi-rpc-ui-context.test.ts`。Phase 5 在此基础上运行 `pnpm perf`、`pnpm build`、Electron smoke，并保存原始结果，不允许只报告 exit code。

### Phase 1：Pi 内核与适配层收敛（2–3 周）

**状态：进行中。** 本轮已完成“Pi 官方 AgentSession 事件 → OpenBuddy canonical namespace”这一垂直切片；剩余 runtime 拆分、重复 tool/provider owner 收敛仍未完成。

- 把 `agent-host.ts` 拆成 runtime lifecycle、session facade、event projection、product integration 四块；主 facade 不直接实现业务 capability。
- 将 `pi-extensions.ts` 拆为按域的 builtin registry；每个 extension 明确注册 tool/command/event/provider 哪些面及 dispose/reload 语义。
- 统一 `pi-tool-bridge`、capability tools、MCP tools 的注册/冲突/撤销流程；同名工具拒绝静默覆盖。
- 统一 session event schema，保留 Pi 原始事件 ID/序列；renderer 使用投影 schema，禁止各 IPC handler 自行拼接相似事件。
- 将 Harness/DSH 仅保留为兼容 adapter；新功能不得依赖其 runtime/facade。

**出口门槛**：`sheriff`/cycle/boundary 检查通过；主链路测试覆盖 prompt、tool、abort、steer/followUp、session replacement、reload；旧 runtime 无重复 listener/工具/provider。

### Phase 2：会话、资源与持久化产品闭环（2–3 周）

**目标**：让 Pi 原生 session/resources 成为用户可理解、可恢复的 WorkBuddy 功能。

- Pi `SessionManager` 负责 transcript/tree/fork/clone/labels；OpenBuddy storage 负责 catalog、pin/archive/expert/workspace metadata、产品事件和 FTS，定义同步/恢复协议。
- UI 提供 session tree、branch/fork、compact/recover、context usage、cost/token、last operation 和错误诊断。
- Skill/prompt/theme/package 采用 Pi 原生发现规则；OpenBuddy 负责安装审核、exact pin、依赖检查、禁用、回滚和 inventory。
- 将 `ctx.ui` 的 select/confirm/input/editor/notify/status/widget 全部接入 WorkBuddy；对取消、超时、session replacement、app quit 做统一处理。
- 明确 project trust：只对可信 profile/project 加载动态代码；用户安装包显示来源、版本、权限和 hash。

**出口门槛**：冷启动、重启、session replacement、branch/fork、compaction、package reload/remove 的 E2/E3 验收；产品元数据不丢、Pi transcript 不被产品字段污染。

### Phase 3：安全、企业与成本边界（2–4 周）

**目标**：Pi-native 不牺牲 OpenBuddy 企业产品力。

- 将 Pi `tool_call` block/mutate、folder trust、permission UI、OpenBuddy authorization 统一成单一策略决策链。
- 凭据走 OS keychain/受控 credential store；API key/OAuth 不进入 session、event log、plugin inventory、renderer structured clone。
- provider/model 由 Pi ModelRuntime 执行；OpenBuddy 负责租户、配额、成本、计费 attribution、审计和 provider UI，禁止第二个 model runtime。
- 组织/SSO/RBAC/审计/计费/credits 与 Agent session ID、tool call ID、provider request ID 建可追溯关联。
- 设计风险操作确认、策略拒绝、取消、超时、重试、限流的用户可解释错误。

**出口门槛**：安全负向测试（越权 tenant、跨 workspace、secret 泄漏、恶意 package、危险 bash、取消竞态）；审计链可由 request→session→tool→provider→cost 关联。

### Phase 4：WorkBuddy 产品力与能力闭环（3–5 周）

**目标**：从“能运行 Agent”升级为“值得每天使用的工作台”。

- 完成 onboarding、空状态、Workspace/Home/Chat/Workbench、专家/skill marketplace、邮件/协作等关键用户旅程。
- 对每个 OpenBuddy capability 提供四件套：产品入口、Pi tool/command（若需要）、状态/事件投影、E2/E3 验收。
- Team/subagent/collaboration 统一任务生命周期、共享 context、取消、权限、证据和结果汇总；不允许隐式后台任务。
- 对 third-party Pi packages 提供审核后的 curated profile：显示兼容等级（discovered/loaded/usable/real verified），不用“安装成功”冒充功能完成。
- CLI/RPC 提供自动化和远程集成所需的 session、prompt、stream、abort、tree、compact、model、diagnostic 能力。

**出口门槛**：新用户首次成功对话、创建/恢复工作区、安装/禁用 skill、执行 tool、遇到权限拒绝、压缩恢复、导出结果的完整 journey smoke；桌面与 CLI/RPC 的核心结果一致。

### Phase 5：性能、跨平台与发布门禁（持续，首轮 2 周）

**目标**：把“性能好/稳定/可发布”变为可重复证据。

- 实现并固定 streaming/IPC/reload/memory/session/package benchmark harness；冷/热启动、长流、并发 tool、100 session、20 次 reload、断网/限流/重启均纳入。
- 为 macOS/Windows/Linux 建相同 smoke contract；签名、公证、AppImage/NSIS/MSI/DMG 构建结果有 artifact audit。
- 将 `pnpm typecheck`、`pnpm test`、`pnpm build`、Electron smoke、IPC surface、storage boundary、closed-loop eval、performance regression 纳入 release profile。
- 设回归门槛：P95、错误率、内存增幅、reload rollback、tool duplicate、event gap、session recovery，不达标不得以“功能已完成”发布。

**出口门槛**：E4 benchmark 报告与 artifact 可追溯到 commit；至少一个真实 provider 和一个 exact-version 外部 Pi package 完成 E3；所有平台发布 job 有可下载产物和校验摘要。

## 7. Pi 插件与生态策略

### 7.1 插件分类

1. **Native Pi extension**：只注册 Pi tools/commands/events/providers/resources，直接遵循官方 `ExtensionAPI`、`pi` manifest、skills/package 规则。
2. **OpenBuddy capability adapter**：第三方功能与现有 OpenBuddy service 重叠时，只注册薄 command/tool facade，状态、凭据、策略和事件仍由 canonical service 拥有。
3. **OpenBuddy product plugin**：需要 Cordis、企业策略或 React slot 的能力，使用 OpenBuddy manifest，但其 Agent 面仍以 Pi extension 方式接入。
4. **Unsupported/TUI-only**：依赖 terminal custom component、PTY 或隐式全局状态的插件，不默认加载，必须有 WorkBuddy adapter。

### 7.2 安装与运行规则

- exact version + lockfile/hash + license/security review；默认不执行未知 lifecycle scripts。
- profile transaction：先解析/验证/加载候选，再切换；失败恢复旧 profile，保留 diagnostics。
- Pi reload 是 whole-session extension runner reload，不宣传“单文件热卸载”；旧 context 一律视为 stale。
- 包 inventory 只暴露安全元数据：name/version/source/surfaces/loaded/diagnostics/disabledReason，不暴露 secrets、任意包输出或 live Electron 对象。
- 第三方包必须通过 headless/RPC-safe 检查；`ctx.ui.custom()`、终端组件、外部编辑器行为不得未经适配进入桌面产品。

### 7.3 `pi.dev/packages` 生态接入决策表

以下不是“推荐安装清单”，而是对 Pi package 机制的产品化落地规则。先验证包的 manifest、入口、依赖和 UI 假设，再决定 native/adapter/不加载；所有版本必须精确锁定。

| 包生态面 | Pi 官方机制 | OpenBuddy 当前对应 | 2.0 差距与动作 | 验收 |
|---|---|---|---|---|
| Package discovery | gallery/`pi-package` metadata + `pi` manifest/convention dirs | profile marketplace、`pi-package-installed`、`pi-resource-loader.test.ts` | 分离 discover/install/load/usable；显示 package source/version/hash/diagnostics | fixture + exact package E2 |
| Extension | `pi.extensions` 指向 TS/JS；factory 注册 tools/commands/events | `pi-extension-discovery.ts`、`pi-extensions.ts`、plugin SDK serializer | 原生 package 不再被强制转成 Cordis bundle；extension errors 进入 inventory | load/reload/remove + failure rollback |
| Skills | `skills/`、SKILL.md frontmatter、渐进披露 | `pi-bridge/skill-utils.ts`、plugin-host `skills.ts` | 加 trust、描述质量、冲突、来源、启停和使用 telemetry；禁止把 skill 全文常驻 prompt | discovery + selected skill execution |
| Prompt templates | `prompts/*.md`，slash command expansion | `pi-resources`/profile paths，CLI 目前主要是 agent commands | 将 prompt/template inventory 暴露给 Workbench；命令源、参数和版本可诊断 | `/template`/RPC parity |
| Themes | `themes/*.json`，资源发现 | renderer 自有 theme/UI packages | 不把 TUI theme 当 React theme；做语义 token adapter，保留 WorkBuddy design system | visual contract + no Node import |
| Dependencies | runtime deps 放 `dependencies`；Pi 核心包宜 peerDependencies；安装可能执行 npm install | root workspace dependencies + profile materialization | profile installer 必须锁版本、审依赖、禁止未授权 lifecycle script，记录 resolved graph | dependency conflict/rollback |
| Filters/scope | package manifest + settings filters、global/project precedence、dedupe | profile overrides/resource paths | 完整保留 `*`,`**`,`!`,`+`,`-` 和 scope precedence；不能用“整个目录扫描”替代 | filter matrix |
| UI assumptions | `ctx.ui` 对话在 RPC 可用；`custom()`/TUI component 不可直接移植 | `pi-rpc-ui-context.ts`、WorkBuddy React UI | package compatibility 标记 headless-safe/rpc-safe/tui-only；tui-only 默认禁用 | UI request timeout/cancel |
| Security | package code/skill 可执行任意系统动作；trust 与 review 必需 | profile/plugin governance 分散在 host/profile | 加安装前展示 permissions、来源、hash、license、审计记录；失败/撤销可恢复 | malicious fixture + redaction |
| Marketplace | pi.dev/packages 是发现/展示生态 | OpenBuddy 有 marketplace cache/同步测试 | 不抓取或执行未知包作为默认行为；curated registry 与用户自带 package 分开 | catalog freshness + manual approval |

### 7.4 官方扩展事件到 OpenBuddy 产品事件映射

| Pi event/hook | OpenBuddy 用途 | 当前代码线索 | 必补产品指标 |
|---|---|---|---|
| `session_start/shutdown/info_changed` | session readiness、名称、资源生命周期 | `pi-session-runtime.ts`、session event bridge | startup/reload duration、stale context、dispose result |
| `input/before_agent_start/context` | 输入路由、产品上下文、压缩前过滤 | `agent-hooks.ts`、prompt modules | prompt accepted/rejected、context bytes/tokens、redaction |
| `tool_call/tool_result` | 权限拦截、参数审计、结果投影 | `agent-hooks.ts:tool_call`、`pi-tool-bridge.ts` | blocked/allowed/error/cancel latency、duplicate tool registration |
| `before_provider_headers/request/after_provider_response` | tenant/request attribution、provider diagnostics | model bridge/provider registry | first token、status/retry/rate-limit、cost attribution；不得记录 secret |
| `session_before_compact/compact_failed` | context pill、恢复 UX、压缩告警 | compaction facade/telemetry modules | tokens before/after、summary latency、retry/failure、data loss=0 |
| `resources_discover/model_select` | package/model inventory and settings UX | resource loader/provider registry | active source/version、model scope、provider availability |
| `ctx.ui.*` / RPC extension UI | React dialog/status/widget adapter | `pi-rpc-ui-context.ts` | timeout/cancel、user decision latency、no orphan request |

每一条事件映射必须保留 Pi 原始 event name、session ID、generation/sequence 和 OpenBuddy projection type；禁止仅依赖字符串标题在 renderer 推断状态。

## 8. 验收矩阵

| 主题 | 必须验证 | 证据 |
|---|---|---|
| Agent 基础 | prompt、多轮 stream、tool call、tool update、abort、error、retry | E2 + 真实 provider E3 |
| Session | list/open/resume/new/fork/clone/tree/label/metadata/restart | E2；冷恢复 E3 |
| Context | auto/manual compact、branch summary、context usage、失败/重试 | E2，长上下文 E3 |
| Extension | builtin/user/package extension load、command/tool/provider、dispose/reload | E1/E2；外部包 E3 |
| UI | select/confirm/input/editor/notify/status/widget、cancel/timeout | E2，renderer smoke |
| Safety | trust、permission、危险工具、secret redaction、tenant boundary | 负向测试 + E3 |
| Product | onboarding、workspace、expert/skill、mail/collab、billing/admin | product journey smoke |
| Transport | preload IPC、loopback RPC、CLI event cursor、reconnect/backpressure | IPC contract + E2 |
| Performance | startup/TTFT/stream/IPC/tool/reload/memory/compaction | E4 |
| Release | typecheck/test/build/sign/package/OS smoke | CI artifact + hash |

## 9. 立即执行顺序（不改业务实现的前提下）

1. 将本文件作为路线主索引；给既有 Pi 文档加版本/状态/证据等级，消除“目标/已实现/历史”混写。
2. 先做 Phase 0 inventory 与 owner 决策，再做 Phase 1 拆分；不先扩展新插件市场。
3. 在任何性能结论前安装锁定依赖并运行 `pnpm perf`、`pnpm typecheck`、`pnpm test`、Electron smoke；记录“未运行原因”而不是填估算值。
4. 先验证已有 Pi reload/RPC/session fixtures，再选一个最小外部 Pi package 做 E3；不要批量安装未知第三方包。
5. 以 Phase 2 的 session/metadata/credential 分层为数据基础，再推进 marketplace、team 和 enterprise 产品闭环。

## 10. 非目标与风险

### 非目标

- 本计划不在 OpenBuddy 内复制 Pi 的 Agent loop、SessionManager、ModelRuntime、ExtensionRunner、compaction 或标准资源发现。
- 不承诺复刻未公开的 WorkBuddy 私有云/商业协议，不根据名称推断其内部实现。
- 不把所有 Cordis service 强行改成 Pi extension；持久化、企业策略、跨 surface capability 仍可由 OpenBuddy service 拥有。
- 不因“Pi-native”删除 WorkBuddy 产品 UI、企业控制面板、邮件/协作等差异化能力。

### 主要风险与缓解

| 风险 | 缓解 |
|---|---|
| Pi 上游 API/类型变化 | 精确版本、compat matrix、升级 diff、contract tests |
| 两套状态源不一致 | 明确 transcript/metadata/credential owner，shadow compare 与迁移回滚 |
| 第三方扩展任意代码风险 | trust、review、pin/hash、权限显示、隔离/禁用、失败回滚 |
| renderer/main 事件丢失或积压 | 单一事件 schema、序列/cursor、背压/采样、重连基线 |
| 全 session reload 造成 UX 中断 | idle barrier、generation fence、readiness 状态、旧版本恢复 |
| “功能已完成”被 fixture 夸大 | 强制 E0–E4 证据等级，真实 provider/package 单独验收 |
| 继续膨胀 Harness/桥接层 | 新代码 Pi-first；DSH 仅 adapter；每阶段检查 owner/依赖方向 |

## 12. 本轮实际实现与证据

### 12.1 已实现：Pi 事件 canonical namespace

Pi 官方 `AgentSession`/Extensions 事件包含 session、agent、turn、message、tool、model、context、provider、resource、queue、retry、compaction 等多个事件族。此前 `plugin-event-bus.ts` 只对少数生命周期事件提供 canonical alias，其余事件只能依赖通用 `eventNamespace()`，导致 renderer/plugin consumers 无法稳定按官方能力域订阅。

本轮在 `electron/main/agent/host-modules/plugin-event-bus.ts` 补齐并固定以下映射：

- session：`session_info_changed`、`session_before_switch`、`session_before_fork`、`session_before_compact`、`session_compact`、`session_compact_failed`、`session_before_tree`、`session_tree`；
- agent/context/resources：`input`、`context`、`before_agent_start`、`resources_discover`；
- model/provider：`thinking_level_select`、`before_provider_headers`、`before_provider_request`、`after_provider_response`；
- tool/queue/retry/compaction/UI：`tool_call`、`tool_result`、`queue_update`、`compaction_start`、`compaction_end`、`auto_retry_start`、`auto_retry_end`、`extension_error`、`ui_prompt_start`、`ui_prompt_end`。

新增 `electron/main/agent/host-modules/plugin-event-bus.test.ts`，共 16 个断言，覆盖 canonical mapping 与未知事件的稳定 fallback。实现不改变 Pi 原始事件、不改变旧 namespace，只增加 canonical alias，属于低风险兼容增强。

### 12.2 校验与同步证据

- 同步：`git fetch origin && git rebase origin/main` 成功；`origin/main` 从 `f673e1e` 更新到 `ffd8c5c`；无冲突、未执行 force push、未推送 main。
- 测试：`pnpm exec vitest run electron/main/agent/host-modules/plugin-event-bus.test.ts --reporter=dot`，16/16 通过。
- 静态校验：`git diff --check` 通过；新增测试引用的实现路径存在。
- 依赖：为运行 targeted test 执行了 `pnpm` workspace 安装，锁定依赖安装成功；未修改业务依赖声明/lockfile。
- 尚未运行：完整 typecheck/build/full test/Electron smoke/真实 provider E3；这些仍是 Phase 1/5 后续门禁。

### 12.3 计划状态更新

- **已实现**：Phase 1 的事件 canonicalization 垂直切片；对应 §4.1 的“事件/流式”与 §7.4 的 Pi event mapping。
- **已实现**：Phase 1 的 generation-fenced event replay：reload 后 `PiSessionEventBridge.snapshot()` 仅返回当前 generation 事件，避免 stale session/plugin events 回放到 renderer；新增/更新测试覆盖。
- **已实现**：Phase 1 的 Pi RPC/UI 生命周期事件 canonicalization：`extension_error`、`ui_prompt_start`、`ui_prompt_end` 统一映射并有定向测试。
- **已实现**：Phase 1 的 Pi→Main 事件背压切片：复用 `@openbuddy/plugin-host` 的 `BoundedEventQueue`，对 `tool_execution_update` 进度事件按 session/kind 合并，snapshot 时刷新；lifecycle/final/error 等事件仍直接进入 ring buffer。
- **本轮完成**：E4 长时/高样本基线与 Electron loader 隔离：streaming 以 100,000 iterations、IPC 以 10,000 samples × 100 ops/sample 运行；补充 session lifecycle/metadata reload recovery 定向测试。`electron/main/index.ts` 将 main entry 自有 `__filename`/`__dirname` 改为 `mainFilename`/`mainDirname`，避免 Rollup 合并依赖模块时与依赖内部同名 binding 冲突。
- **验证完成**：streaming、IPC、main chunk/memory benchmark 均真实运行并写入 `evidence/perf/`；构建后 `out/main/index.js` 不再包含 entry 自有重复 `__filename` binding；typecheck/build 和 44 个定向测试通过。
- **桌面门禁仍阻塞**：重新运行 stream-port smoke 后 loader 的 `__filename` 冲突已不再出现，但环境缺少 `$DISPLAY`/X server，Electron 在初始化 X11 时退出；未绕过 smoke 安全门禁或使用真实凭据。


### 12.4 总体进度

进度按本计划 6 个阶段、18 个可验收垂直切片统计：已完成 10 个切片（前 9 项、以及 E4 长时 benchmark 基线与 Electron loader 隔离修复），因此当前**实现进度约 56%（10/18）**。该百分比仅表示代码/验证垂直切片完成度，不代表产品发布完成度；完整 Electron smoke、真实 provider 网络调用和跨平台发布门禁仍未完成。

### 12.12 本轮增量：ContextUsagePill 组件级验收门禁与 E4 基线

新增 `packages/ui/openbuddy-ui-conversation/src/__tests__/ContextUsagePill.test.tsx`，在真实 React/jsdom 测试环境中 mock 现有 Pi client bridge，仅提供本地 context 快照 fixture，不调用 provider 或使用凭据。覆盖：

- `pi/context`、`pi/context-status`、`pi/context-compacted`、`pi/context-compaction-requested` 事件均触发权威 `agent:session-info` 重新读取；
- unmount 后取消 `agentOnPluginEvent` listener，late event 不再触发 IPC；
- agent reload/refresh rejection 时保留最后有效 pill 快照；
- sessionId reload 时清除旧快照并显示新 session 的真实读取结果。

验证证据：`pnpm exec vitest run packages/ui/openbuddy-ui-conversation/src/__tests__/ContextUsagePill.test.tsx electron/main/agent/pi-extensions.test.ts --reporter=dot`：2 files、42/42 通过；`pnpm exec vitest run electron/main/__tests__/session-lifecycle-pi.test.ts electron/main/__tests__/session-metadata-pi.test.ts --reporter=dot`：2 files、5/5 通过；`pnpm perf:streaming`：完成 streaming/token/memory 基线并写入 `evidence/perf/streaming-bench-2026-09-10T02-06-22-479Z.json`；`pnpm perf:ipc`：完成 5000 samples IPC validation baseline 并写入 `evidence/perf/ipc-latency-1789005981850.json`；`pnpm perf:main-chunks`：完成 bundle chunk baseline；`pnpm typecheck`：通过。

Electron smoke 尝试及结果：`pnpm test:electron:ipc-surface` 无法启动 Playwright Electron；`pnpm test:electron:stream-port` 启动失败，记录 `Identifier '__filename' has already been declared`，同时环境无 `$DISPLAY`/X server；`pnpm test:electron:real-ui` 按脚本安全门禁退出，要求 `OPENBUDDY_E2E_REQUIRED=1` 与临时 provider credentials。本轮不绕过门禁、不调用真实 provider。复现命令即上述三条；在具备桌面 display、修复 Electron loader 冲突并提供临时测试凭据后再执行。



## 13. 本版完成定义

- Pi 是唯一 Agent/session/model/extension runtime；OpenBuddy 没有重复内核。
- OpenBuddy 产品能力有明确 owner，企业/工作台差异化未被 Pi 抽象吞掉。
- 用户可以从安装/信任/配置到 prompt、tool、权限、session、压缩、恢复、插件诊断完成闭环。
- reload、package、RPC、IPC、session recovery 在失败和取消场景可解释、可恢复。
- 至少一个真实 provider、一个真实外部 Pi package、三平台发布链路达到对应 E3；性能达到 E4。
- 所有结论能回到代码、测试、原始 benchmark 或 CI artifact；文档不再把计划、fixture 和真实生产证据混为一谈。

### 12.13 本轮增量：E4 长时 benchmark 与 Electron loader 隔离

本轮不使用 provider 凭据、不伪造 provider 结果，运行可在本地完成的高样本/长时基线：

- `node scripts/perf/streaming-bench.mjs --iterations=100000 --inner=500 --json evidence/perf/streaming-bench-2026-09-10T02-14-29-419Z.json`：delta reducer 0.398 µs/iter，token estimator 22.677 µs/iter，tool-card materialize 1000 msgs 80.092 µs/iter，1000-message heap baseline 1.05 MB，60fps headroom 16.63 ms；原始 JSON 已写入 `evidence/perf/streaming-bench-2026-09-10T02-14-29-419Z.json`。
- `node scripts/perf/ipc-latency.mjs --iterations=10000 --inner=100 --json evidence/perf/ipc-long-20260910T021431Z.json`：使用 real transpiled validator；`session.list` mean 0.511 ms/sample（约 0.00511 ms/op），`plugin.snapshot` mean 0.520 ms/sample（约 0.00520 ms/op）；原始 JSON 已写入 `evidence/perf/ipc-long-20260910T021431Z.json`。
- `pnpm perf:main-chunks`：完成当前 main entry/chunk 体积基线；`pnpm exec vitest run electron/main/__tests__/session-lifecycle-pi.test.ts electron/main/__tests__/session-metadata-pi.test.ts electron/main/agent/pi-extensions.test.ts --reporter=dot`：3 files、44/44 通过。
- loader 隔离：`electron/main/index.ts` 原先的 entry-level `const __filename`/`__dirname` 改为 `mainFilename`/`mainDirname`，避免 bundled dependency 也声明 `__filename` 时产生 ESM duplicate binding。`pnpm build`、`pnpm typecheck` 均通过；构建产物检查 `rg -n "const __filename|var __filename|__filename =" out/main/index.js` 不再发现 entry 重复 binding。

Electron 复验：`pnpm test:electron:stream-port` 已重新运行，之前的 `Identifier '__filename' has already been declared` 不再出现；当前唯一明确阻塞为 `[ERROR:ui/ozone/platform/x11/ozone_platform_x11.cc:257] Missing X server or $DISPLAY`，Electron 随后 SIGTRAP 退出。`pnpm test:electron:ipc-surface` 同样无法启动 Playwright Electron。`pnpm test:electron:real-ui` 仍按设计要求 `OPENBUDDY_E2E_REQUIRED=1` 与临时 provider credentials，本轮不绕过该门禁。复现命令已记录为上述三条。

### 12.14 本轮增量：跨平台发布 preflight 与桌面 runner 诊断

新增 `scripts/release-preflight.mjs` 和 `pnpm release:preflight`。该门禁是无凭据、无网络的本地静态/产物检查，不执行签名、公证、发布、provider 调用或 GitHub 写入：

- 检查 `out/main/index.js`、`out/preload/index.cjs`、`out/renderer/index.html`、`electron-builder.yml` 和 release workflow 存在；
- 检查 Windows NSIS、macOS DMG、Linux AppImage 三个 release job/target、CI typecheck/test/build、artifact upload 和 GitHub publish contract；
- 对三个已构建输入生成 SHA-256 digest，记录版本、平台、架构和安全策略；
- 检查本地是否具备 `DISPLAY`/`WAYLAND_DISPLAY`，明确报告桌面 smoke 是否 ready；real provider credentials 仍保持 opt-in，不被 preflight 消费。

真实运行：`pnpm release:preflight --json=evidence/release/release-preflight-local.json` 通过 release/build checks，报告 `ok: true`、`desktopSmokeReady: false`；本机 `Linux x64` 无 `DISPLAY`/`WAYLAND_DISPLAY`，因此只记录阻塞而不伪造 smoke 结果。报告被 `.gitignore` 的 `evidence/` 规则忽略，命令和 schema 可复现。

附加验证：`pnpm exec vitest run scripts/audit-enterprise-release.test.mjs electron/main/agent/pi-extensions.test.ts --reporter=dot`：2 files、48/48 通过；`pnpm typecheck`：通过；`git diff --check`：通过。跨平台实际签名/公证/installer 运行仍必须在 GitHub Actions 对应 Windows/macOS/Linux runner 执行，不能在当前 Linux 无桌面环境中宣称完成。

### 12.15 本轮增量：runner 矩阵与推送状态审计

扩展 `scripts/release-preflight.mjs` 的无网络检查，显式验证 release workflow 的 runner 矩阵：Windows `windows-latest`、macOS `macos-latest`、Linux `ubuntu-latest`，并保留签名/公证仅在 CI secrets 可用时执行的边界。这样本地 Linux preflight 只证明 release contract 和构建输入完整，不把本机结果冒充跨平台 installer/sign/notarization 结果。

本轮真实验证：`pnpm build` 通过；`pnpm release:preflight --json=evidence/release/release-preflight-push-audit.json` 通过（`ok: true`，`desktopSmokeReady: false`，当前无 `DISPLAY`/`WAYLAND_DISPLAY`）；`pnpm exec vitest run scripts/audit-enterprise-release.test.mjs electron/main/agent/pi-extensions.test.ts --reporter=dot` 为 2 files、48/48 通过；`pnpm typecheck` 通过；`git diff --check` 通过。preflight JSON 位于被 `.gitignore` 忽略的 `evidence/`，不纳入提交。

推送审计（本轮交付前后均确认）：当前分支 `agent/dfw-backend/0a7abd90eef6`；远端 `origin/agent/dfw-backend/0a7abd90eef6`；HEAD `56d7030b37125196cb8289299e32639ea6ff6515`；远端同值；`git rev-list --left-right --count HEAD...origin/agent/dfw-backend/0a7abd90eef6` 为 `0 0`。本轮未推送 main、未 force push、未覆盖未提交改动。

### 12.16 本轮增量：Pi runtime reload failure recovery

扩展 `PiRuntimeCoordinator` 的官方 Pi session/resource-loader reload adapter：reload 失败现在通过可选 `onReloadError(error, reason)` 诊断回调显式报告，generation 不会在失败时前进；串行 tail 会在失败后恢复为可用状态，后续 reload 仍可执行并在成功后推进 generation。这样不会把失败包装成成功，也不会让一次 Pi `AgentSession.reload()` 异常毒化后续 profile/plugin reload。

新增定向测试覆盖：第一次 session reload 失败时错误和 reason 可观测、generation 保持旧值；第二次 reload 成功、generation 正确推进，证明 recovery queue 可继续工作。验证：`pnpm exec vitest run electron/main/agent/pi-runtime-coordinator.test.ts electron/main/agent/pi-event-bridge.test.ts --reporter=dot`：2 files、14/14 通过；`pnpm typecheck`：通过；`pnpm build`：通过；`git diff --check`：通过。未使用真实 provider、凭据或桌面 smoke。

### 12.17 本轮增量：reload failure → Pi observability/UI bridge

将 `PiRuntimeCoordinator.onReloadError` 接入 `agent-host.ts` 的既有 `emitPluginEvent` 链路，失败时发布 `pi/reload-failed`，携带 `reason`、错误字符串、当前 generation 和稳定 diagnostic 标识。该事件沿现有 `openbuddy://plugin-event` forwarded event bridge 到 renderer/plugin consumers，未新增第二套 transport，也不泄漏凭据或 provider payload；成功 reload 仍按既有 `onReload` generation fence 工作。

非桌面验证：`pnpm exec vitest run electron/main/agent/pi-runtime-coordinator.test.ts electron/main/__tests__/pi-observability-events.test.ts electron/main/agent/host-modules/bootstrap/wire-forwarded-events.test.ts --reporter=dot`：3 files、13/13 通过；`pnpm typecheck`：通过；`pnpm build`：通过；`git diff --check`：通过。桌面 smoke 未运行：当前环境没有 X server/Wayland，继续保留现有 smoke 安全门禁。

### 12.18 本轮增量：renderer/plugin consumer 闭环

在现有 `openbuddy://plugin-event` consumer `startRendererPluginEventBridge` 中增加 `pi/reload-failed` 专用状态投影：renderer runtime 继续先广播原始事件，同时提取并校验 `reason`、`error`、`generation`，记录 `pi-reload-failed` renderer diagnostic，并发布 `renderer/pi-reload-failed` 给 renderer/plugin consumer。该状态只消费现有 Pi observability bridge，不新增 transport；后续 `profile/reloaded` 事件仍按现有 recovery 路径触发 profile refresh，失败状态不会阻塞下一次事件。

新增非桌面恢复测试：注入 `pi/reload-failed` 后断言 consumer 收到规范化失败状态，再注入后续 `profile/reloaded`，验证 bridge 仍可继续处理恢复事件。验证：`pnpm exec vitest run src/lib/__tests__/renderer-plugin-runtime.test.ts electron/main/agent/pi-runtime-coordinator.test.ts electron/main/__tests__/pi-observability-events.test.ts --reporter=dot`：3 files、40/40 通过；`pnpm typecheck`：通过；`pnpm build`：通过；`git diff --check`：通过。桌面 smoke 仍未运行，继续受 X server/Wayland 安全前置条件约束。

### 12.19 本轮增量：Pi reload failure 用户恢复闭环

新增 `PiReloadFailureBanner` 组件并从 `@openbuddy/ui-conversation` 导出：消费 renderer runtime 的 `renderer/pi-reload-failed` 状态，显示失败原因/错误和 Retry 按钮；Retry 直接调用现有 Pi `reloadPiExtensions()` adapter，成功后清除状态，失败后保留 banner 并显示最新错误；重复点击在 in-flight 期间被禁用/去重，避免重复 reload。`profile/reloaded` 与 `pi/extensions-reloaded` 事件仍可清理失败状态。

非桌面组件测试覆盖：失败状态呈现与真实 adapter 成功恢复、重复点击只产生一次 reload、reload 再失败时 affordance 保留且可再次操作。验证：`pnpm exec vitest run packages/ui/openbuddy-ui-conversation/src/__tests__/PiReloadFailureBanner.test.tsx --reporter=dot`：3/3 通过；`pnpm typecheck`：通过；`pnpm build`：通过；`git diff --check`：通过。未新增 transport、未使用真实凭据、未伪造桌面 smoke。

### 12.20 本轮增量：reload failure 真实 conversation UI 接入

将 `PiReloadFailureBanner` 接入 `ChatView` 的 composer 输入栈，故障发生时在真实 conversation UI 中展示，而非仅作为孤立组件。补充 WorkBuddy `--wb-*` 视觉令牌样式：危险态边框/背景、响应式窄屏布局、可见 focus ring、禁用/进行中状态和错误文本截断。无障碍契约使用 `role="alert"`、`aria-live="assertive"`、Retry 按钮 `aria-busy` 与 `aria-describedby`，并增加组件可访问性断言。

验证：`pnpm exec vitest run packages/ui/openbuddy-ui-conversation/src/__tests__/PiReloadFailureBanner.test.tsx --reporter=dot`：3/3 通过；`pnpm typecheck`：通过；`pnpm build`：通过；`git diff --check`：通过。未新增 transport、未使用真实凭据、未伪造桌面 smoke。当前垂直切片进度更新为 **15/18，约 83%**。后续仍需桌面 runner 上的真实 session reload/IPC smoke、跨平台 installer/sign/notarization、真实 provider E3 与长期 benchmark 证据。

### 12.21 本轮增量：桌面 runner preflight/诊断增强

当前执行环境确认无 `$DISPLAY`、无 `$WAYLAND_DISPLAY`，因此没有绕过门禁运行 Electron smoke，也没有设置 `OPENBUDDY_E2E_REQUIRED` 或使用 provider 凭据。增强 `scripts/release-preflight.mjs`：验证 IPC surface、stream-port、real-ui 三个 smoke entrypoint 及 real-ui 的 `OPENBUDDY_E2E_REQUIRED` 合约；报告当前平台/架构、CI 标识、display 可用性、runner 推荐、完整待执行命令和凭据策略；`desktopSmokeReady` 只有 display 与 smoke contract 同时满足才为 true。

真实本地运行：`pnpm release:preflight --json=evidence/release/release-preflight-runner-diagnostics.json`，结果 `ok: true`、`desktopSmokeReady: false`、`desktopRunner.smokeContractPresent: true`、`displayAvailable: false`。该证据明确区分静态 release gate 通过与桌面 smoke 未执行，后续在 Linux desktop runner 执行 `pnpm test:electron:ipc-surface`、`pnpm test:electron:stream-port`，再按批准临时 credentials 门禁执行 `pnpm test:electron:real-ui`。当前进度更新为 **16/18，约 89%**；剩余跨平台 installer/sign/notarization 真实 runner 结果、桌面 smoke 和真实 provider E3。

### 12.22 本轮增量：跨平台 installer/sign/notarization CI contract 门禁

在不读取或验证任何 secret 值、不伪造签名/公证结果的前提下，扩展 `scripts/release-preflight.mjs` 的静态 contract gate：逐项验证 Windows NSIS 构建与 `.exe` artifact、macOS Developer ID/App Store Connect secret import、`CSC_LINK`/`APPLE_API_KEY` 临时路径注入、hardened runtime + notarize、Linux AppImage artifact、三平台构建汇聚后才允许 publish，以及三平台 artifact naming contract。报告显式记录 `credentialPolicy`，本地只确认 workflow/config wiring，不宣称真实签名成功。

真实定向验证：`pnpm release:preflight --json=evidence/release/release-preflight-ci-contract.json` 通过，`ok: true`、新增 `release:installer-signing-contract: true` 与 `release:artifact-contract: true`；当前 `desktopSmokeReady: false` 仍准确反映无 display。`pnpm typecheck`、`pnpm build`、`git diff --check` 通过。当前进度更新为 **17/18，约 94%**。

阻塞/后续：真实 Windows NSIS、macOS Developer ID 签名与 notarization、Linux artifact 运行必须由对应 CI runner 产生；真实 provider E3 仍需安全临时 fixture/凭据，不能以静态 contract 代替运行证据。下一步在专用 runner 收集 artifact/hash、安装/启动和签名公证验证结果。

### 12.23 本轮最终切片：provider E3 无凭据 fixture contract 与阻塞证据

当前仍无桌面 display，且没有批准的临时 provider credentials，因此本轮不执行真实 provider/桌面 smoke，不把 fixture 结果冒充真实 E3。新增 `scripts/provider-e3-fixture-preflight.mjs` 与 `pnpm provider:e3:fixture`：在内存中真实运行 provider 生命周期 contract，覆盖多 provider attribution、unregister 隔离、变更事件、注册失败 rollback、原始错误传播和 clean dispose；同时检查零网络调用、拒绝 ambient credential，并输出 `evidence/provider/provider-e3-fixture.json`。

真实定向运行：`pnpm provider:e3:fixture --json=evidence/provider/provider-e3-fixture.json`，结果 `ok: true`、`evidenceLevel: E3-fixture`、`realProvider: false`、`realNetwork: false`、`credentialsUsed: false`、全部 8 项检查通过；报告明确 `blockedRealProviderE3: true` 及可复现 blocker。`pnpm typecheck`、`pnpm build`、`git diff --check` 通过。

本轮计划进度达到 **18/18，约 100%（代码/contract 切片完成）**；发布/验收状态仍不是“所有外部结果已完成”：真实桌面 session reload/IPC、Windows NSIS、macOS 签名/公证、Linux artifact 运行和真实 provider E3 必须分别由专用 runner/安全临时凭据产生，后续计划保留这些阻塞项并严格区分 E3-fixture 与 real E3。

### 12.24 验收状态维护：阻塞证据复核（不重复计数）

按验收要求复核当前发布状态：本机仍为 Linux x64，无 `$DISPLAY`/`$WAYLAND_DISPLAY`，`OPENBUDDY_E2E_REQUIRED` 未设置；没有专用 Windows/macOS runner 或批准的临时 provider credentials。因此没有新增或重复计算 18/18 代码/contract 切片，也没有宣称真实桌面、签名/公证、产物安装或 real-provider E3 完成。

复核命令：`node scripts/provider-e3-fixture-preflight.mjs --json=evidence/provider/provider-e3-fixture-audit.json`（E3-fixture 8/8，`realProvider:false`、`blockedRealProviderE3:true`）；`node scripts/release-preflight.mjs --json=evidence/release/release-preflight-audit.json`（静态 contract `ok:true`、`desktopSmokeReady:false`）。这些是新生成的本地审计证据，不改变完成百分比。后续操作手册保持为：取得专用 runner 后依次执行 IPC/stream smoke、各平台 installer/artifact 验证；取得批准临时 credentials 且满足 E2E 门禁后才执行 real-ui/provider E3，并分别记录 real 结果。
