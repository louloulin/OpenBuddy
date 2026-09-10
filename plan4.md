# OpenBuddy WorkBuddy 开源版：Pi 原生微内核与插件化落地计划（Plan 4）

> 版本：plan4 · 日期：2026-09-09 · 适用仓库：`louloulin/OpenBuddy`
>
> 本文是执行计划，不是业务代码设计的替代品。所有“已具备”均指本次审阅在仓库中找到的代码、脚本或文档证据；所有“目标”必须经过对应的退出标准验证后才能改为完成。若历史文档与代码冲突，以当前代码、测试和构建结果为准。

## 1. 执行摘要

OpenBuddy 不应继续演化成一个复制 Agent Runtime 的“大单体”，也不应把 Pi、Cordis、Harness、Renderer 四套运行时强行伪装成一个热插拔系统。最优路径是：

- **Pi 是 Agent Kernel**：负责 AgentSession、模型/Provider、工具运行、会话树、资源加载、skills/prompts/themes、compaction、扩展生命周期和 Agent 事件。
- **OpenBuddy 是 Workbench Product Kernel**：负责 Electron 生命周期、typed IPC、任务/项目/空间/产物/权限/自动化等产品实体，以及 WorkBuddy 级 UX。
- **Cordis 是 Service Kernel**：负责长期运行的领域服务、依赖注入、跨 surface 能力和可回滚的服务生命周期。
- **插件是唯一扩展单位**：插件通过稳定 manifest 声明 Pi、Cordis、renderer、remote、typert、bundle 等 surface；由注册表、权限、健康度和事务协调器统一治理。
- **Pi 原生不等于 Pi API 全包**：Pi 只拥有 Agent Runtime 边界；不能用 ExtensionRunner 代替任务数据库、UI 状态机、权限策略、远程 RPC 或 Electron 安全边界。
- **性能来自边界减少和数据流控制**：进程内 Pi、增量事件、批量 IPC、懒加载、稳定引用和可观测预算优先于盲目删除所有 OpenBuddy 服务。

最终产品应是“开源 WorkBuddy”：用户看到的是任务工作台、助理、项目、专家/技能/连接器、自动化、知识/产物和可恢复执行；开发者看到的是 Pi 标准 ExtensionFactory 加 OpenBuddy manifest；维护者看到的是小而稳定的微内核、明确的所有权和可验证插件。

## 2. 本次审阅范围与当前基线

### 2.1 已检查的仓库证据

- `package.json`：应用为 `openbuddy@0.14.0`，Electron 44、React 18、Vite 8、moon 2.5、pnpm 11、Vitest 2、Pi `@earendil-works/*` 0.85.x、Cordis 3.18.x。
- `electron/main/agent/agent-host.ts`：当前约 1484 行，仍是 composition root/facade 与初始化兼容面，不能直接当作目标微内核已完成。
- `electron/main/agent/pi-extensions.ts`：当前约 1222 行，已聚合多个 builtin extension、manifest 投影和适配逻辑，需继续拆 registry、adapter 和 builtin factory。
- `electron/main/agent/host-modules/bootstrap/install-host-modules.ts`：约 314 行，已有 profile/session/plugin/runtime 四域安装入口。
- `packages/runtime/openbuddy-plugin-host/src/index.ts`：约 1348 行，仍是过大的 barrel/兼容出口，需按能力拆分。
- `packages/capability/openbuddy-email/src/index.ts`：历史计划标注约 3510 行，应在实施前重新测量，不得直接把历史数字当验收事实。
- `docs/OPENBUDDY_PI_NATIVE_PLAN.md`：已有 v8 路线、PI 能力盘点、DSH 退役、微内核、统一 manifest、WorkBuddy 差距矩阵和性能目标，但状态混合且部分章节互相矛盾。
- `docs/ARCHITECTURE_MICROKERNEL.zh-CN.md`：已经定义四域安装、微内核不变量、generation token、readiness 和 WorkBuddy 产品差距。
- `docs/PLUGIN_SYSTEM.md`、`docs/pi-extension-architecture.md`：已有多 surface manifest、能力归属、事务 receipt、Pi/Cordis/Renderer/Harness 边界，以及动态 reload 的不同语义。
- `docs/pi-core-capabilities.md`：记录 Pi 能力复用边界，但包含多个版本/生态推断；使用前必须以安装版本的 type declaration、测试 fixture 和实际 API 为准。
- `PROJECT_ANALYSIS.md`、`docs/CODEBASE_ANALYSIS.md`：覆盖 renderer、Electron、packages、存储、测试和评测，但统计数字随 commit 变化，计划只引用可复现命令的结果。
- `scripts/storage/*`、`scripts/electron/*smoke.mjs`、`scripts/perf/*`、`evals/node/*`：已有架构、IPC、流式、闭环、性能和 agent 评测入口。

### 2.2 当前可复用能力地图

| 领域 | 已有能力 | 计划中的复用原则 |
|---|---|---|
| Agent | Pi `AgentSession`、事件、模型、工具、资源加载、会话树 | 不重写 loop、tool executor、compaction、provider runtime |
| Extension | `pi-extensions.ts`、builtin factories、profile Pi 资源 | 内置和用户扩展统一通过 Pi ResourceLoader/ExtensionFactory，失败可观察 |
| Service | Cordis、四域 host modules、capability packages | 保留跨 surface/长期状态服务，不为“Pi native”强行迁移 |
| Plugin | `openbuddy.plugin.v1`、profile manager、manifest serialization、plugin lifecycle | manifest 是发现与治理契约；runtime surface 各自遵守真实 reload 语义 |
| UI | React renderer、26 个 UI 包、Zustand、WorkBuddy tokens、slot/runtime | renderer 不依赖 Node-only Pi；只消费 typed IPC/事件/slot contract |
| Transport | preload allowlist、typed IPC、Harness WS/HTTP/SSE carrier | IPC 是默认安全边界；carrier 只暴露明确授权的本地/认证 API |
| Persistence | Pi JSONL session tree、OpenBuddy metadata、SQLite storage、audit/outbox | Pi 管对话；OpenBuddy 管产品实体；禁止双写同一权威状态 |
| Capability | MCP、email、calendar、web、automation、collaboration、permission、folder trust | 单一 owner；适配器只能投影，不得启动第二套 backend |
| Quality | Vitest、Playwright、Electron smoke、storage boundaries、evals | 每阶段以可执行退出标准验收，不以 LOC 变化作为唯一质量指标 |

## 3. 产品目标与非目标

### 3.1 v1 产品目标

1. **任务优先**：一次工作有 task id、目标、工作空间、权限策略、模型、状态、事件、产物和引用，可暂停、恢复、取消和重试。
2. **Pi 原生开发体验**：兼容标准 Pi ExtensionFactory、skills、prompts、themes、provider registration 和资源包；第三方扩展不会被迫改成 OpenBuddy 私有 API。
3. **WorkBuddy 级工作台**：一级入口至少覆盖 Tasks、Assistants、Projects/Spaces、Experts/Skills/Connectors、Automation、Knowledge/Artifacts、Settings。
4. **可恢复运行**：Main 重启、renderer 重载、网络断开和插件失败不会静默丢任务；事件具有 task/session/generation/sequence 关联。
5. **可治理插件生态**：发现、安装、启用、禁用、升级、回滚、卸载、权限授予、健康度和诊断全部可见。
6. **高性能默认路径**：进程内 Pi，首屏与 agent 初始化解耦；流式事件批处理；大型历史/产物按需加载；UI 不因无关 capability 更新而全局重渲染。
7. **开源可维护**：核心 API 小、文档可执行、插件可以独立测试和发布、社区代码不能越过安全边界。

### 3.2 明确非目标

- 不在 OpenBuddy 内复制 Pi 的 agent loop、provider HTTP 协议、JSONL session tree 或 compaction 算法。
- 不把 Cordis、Pi Extension、Renderer module 和 remote endpoint 合并成一种“可以随意热卸载”的假象。
- 不默认执行第三方 package lifecycle scripts、远程下载代码或隐式启用网络插件。
- 不为了消除 DSH 名称而删除仍然承担真实业务责任的 OpenBuddy/Harness 服务。
- 不把 WorkBuddy 的企业后台、云端多租户和商业计费强行放入本地微内核；它们作为隔离的 enterprise/optional packages。
- 不以“删除多少 LOC”代替行为兼容、安全、性能和可恢复性证明。

## 4. 目标架构：四层、三核、一个插件契约

```text
Layer 4  Workbench Renderer
  React/Zustand/UI packages/slots
  只依赖 typed preload contract、shared types、renderer plugin SDK
                         │ contextBridge + versioned events
Layer 3  Electron Boundary
  preload allowlist · IPC adapters · auth · validation · event batching
  不暴露 Node、Electron handles、secrets 或 live runtime objects
                         │ explicit commands/events
Layer 2  OpenBuddy Product + Capability Plugins
  Task/Project/Assistant/Artifact/Automation/Knowledge
  Email/MCP/Calendar/Collaboration/Permission 等 Cordis services
  Pi Extension adapters 与 renderer/remote contributions
                         │ stable kernel contracts
Layer 1  Runtime Kernels
  Pi AgentSession + ResourceLoader + ModelRuntime
  Cordis context/lifecycle + OpenBuddy storage/audit
  Electron lifecycle 与最小 composition root
```

### 4.1 所有权表

| 状态/能力 | 唯一权威 | 允许的投影 |
|---|---|---|
| 对话 message、branch、compaction | Pi SessionManager/JSONL | OpenBuddy session summary、renderer projection |
| provider/model runtime | Pi ModelRuntime/ModelRegistry | Settings UI、非敏感 attribution |
| Pi extension/skill resource | Pi ResourceLoader | plugin inventory、diagnostics |
| task lifecycle、approval、artifact | OpenBuddy Product Store/Service | Pi tool/command facade、renderer |
| plugin enablement/permission | OpenBuddy Plugin Registry | Pi load declaration、renderer inventory |
| domain service lifecycle | Cordis | Pi tools/hooks、IPC handlers |
| renderer UI graph | Renderer Plugin Host | Main inventory/readiness |
| audit/trace | OpenBuddy logging/storage | UI timeline、support bundle |

原则：一个状态只能有一个写入者；其他层只能通过 typed command 或事件进行投影。任何新增包都必须在 PR 中声明 owner、读写边界、持久化位置和 reload unit。

### 4.2 微内核最小职责

微内核只做：

1. 创建/销毁运行时上下文；
2. 解析 profile、插件 manifest 和 capability ownership；
3. 按依赖图安装 runtime/service/extension/renderer surfaces；
4. 创建和绑定 Pi AgentSession；
5. 路由版本化命令、事件、取消和 generation；
6. 管理事务、readiness、错误、审计和 dispose；
7. 暴露兼容 facade，但不承载 email、task、knowledge 等业务算法。

`agent-host.ts` 的目标不是“零行”，而是成为可测试的 composition root；目标是去除业务算法、隐式全局状态和 reverse dependency，而不是机械地将代码搬到更多文件。

## 5. 插件契约 v1

### 5.1 Manifest 最小模型

```ts
interface OpenBuddyPluginManifestV1 {
  schema: "openbuddy.plugin.v1";
  id: string;
  version: string;
  displayName?: string;
  apiVersion: string;
  surfaces: Array<"pi" | "cordis" | "bundle" | "renderer" | "remote" | "typert" | "skills" | "prompts">;
  dependencies?: Array<{ id: string; range: string; optional?: boolean }>;
  permissions?: Array<"filesystem.read" | "filesystem.write" | "shell" | "network" | "credentials" | "ui.interaction">;
  entrypoints: Record<string, string>;
  configSchema?: unknown;
  compatibility?: { pi: string; openbuddy: string; platforms?: string[] };
}
```

Manifest 只描述身份、能力、依赖、入口和权限；不传递函数、Electron 对象、秘密、AbortSignal 或不可结构化对象。实际运行时通过各 surface 的 typed context 注入依赖。

### 5.2 Surface 语义

| Surface | 装载者 | reload unit | 失败策略 |
|---|---|---|---|
| `pi`/`skills`/`prompts` | Pi ResourceLoader/AgentSession | 整个 Pi extension runner/session reload | 记录 per-path error，旧 context 失效，禁止继续使用 stale context |
| `cordis`/`bundle` | Cordis/Harness loader | plugin fiber 或 profile transaction | reverse dispose + snapshot rollback |
| `renderer` | Renderer Plugin Host | 依赖有序的 client graph | 候选图先校验，失败恢复旧图与样式 |
| `remote`/`typert` | Main dispatcher + preload/client registry | contribution set/transaction | schema、权限、重复 id、wire safety 失败即拒绝 |

**重要决策**：统一的是 manifest、registry、权限、readiness、诊断和 transaction id；不统一各 runtime 的 reload 物理语义。Pi 不承诺单扩展 hot unload，Cordis 不应假装是 Pi session reload。

### 5.3 生命周期

`discover → validate → resolve dependencies → permission check → stage → install → activate → ready → observe → reload/disable → dispose`。

每步写入 `pluginTransaction`：`transactionId`、`generation`、`pluginId`、`surface`、`phase`、`startedAt`、`finishedAt`、`status`、脱敏 error code。commit 前必须满足声明的 surface receipts；失败必须有 rollback 或明确 degraded 状态。

### 5.4 能力 ownership 与重复 backend 防护

建立单一 `capability-ownership` 表：每个 capability 指定 owner、服务 key、PI adapter、是否允许 passthrough。适配器只能把 Pi command/tool 映射到 canonical service；检测到同一能力有两个 active backend 时拒绝激活并给出诊断。尤其适用于 MCP、web search、permission、task、memory、session 和 subagent。

## 6. WorkBuddy 产品闭环

### 6.1 Task 状态机

```text
draft → queued → running → awaiting_approval → running
   ├→ completed
   ├→ failed → retrying → running
   ├→ cancelled
   └→ paused → queued
```

每个 task 必须绑定 `taskId`、`sessionId`、`workspaceId`、`generation`、`owner`、`policy`、`modelSnapshot`、`createdAt/updatedAt`。AgentSession 是执行载体，不是 task 数据库。任务恢复时从 durable task/event store 重建 projection，并校验 Pi session 是否存在；不存在时进入可操作的 recovery state，不返回静默空结果。

### 6.2 Composer 协议

Composer 输入解析为结构化 draft：正文、`@` 文件引用、`/` command/skill、workspace、assistant/expert、model、permission mode、attachments、voice/extension input。发送前生成 immutable prompt envelope；流式过程中支持 stop、steer、follow-up、approval；失败时保留 draft 和重试上下文。

### 6.3 产物与引用

工具输出不能只存在于聊天文本。Artifact service 负责 artifact id、类型、版本、来源 task/session/tool call、content hash、路径/对象存储引用和访问策略；citation 记录 source id、定位信息、生成时间和可信度。UI 右栏只消费 projection，不直接扫描插件目录或 session 文件。

### 6.4 一级产品能力

| 产品面 | v1 必须闭环 | Pi/OpenBuddy 分工 |
|---|---|---|
| Tasks | 创建、运行、暂停、取消、恢复、历史、状态 | OpenBuddy task service + Pi session |
| Assistants | 配置模型、提示、工具和权限 | OpenBuddy profile + Pi resources |
| Projects/Spaces | workspace、session 分组、默认 policy | OpenBuddy metadata + Pi cwd/session |
| Experts/Skills | 发现、预览、启用、版本、健康度 | Pi skills/agents + plugin registry |
| Connectors | MCP/邮箱/日历/web，认证与状态 | canonical capability services + Pi adapters |
| Automation | schedule/event trigger、运行记录、失败重试 | OpenBuddy scheduler + task command |
| Knowledge | 文件/索引/引用/权限 | OpenBuddy KB package，Pi 只调用工具 |
| Artifacts | 预览、版本、导出、来源 | OpenBuddy artifact store |
| Settings | provider、权限、插件、诊断、数据目录 | Pi settings/model + OpenBuddy policy |

## 7. 分阶段执行路线

每个阶段独立 PR/commit；每个 PR 必须包含变更范围、所有权、迁移/回滚、测试证据和性能影响。禁止跨阶段顺手迁移未声明的 capability。

### Phase 0：基线冻结与事实校正（1 轮）

**目标**：让计划、代码和验证数字一致。

- 运行并保存：`git rev-parse HEAD`、包/测试/文档计数、关键文件 LOC、`pnpm typecheck`、架构边界检查。
- 将 `docs/OPENBUDDY_PI_NATIVE_PLAN.md` 的“完成”与“目标”拆为 Current/Target；标出无法复现的历史数据。
- 为每个 capability 建 owner 表：Pi native、OpenBuddy service、adapter、renderer、persistence。
- 定义 `apiVersion`、manifest schema、event envelope、error taxonomy、generation/sequence 规则。

**退出标准**：任何路线条目都能指向代码/测试/脚本；基线命令在干净依赖环境可重跑；不再使用无来源的“全量通过/性能达标”。

### Phase 1：微内核边界与插件 registry（P0，2–3 轮）

1. 将 `InstallHostModuleDeps` 拆为 Profile/Session/Plugin/Runtime domain deps；消除 `as unknown as never` 等边界逃逸。
2. 让 `agent-host.ts` 保持 composition root；把 init、lifecycle、facade、event projection 的 contract 明确化；禁止 capability 反向 import。
3. 建立 `PluginRegistry`、manifest validator、ownership 表、readiness snapshot 和 generation token。
4. 将所有 plugin mutation 串行化；支持 stage/activate/rollback/dispose；给 Pi、Cordis、renderer 分别实现正确的 transaction adapter。
5. 将 `plugin-event-bus` 与 Pi EventBus/产品事件桥的职责分开：Pi 事件不等于跨域业务事件，必要时做 typed projection。

**退出标准**：profile reload、plugin disable、依赖失败、重复 capability、旧 generation 事件均有测试；`agent-host` 无业务算法；plugin inventory 能显示 source/version/managed/health/disabledReason；边界脚本在 CI 阻断反向 import。

### Phase 2：Pi 原生资源与扩展装载（P0，2 轮）

1. 统一 builtin 与 profile/user extension 的发现入口，优先 Pi `DefaultResourceLoader`/`discoverAndLoadExtensions`；保留 OpenBuddy manifest 作为治理层。
2. 统一 Pi settings、skills、prompts、themes、agents 的资源映射；明确用户目录、项目目录、profile 目录和 trust gate 的优先级。
3. 将 `pi-extensions.ts` 拆成 builtin registry、compatibility adapters、provider attribution、resource projection。
4. 处理 `AgentSession.reload()` 的 stale context：reload 后旧 extension context、旧 listener、旧 UI request 必须失效。
5. 将第三方 Pi 包分为 native-load、adapter-backed、optional-native、blocked 四级；exact version、许可证、平台和 terminal UI 假设进入 inventory。

**退出标准**：fixture plugin 可加载 tool/command/skill；reload 后旧 handler 不再响应；失败扩展进入 diagnostics；不会重复启动 canonical MCP/web/permission backend；用户扩展安装、禁用和删除可回滚。

### Phase 3：工具、权限与交互 UI 收敛（P0，2–3 轮）

1. 逐项评估 Pi `createBashTool/createReadTool/createWriteTool/createEditTool` 等 factory 与 OpenBuddy trust/policy 的交集；只替换底层执行，不丢失审计、路径约束和 mutation queue。
2. 将 permission/folder trust 统一为 OpenBuddy policy owner，Pi 扩展通过 adapter 发出 typed request；拒绝、超时、关闭窗口都必须有确定结果。
3. 用 IPC 适配 Pi ExtensionUIContext：select/input/editor/confirm/notify/status/widget；禁止把 TUI/React component 直接带入 Main。
4. 工具事件统一 `tool_execution_start/update/end`，支持背压、批处理和取消；结果大小、二进制和 secrets 必须脱敏/截断。

**退出标准**：bash/read/write/edit 的安全回归、权限矩阵、取消和 tool streaming 测试通过；renderer 只走 typed bridge；未处理 UI request 不会悬挂 task。

### Phase 4：任务工作台产品闭环（P0，3–5 轮）

1. Task durable schema、状态机、event store、session binding、recovery/ retry。
2. Composer envelope、attachments、引用、steer/follow-up、approval、stop/resume。
3. Project/Space/Assistant/Expert/Connector 统一选择器和持久化投影。
4. Artifact/citation center、文件树、成本/时间/模型摘要。
5. before-quit：检测 active task，提供取消/等待/后台继续策略；窗口重开后恢复任务列表和 readiness。

**退出标准**：无模型凭据也能运行 deterministic fake provider 完整闭环；真实 Electron smoke 覆盖新建、运行、工具进度、审批、失败重试、恢复、退出确认；状态机没有 renderer-only 状态。

### Phase 5：性能与可靠性（P1，2–3 轮）

1. cold start 分 stage 埋点；主窗口/renderer 首屏与 AgentSession/插件加载解耦。
2. 对 Pi event → Main → preload → renderer 使用 bounded queue、coalescing、最大 payload 和 per-task sequence；文本 delta 与 tool progress 分通道。
3. UI 按 task/session selector 更新，避免全局 Zustand store 高频写入；历史、artifact、plugin inventory 分页/虚拟化。
4. bundle manual chunks、Main lazy imports、SQLite prepared statements/批量写、JSONL 增量读取；先基准后改动。
5. provider retry/backoff、MCP reconnect、plugin load timeout、memory/FD 监控；泄漏测试覆盖 subscribe/unsubscribe、reload、window close。

**初始预算（需基线校准）**：冷启动到可交互 ≤2.5s、首个本地事件 ≤100ms、tool IPC p95 ≤50ms、事件丢失 0、事件队列有界、空闲内存和 renderer gzip 以 CI 实测基线 ±10% 管控。不得把无凭据/缓存环境的指标宣称为真实 LLM 首 token 指标。

### Phase 6：插件市场与生态安全（P1，3 轮）

1. Settings 插件页：搜索/详情/版本/权限/来源/健康度/日志/禁用/回滚。
2. 本地安装优先、`pnpm add --ignore-scripts` 或受控 materialize；默认不执行 lifecycle scripts；registry/network 安装必须显式用户动作。
3. workspace-shared plugin：profile manifest、签名/来源、兼容版本、组织 policy、回滚；不能把共享配置当作任意代码执行授权。
4. sandbox/permission：filesystem roots、shell/network、credentials、UI interaction 最小授权；高风险插件需人工确认。
5. provenance、SBOM、license、hash、撤销/blocked list、crash quarantine 和 support bundle。

**退出标准**：恶意/损坏/不兼容 fixture 被拒绝；安装失败不污染旧 profile；插件不能越过 IPC/secret/storage 边界；禁用后无 listener、fiber、style、remote route 泄漏。

### Phase 7：真实验证、发布与社区（持续）

- deterministic contract suite：manifest、lifecycle、ownership、event ordering、storage migration。
- Electron smoke：启动、无凭据、provider、prompt、stream、tool、approval、session reload、plugin reload、退出。
- 真实 provider E2E：只在显式凭据环境运行，不把网络/额度失败计为代码回归；保存脱敏证据。
- 评测：BFCL/tool selection、AgentDojo safety、SWE/NL2Bash/GAIA/MT-Bench 风格任务，增加 WorkBuddy task/artifact/approval 数据集。
- 发布：版本化 manifest/API、迁移说明、插件兼容矩阵、签名构建、SBOM、灾备与回滚说明。

## 8. 性能设计

### 8.1 关键路径

```text
user input
 → renderer command envelope
 → preload validation
 → Main task coordinator
 → Pi AgentSession.prompt/steer/followUp
 → Pi tool/provider
 → AgentSession events
 → Main projection + bounded event queue
 → preload typed event
 → task/session/artifact selectors
 → Workbench render
```

任何同步磁盘扫描、全量 plugin inventory、全量 session replay 或 provider discovery 不得阻塞 prompt/first paint。插件 discovery 和 UI inventory 可以异步进入 readiness；任务执行必须能区分 `booting/loading/ready/degraded/failed`。

### 8.2 事件与内存约束

- envelope 统一包含 `schemaVersion`, `eventId`, `taskId?`, `sessionId?`, `generation`, `sequence`, `timestamp`, `kind`, `payload`。
- 文本 delta 可合并但不能跨 sequence 乱序；tool progress 可采样；最终 tool result 不可丢。
- queue 满时优先丢弃可重建的 progress，不丢 lifecycle、approval、error、final result。
- 所有 subscribe 必须返回 unsubscribe；session reload/window close/plugin dispose 都做清理。
- 单个插件的异常只能使其 surface degraded；不能吞掉错误，也不能默认拖垮整个主进程。

## 9. 安全、隐私和风险边界

| 风险 | 影响 | 防护与验收 |
|---|---|---|
| 第三方插件任意代码 | 读密钥、文件、网络、shell | 显式权限、来源/hash/license、沙箱/隔离能力、安装前确认、quarantine |
| Renderer 越权 | RCE、任意 IPC | contextIsolation、sandbox、allowlist、schema validation、无 Node import |
| prompt/tool 注入 | 数据外泄、危险操作 | folder trust、permission policy、审批、敏感路径 deny、审计 |
| 事件乱序/旧任务写入 | 错误 UI/数据破坏 | generation+sequence、CAS/transaction、旧 generation 丢弃 |
| 插件 reload 泄漏 | listener/fiber/style/route 残留 | dispose contract、泄漏测试、旧图回滚 |
| 双 backend | 重复发送/重复扣费/状态分叉 | capability ownership、passthrough registry、激活时冲突检查 |
| 凭据暴露 | 账户接管 | secret 不进入 manifest/inventory/event；OS/keychain 或 Pi auth store；日志脱敏 |
| 远程 carrier 误用 | 本地 API 被滥用 | loopback、短期 bearer、origin/CSRF、endpoint allowlist、速率限制 |
| 供应链/依赖升级 | 兼容性和恶意代码 | lockfile、exact review、SBOM、CI audit、Pi 升级独立 PR |
| 数据迁移失败 | 丢 session/task | snapshot、atomic rename、schema version、rollback、恢复测试 |
| 目标过度承诺 | 开源生态失信 | 文档区分 verified/target/experimental，性能和 E2E 只报证据 |

### 9.1 特别边界

- DSH/Harness 只有在仍承担真实兼容职责时保留；退役须以调用图、行为测试和迁移结果为依据。
- Pi community package 不等于官方支持；先做 isolated fixture，再进入默认 profile。
- plugin marketplace 不能成为隐式远程代码执行入口；默认只展示，安装需用户明确动作。
- 企业 Casdoor、支付、SCIM、SAML、邮件等不进入微内核核心；它们通过 capability/plugin 包隔离并拥有独立测试。

## 10. API/版本与迁移策略

1. `openbuddy.plugin.v1`、IPC contract、event envelope、task schema、storage schema 均显式版本化。
2. Pi 版本锁定在单独升级 PR；先跑 type declarations、fixture plugin、session reload、provider/tool smoke，再升级 OpenBuddy adapters。
3. 兼容 facade 允许一个过渡周期，但新代码不得依赖 deprecated API；每个 deprecated 面有删除版本和迁移文档。
4. profile/plugin state 使用 atomic snapshot + migration journal；失败恢复旧 manifest、旧 package graph、旧 runtime projection。
5. Pi JSONL 是 Pi-owned 数据，OpenBuddy metadata 不修改未知 Pi entry；OpenBuddy 数据迁移不重写对话历史。

## 11. 验证矩阵与证据格式

### 11.1 每个 PR 必须提供

- 变更前后架构边界结果；
- 变更文件与 owner；
- 单测/集成测试命令及通过数；
- typecheck/lint/build 结果；
- 若涉及运行时：Electron smoke 或 deterministic fake runtime；
- 若涉及性能：同环境 before/after、p50/p95、样本量和资源约束；
- 若涉及插件：manifest、权限、安装失败、reload、dispose、rollback fixture；
- 若涉及存储：schema migration、旧版本 fixture、崩溃恢复证据。

### 11.2 推荐命令

```bash
# 根目录 OpenBuddy
pnpm typecheck
pnpm lint:eslint
pnpm lint:sheriff
pnpm storage:boundaries
pnpm storage:acceptance
pnpm exec vitest run
pnpm test:electron:ipc-surface
pnpm test:electron:stream-port
pnpm test:closed-loop
pnpm perf:streaming
pnpm perf:ipc

# 变更 renderer/构建时
pnpm build
pnpm perf:main-chunks

# 真实 Electron/LLM 仅在具备环境时
pnpm test:electron:real-ui
pnpm eval:acceptance
```

环境不允许运行的命令必须标记为“未验证及原因”，不能用历史日志替代当前结果。网络、凭据、sandbox、平台 GUI 失败要与代码失败分开归类。

### 11.3 v1 验收门槛

| 门槛 | 目标 |
|---|---|
| TypeScript | affected projects 0 error |
| Unit/contract | 新增行为 100% 有 deterministic test；全量无新增失败 |
| Architecture | 0 个反向层 import、0 个未授权 capability owner 冲突、0 个 reload 泄漏 |
| Plugin | 安装/启用/禁用/reload/失败/回滚全覆盖 |
| Task | draft→running→approval/retry/completed/failed/cancelled/paused→resume 可恢复 |
| IPC | channel allowlist、payload schema、取消、事件顺序和背压通过 |
| Security | secret 不进日志/manifest/inventory；危险权限明确审批 |
| Performance | 预算由同环境基准实测；队列有界；无明显 session/window/plugin leak |
| Product | Tasks、Projects、Assistants、Experts/Skills/Connectors、Automation、Artifacts 至少各有可运行闭环 |
| E2E | 无凭据 deterministic smoke 必须通过；真实 LLM 单独报告，不阻塞本地 contract gate |

## 12. 第一批执行顺序（建议给后续实现 agent）

1. **先做 Phase 0**：重新测量当前 commit，修正文档状态，不改业务。
2. **再做 Phase 1.1**：拆 domain deps 和 plugin registry contract；这是后续所有 phase 的依赖。
3. **随后做 Phase 2.1**：Pi resource/extension fixture 与 reload/stale context 测试；不要先大规模迁工具。
4. **并行小任务**：Phase 3 的 UI request/permission contract、Phase 4 的 task schema 设计，但先不接真实 UI。
5. **完成 deterministic task loop 后**，再执行性能优化；没有稳定事件/状态 contract，性能数据没有意义。
6. **最后再开 marketplace**：先保证本地安装、权限、回滚和 provenance，再接 registry UI。

每轮只解决一个边界问题；不要以“删除 DSH/减少 LOC”作为先决条件。若实际代码证明某个 OpenBuddy service 是唯一安全/产品 owner，应保留它并通过 PI adapter 暴露，而不是为了口号迁移。

## 13. 交付物清单

- `plan4.md`：本计划，作为执行总纲。
- `docs/OPENBUDDY_PI_NATIVE_PLAN.md`：后续按 Current/Target/Verified 规则同步，保留历史演化但不再混写状态。
- `docs/architecture/`（后续）：manifest、event envelope、task state machine、security boundary、plugin lifecycle ADR。
- `packages/runtime/openbuddy-plugin-sdk/`（后续）：只放稳定 manifest/type/validator/loader contract，不放 Electron 业务。
- `scripts/architecture/`（后续）：layer boundary、owner conflict、cycle、god-module 和 plugin leak 检查。
- `evals/datasets/workbuddy/`（后续）：task recovery、approval、artifact/citation、plugin failure、workspace routing 场景。

## 14. 结论

OpenBuddy 已有足够的 Pi、Cordis、Electron、UI、存储、插件和评测基础，不需要另起一个 Agent Runtime。真正的产品差异不在“再造一个 Pi”，而在于把 Pi 的可靠 Agent 能力组织成可恢复的 WorkBuddy 工作流，并用微内核和插件契约控制复杂度。

成功标准不是 OpenBuddy 看起来拥有多少 API，而是：

- Pi 原生能力只实现一次并可直接复用；
- OpenBuddy 的产品能力有清晰 owner、持久化和恢复语义；
- 插件可以独立装载、诊断、回滚和卸载；
- renderer、Main、Pi、Cordis 之间没有隐式越权；
- 任务、工具、审批、产物和引用形成真实闭环；
- 性能、安全和兼容性都有可重复证据。

这条路线能同时满足高产品力、高性能、微内核、低耦合、开源扩展和长期可维护性，而不是用一次性重写换取短期的“Pi native”标签。
