# OpenBuddy Pi-Native WorkBuddy 全量分析与改造计划 3.0

> 版本：3.1 — 2026-09-10 实现轮
> 本轮实现：pi-event-bridge.ts eventId 对齐 + evidence/pi-capability-inventory.json 生成
> 基线：`louloulin/OpenBuddy` checkout `1159a9c`（2026-09-10）+ 本轮修改
> 目标：把 OpenBuddy 收敛为“Pi Agent Kernel + OpenBuddy Workbench Product + Cordis Domain Services + Electron Security Boundary”的可恢复、可治理、可扩展 WorkBuddy。
> 状态口径：`Current` 是当前代码可定位事实；`Target` 是计划；`Verified` 只代表本轮实际运行过的证据。历史文档中的“已完成”若无法在当前 checkout 复现，不升级为 Verified。

## 1. 结论先行

OpenBuddy 已经深度使用 Pi，但还不是完整意义上的 Pi-native WorkBuddy。它不需要再造 Agent Runtime，真正需要解决的是边界、产品闭环和证据一致性。

### 1.1 当前判断

1. **Pi 集成：中高成熟度。** 当前 package 使用 `@earendil-works/pi-coding-agent`、`pi-agent-core`、`pi-ai` `^0.85.0`；代码已经接入 `createAgentSession`、`AgentSessionRuntime`、`SessionManager`、`DefaultResourceLoader`、`ModelRuntime`、`ExtensionAPI`、工具/命令/provider 注册、资源发现和 reload。
2. **OpenBuddy 产品：能力很广，但工作流不够统一。** Electron、React/Zustand、MCP、邮件、日历、协作、团队、自动化、知识、企业认证、计费与管理后台并存；这些是 OpenBuddy 的产品资产，不应被 Pi 抽象吞掉。
3. **核心架构风险：桥接层和兼容层过厚。** `agent-host.ts`、`pi-extensions.ts`、plugin-host barrel、IPC/事件/资源适配层聚集了生命周期、兼容协议、业务投影和诊断。继续增加功能而不先收敛 owner，会产生第二套 session/tool/provider/plugin 状态。
4. **最大产品缺口：任务工作台闭环。** 目前“聊天 + Agent”基础存在，但任务、空间、助理/专家、技能/连接器、审批、产物、引用、恢复、自动化、退出安全尚未用一个统一 task/session/event/artifact 协议串起来。
5. **最大性能风险：事件和状态更新边界。** Pi 高频事件经过 Main、preload、renderer、多套 store 和插件 event bus；必须建立有界队列、coalescing、generation/sequence 和按任务订阅，否则长流和多任务会造成 IPC、渲染和内存放大。
6. **最大可信度风险：文档、版本、证据漂移。** 既有 `plan2.0.md`、`plan4.md`、`docs/OPENBUDDY_PI_NATIVE_PLAN.md`、`docs/pi-core-capabilities.md` 等存在不同 Pi 版本、行数、模块路径和完成度叙述。3.0 采用代码 > 当前测试 > 可复现命令 > 设计文档 > 历史报告的证据优先级。

### 1.2 战略原则

- **Pi owns runtime**：Agent loop、session transcript/tree、model/provider runtime、标准工具、compaction、extension lifecycle、Pi resources 只实现一次。
- **OpenBuddy owns product**：Task、Workspace/Project、Assistant/Expert、Artifact/Citation、approval、enterprise policy、billing、audit、connector catalog、renderer UX 由 OpenBuddy 拥有。
- **Cordis owns durable services**：长期服务、DI、跨 surface capability、组织/邮件/协作/支付等不因“Pi-native”口号强行迁移。
- **Adapter is thin**：适配层只做 typed conversion、权限决策路由、事件投影、产品 metadata 关联和生命周期绑定。
- **One capability, one owner**：同一 session/tool/provider/permission/MCP/web/task 状态不得由两个 backend 同时写入。
- **Evidence-gated**：区分 `E0 静态存在`、`E1 deterministic unit`、`E2 main/preload integration`、`E3 real provider/package/platform`、`E4 repeatable benchmark`。
- **No private WorkBuddy inference**：公开资料和用户授权之外，不推测或伪造 WorkBuddy 私有云、商业接口和内部实现。

## 2. 本轮调查范围与可复现基线

### 2.1 已检查

- 根 `package.json`、workspace/moon/pnpm 配置和 scripts。
- Electron Main、preload、IPC、agent runtime、host-modules、Pi resources/extensions、plugin-host、renderer host。
- React 主入口、UI 包、agent client、Zustand stores、事件桥和插件面。
- `packages/capability`、`packages/collaboration`、`packages/auth`、`packages/payment`、`packages/storage` 等产品服务。
- `docs/ARCHITECTURE*`、`docs/PLUGIN_SYSTEM.md`、`docs/pi-extension-architecture.md`、`docs/openbuddy-product-vs-pi.md`、`docs/pi-core-capabilities.md`、`docs/WORKBUDDY_PI_OPTIMIZATION_PLAN.md`、既有 plan 文档。
- 当前机器安装的 Pi SDK 文档：`sdk.md`、`extensions.md`、`packages.md`、`rpc.md`、`compaction.md`、`providers.md`。

### 2.2 当前 checkout 静态统计（E0）

| 项目                         |    当前值 | 说明                                                            |
| ---------------------------- | --------: | --------------------------------------------------------------- |
| Git HEAD                     | `1159a9c` | 当前分支 `agent/devbox2/e61f6132853f`                           |
| 仓库文件                     |      2373 | 排除 `.git`，含文档/配置/资源                                   |
| 源码与脚本文件               |      2118 | `electron`、`packages`、`src`、`apps`、`scripts`、`evals` 等    |
| 测试文件                     |       600 | `*.test.*` / `*.spec.*`，仅计文件数，不代表通过数               |
| Pi 相关源码文件              |       145 | 以 Pi package/import/API 关键词静态搜索                         |
| Pi 相关 API 引用             |       523 | `register*`、`SessionManager`、`DefaultResourceLoader` 等关键词 |
| `agent-host.ts`              |   1518 行 | composition root/facade/兼容入口，仍偏大                        |
| `pi-extensions.ts`           |   1222 行 | builtin、adapter、provider、manifest、事件逻辑聚合              |
| `electron/main/ipc/agent.ts` |    141 行 | 当前已不再是历史文档中 1000+ 行的旧状态                         |
| `plugin-host/src/index.ts`   |   1394 行 | barrel/兼容出口仍然过大                                         |
| `package.json` Pi 版本       | `^0.85.0` | 需在 lockfile/安装后记录实际 resolved version                   |
| `node_modules`               |    不存在 | 本轮未运行 typecheck、test、build 或 Electron smoke             |

### 2.3 证据等级

| 等级 | 可以证明                                                    | 不能证明                      |
| ---- | ----------------------------------------------------------- | ----------------------------- |
| E0   | 代码、类型、脚本、文档入口存在                              | 运行正确、产品可用、外部兼容  |
| E1   | deterministic 单测或 fixture 场景成立                       | 真实 provider、桌面、第三方包 |
| E2   | Main/preload/renderer contract 或本地集成成立               | 多平台和真实网络稳定性        |
| E3   | 真实 provider、exact-version Pi package 或平台 runner 成立  | 长期性能和生产 SLA            |
| E4   | 固定环境、样本量、P50/P95/P99、错误率、成本和原始结果可复现 | 超出测量范围的生产承诺        |

## 3. 目标架构与权威性

```text
WorkBuddy React Renderer
  Tasks / Projects / Assistants / Experts / Connectors / Automation
  Artifact / Citation / Permission / Settings / Diagnostics
            │ versioned typed preload + event envelope
Electron Security Boundary
  allowlist / schema validation / cancellation / auth / redaction
            │ commands + projections
OpenBuddy Product Kernel + Cordis Services
  task / workspace / policy / artifact / audit / enterprise / domain services
            │ thin adapters
Pi Agent Kernel
  AgentSessionRuntime / SessionManager / ModelRuntime / ResourceLoader
  standard tools / extensions / skills / prompts / themes / compaction / events
            │
Pi AI + Agent Core + Cordis runtime + local persistence adapters
```

### 3.1 权威状态表

| 状态                                               | 唯一 owner                                 | 允许的投影                                 |
| -------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| Agent loop、tool execution、model/provider request | Pi `AgentSession` / `ModelRuntime`         | OpenBuddy telemetry、renderer event        |
| conversation transcript/tree/compaction/branch     | Pi `SessionManager`/JSONL                  | OpenBuddy session catalog、search/index    |
| task lifecycle、approval、retry、pause/resume      | OpenBuddy Task service/store               | Pi command/tool facade、renderer           |
| workspace/project/assistant/expert metadata        | OpenBuddy product store                    | Pi cwd/resource config                     |
| skills/prompts/themes/extensions discovery         | Pi `DefaultResourceLoader`                 | plugin inventory、diagnostics、settings UI |
| package install/source/hash/license/trust          | OpenBuddy package/profile registry         | Pi resource declaration                    |
| permission/folder trust policy                     | OpenBuddy policy owner                     | Pi `tool_call`/UI adapter                  |
| MCP/web/email/calendar domain state                | corresponding Cordis capability            | Pi tool/command adapter                    |
| artifact/citation/version/source                   | OpenBuddy Artifact service                 | session message reference、renderer panel  |
| credentials/API keys/OAuth                         | OS keychain or controlled credential store | redacted provider status only              |
| audit/trace/cost attribution                       | OpenBuddy audit/telemetry                  | UI timeline/support bundle                 |

**禁止项：** renderer 不能读取 Pi session 文件或插件目录来推断状态；Pi extension 不能直接写 OpenBuddy SQLite；OpenBuddy adapter 不能创建第二个 model runtime；包 manifest、event payload、inventory 不能包含 secret、Electron handle、live object 或不可结构化对象。

### 3.2 领域边界

- `electron/main/agent/agent-host.ts`：composition root、runtime replacement、facade assembly、生命周期入口；不承载 email/task/marketplace 业务算法。
- `electron/main/agent/pi-extensions.ts`：逐步变成 builtin registry + adapter registry；不再成为所有 capability 的总线。
- `packages/runtime/openbuddy-plugin-host`：manifest、profile、surface registry、transaction/readiness、兼容层；按能力拆分出口。
- `packages/capability/*`：长期领域服务和持久化；通过明确接口接入 Pi。
- `packages/ui/*` 与 `src/*`：只消费 typed bridge/projection；不 import Node-only Pi 实现。
- DeepSeek/Harness：只保留真实兼容边界；新功能不得扩展第二套 Agent loop、session store 或 provider runtime。

## 4. Pi 官方能力复用清单

本节以当前安装的 Pi 0.85 文档为 API 参考，实际实现以 lockfile resolved version 的 types 和测试为准。

### 4.1 应直接复用

| Pi 能力                                                                  | OpenBuddy 应用                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `createAgentSession` / `AgentSessionRuntime`                             | 唯一 agent/session runtime，支持 new/resume/fork/clone/switch               |
| `SessionManager` 与 JSONL tree                                           | transcript、branch、label、冷恢复；产品 metadata 单独保存                   |
| `ModelRuntime` / credentials / custom models                             | provider/model/auth runtime；OpenBuddy 增加租户、配额、成本 attribution     |
| `DefaultResourceLoader`                                                  | extensions、skills、prompts、themes、context files 的发现与 reload          |
| `ExtensionAPI` / `registerTool` / `registerCommand` / `registerProvider` | AI 工具、命令、事件、provider adapter；每个注册记录 owner/source/dispose    |
| `tool_call` / `tool_result` / provider hooks                             | 权限拦截、审计、租户 attribution、诊断，不重复 provider 调用                |
| `ctx.ui` RPC-safe interaction                                            | select/confirm/input/editor/notify/status/widget 映射到 WorkBuddy UI        |
| native compaction/tree summary                                           | OpenBuddy 提供 context/cost/recovery UX 和 telemetry，不重复 summarizer     |
| RPC JSONL semantics                                                      | headless CLI、集成测试、自动化入口；Electron 内部首选 in-process SDK        |
| package manifest/filter/scope                                            | exact pin、profile/project/global scope、资源过滤和 compatibility inventory |

### 4.2 Pi 不提供、必须由 OpenBuddy 拥有

企业登录/SSO/SAML/SCIM/RBAC、多租户、计费/credits/SKU/退款、组织管理、邮件协作、任务工作台、Artifact/Citation、知识库、自动化调度、产品导航、Electron 安全/更新/签名、多平台发布和运营报表。

### 4.3 Pi package 生态策略

Pi package 运行任意系统权限，skills 也可能指导模型执行危险操作；“可被 Pi 加载”不是“安全、可用或 OpenBuddy 已交付”。每个包必须经过：

`discover → metadata validate → exact version/hash/license → dependency review → trust/permission review → isolated load → reload/remove/rollback → usable verification`。

兼容等级固定为：

- `discovered`：能发现 manifest/元数据；
- `loaded`：Pi 能加载 extension/resource；
- `rpc-safe`：交互不依赖 TUI-only `custom()`/PTY；
- `usable`：在 OpenBuddy UI、权限和错误语义下可用；
- `real-verified`：真实 provider 或外部服务完成 E3。

默认不远程自动安装、默认不执行未知 lifecycle scripts、默认不把 marketplace 展示当作信任。第三方包与 OpenBuddy canonical capability 重叠时，只做 adapter/passthrough，不启动第二个 backend。

## 5. 当前问题与根因

### P0：权威性和失败语义

1. **session/transcript/metadata 边界必须冻结。** 既有文档对 Pi JSONL、SQLite、Harness state 的权威性表述不完全一致。必须写出 schema、迁移、冷恢复和 shadow compare 规范。
2. **reload 不是单文件 hot unload。** Pi 的 `AgentSession.reload()` 会使旧 extension context/listener 失效并重建 runner；产品 UI 必须展示 generation、readiness、diagnostic，不能承诺不存在的单扩展 unload。
3. **所有 mutation 必须可回滚。** profile、package、provider、renderer graph、Cordis fiber、Pi resource 的失败应保留旧可用版本，写入脱敏 transaction trace。
4. **权限策略不应分裂。** OpenBuddy authorization/folder trust、Pi tool hook、renderer confirm 必须是单一决策链，拒绝/超时/关闭窗口都返回确定结果。

### P0：产品闭环缺口

任务必须绑定 `taskId/sessionId/workspaceId/generation/owner/policy/modelSnapshot`，状态至少包括：

```text
draft → queued → running → awaiting_approval → running
  ├→ completed
  ├→ failed → retrying → running
  ├→ paused → queued
  └→ cancelled
```

当前规划中必须补齐：composer envelope（文本、@ 文件、/skill/command、workspace、assistant、model、permission、attachments）、stop/steer/follow-up、approval、task recovery、artifact/citation、退出确认、任务历史/空间投影。

### P1：桥接层和模块内聚

当前体量显示 `agent-host.ts`、`pi-extensions.ts`、plugin-host index 仍承担过多职责。目标不是机械删 LOC，而是：

- 按 `ProfileDomainDeps / SessionDomainDeps / PluginDomainDeps / RuntimeDomainDeps` 拆依赖契约，消除保护性 cast；
- builtin extensions 按 observability/context/compaction/provider/session metadata 分 registry；
- plugin-host 按 manifest/profile/session/renderer/remote/typert/lifecycle 分出口；
- 每个 handler 明确 command/event/schema/owner/dispose；
- 通过 boundary/cycle/ownership 脚本阻止 reverse import 和重复 backend。

### P1：事件与 renderer 性能

统一 envelope：

```ts
interface OpenBuddyEventEnvelope<T> {
  schemaVersion: 1;
  eventId: string;
  kind: string;
  taskId?: string;
  sessionId?: string;
  generation: number;
  sequence: number;
  timestamp: number;
  payload: T;
}
```

文本 delta、tool progress、lifecycle/final/error 分通道。队列满时只允许合并/丢弃可重建 progress，不丢 approval、error、final、session lifecycle；旧 generation 事件必须丢弃。renderer store 按 task/session selector 更新，禁止全局 store 高频写导致 ChatView/整个 App 重渲染。

### P2：用户体验与开发者生态

需要补齐或验证：session tree/branch navigator、context usage/cost、extension status/diagnostics、skill/agent/prompt marketplace、package permissions、workspace shared profile、CLI/RPC parity、可解释错误、支持包导出和社区插件模板。它们依赖 P0 的 task/event/ownership contract，不能提前堆 UI。

## 6. 分阶段实施路线

每阶段一个或多个小 PR；每个 PR 必须包含 owner、迁移/回滚、测试命令、性能影响和 evidence level。不要把“计划文件修改”当作业务完成。

### Phase 0：事实基线与文档治理（P0，1 周）

**状态：✅ 部分 Verified（见 §11）**

- ✅ 已 Verified：生成 machine-readable `pi-capability-inventory`：API、代码入口、owner、状态、证据、测试、reload unit。
- 统一文档版本：当前 Pi resolved version、Node、Electron、OS、third-party package matrix。
- 将既有文档的 Current/Target/Verified/History 分栏；修复过时路径和行数。
- 冻结 owner 表、event envelope、error taxonomy、generation/sequence、task schema 草案。

**出口：** 所有 P0 capability 都有唯一 owner、命令 schema、事件 schema、测试入口和证据等级；不存在“两个模块都拥有状态”的未决项。

### Phase 1：Pi runtime adapter 收敛（P0，2–3 周）

**状态：✅ 部分 Verified（eventId 对齐完成；见 §11）**

回归测试：`pi-event-bridge.test.ts` 已验证 eventId 生成、唯一性和 snapshot 保留（9/9）。
生命周期修复：`TaskService.close()` 已接入 `openbuddy-core-plugin.apply()` teardown，避免 reload 时遗留 SQLite storage 句柄。

1. `agent-host.ts` 只保留 composition root/facade；按域拆 `InstallHostModuleDeps`。
2. `pi-extensions.ts` 拆 builtin registry、compatibility adapter、provider attribution、resource projection。
3. ✅ 已 Verified：统一 Pi session event 到 canonical projection（SessionEventRecord.eventId 对齐 plan OpenBuddyEventEnvelope；randomUUID 生成；generation fence 已实现）。
4. 明确 `AgentSessionRuntime` replacement 后重新订阅，清理旧 context/listener/UI request。
5. 统一 tool registry：同名 tool 禁止静默覆盖，注册来源和 dispose 可审计。
   ✅ 已验证（inventory）：无重复工具名；Map-based registry with explicit set/delete；openbuddy_mcp/openbuddy_permissions/openbuddy_goals/openbuddy_sessions/openbuddy_fs + 4 个 calendar 工具
6. compaction/context guard 优先使用 Pi native preparation/settings/token accounting；OpenBuddy 只做 policy/UI/telemetry。

**出口：** prompt、stream、tool、abort、steer/follow-up、session replace、reload、provider register/unregister、compaction 失败恢复均有 E1/E2 测试；旧 generation 不再写入 renderer。

### Phase 2：任务工作台与数据权威（P0，3–5 周）

1. 落地 durable task schema/state machine/event store。
2. 建立 task↔Pi session binding 与恢复检查；session 缺失进入可操作 recovery，不返回静默空结果。
3. 完成 Composer envelope、审批、取消、重试、暂停、恢复和 before-quit 策略。
4. Artifact/Citation service 记录来源 task/session/tool/provider、版本和 hash。
5. SQLite 产品 metadata 与 Pi JSONL transcript 分层，完成迁移、冷启动、crash recovery、shadow compare。

**出口：** deterministic fake provider 可以完成 draft→running→approval/retry→completed/failed/cancelled/paused→resume；真实 Electron smoke 覆盖重启、恢复、退出确认。

### Phase 3：资源、插件和安全治理（P0/P1，3–4 周）

- 统一 Pi package、OpenBuddy manifest、profile registry 的 source/version/hash/license/permissions/health。
- 安装/启用/禁用/更新/回滚/卸载全部事务化；失败恢复旧 profile。
- project trust、folder trust、dangerous tool、secret redaction 和 package permission 统一决策链。
- `ctx.ui` 的 select/confirm/input/editor/notify/status/widget 全部有 timeout/cancel/quit 结果。
- 将第三方包分为 native-load、adapter-backed、optional、blocked，并维护 exact-version matrix。

**出口：** malicious/broken/incompatible fixture 被拒绝；禁用/reload 后 listener/fiber/style/route=0 泄漏；包元数据不含 secret；至少一个外部 Pi package 达到 E3。

### Phase 4：WorkBuddy 产品力（P1，4–6 周）

- Tasks、Projects/Spaces、Assistants、Experts/Skills、Connectors、Automation、Knowledge、Artifacts、Settings 形成一级导航和真实闭环。
- 为每个 capability 提供产品入口、Pi tool/command（需要时）、状态事件投影和 E2/E3 验收。
- session tree/branch/fork/compact/recover 变成用户可理解的操作，而不是底层命令。
- CLI/RPC 提供 prompt/stream/abort/session/tree/compact/model/diagnostics 核心 parity。
- marketplace 先做本地/curated/exact version；远程 registry 只能在显式用户动作后安装。

**出口：** 新用户可完成首次任务、工具审批、失败重试、恢复、产物导出、安装/禁用 skill、查看诊断；桌面和 CLI 核心结果一致。

### Phase 5：性能与可靠性（P1，持续）

- 分阶段记录 cold start、renderer ready、Pi ready、first token、tool start、IPC round-trip、reload、compaction、recovery。
- streaming/event queue 做 bounded/coalescing/backpressure；大历史、artifact、inventory 分页/虚拟化/按需读取。
- 订阅/取消、session replacement、window close、plugin dispose 做 leak tests；监控 RSS、heap、FD、listener 数。
- provider retry/backoff、MCP reconnect、package timeout、network offline 和 model catalog cache 使用 Pi 原生机制并加 OpenBuddy policy。

**初始门槛（须基线校准，不是当前实测）：** renderer ready P50≤3s/P95≤6s；本地 IPC p95≤50ms；事件丢失 0；队列有界；20 次 reload 无 listener 增长；100 session 压测无线性 RSS 增长。真实 LLM TTFT 按 provider/model 分层，不得用 mock 混入。

### Phase 6：E3/E4 发布门禁（持续）

- Linux/Windows/macOS runner 分别完成 build、package、installer smoke；签名/公证仅在对应 CI secret 环境验证。
- 至少一个真实 provider、一个 exact-version 外部 Pi package、一个真实 Electron UI journey 达到 E3。
- benchmark 输出 JSON/CSV，包含 commit、环境、Node/Electron/Pi version、sample count、cold/warm、provider/model、P50/P95/P99、错误率、成本和原始路径。
- release gate 运行 typecheck、lint、unit/contract、boundary、storage、closed-loop、build、platform smoke、performance regression。

**出口：** 所有结论可追溯到代码、测试、原始 benchmark 或 CI artifact；不能用历史日志替代当前结果。

## 7. 验收矩阵

| 领域        | 必须证明                                                                     | 最低证据                 |
| ----------- | ---------------------------------------------------------------------------- | ------------------------ |
| Agent       | prompt、多轮流式、tool、abort、steer/follow-up、retry                        | E2；真实 provider E3     |
| Session     | new/resume/switch/fork/clone/tree/label/metadata/restart                     | E2；冷恢复 E3            |
| Context     | auto/manual compact、branch summary、context/cost、失败恢复                  | E2；长上下文 E3          |
| Extension   | builtin/user/package load、command/tool/provider、dispose/reload             | E1/E2；外部包 E3         |
| UI          | select/confirm/input/editor/notify/status/widget、cancel/timeout             | E2                       |
| Safety      | project trust、permission、dangerous bash、secret redaction、tenant boundary | 负向 E2/E3               |
| Product     | task、workspace、assistant、expert/skill、connector、artifact、automation    | deterministic journey E2 |
| Transport   | preload allowlist、schema、sequence、cursor、reconnect、backpressure         | E2                       |
| Persistence | SQLite migration、Pi JSONL recovery、metadata consistency                    | E2/E3                    |
| Performance | startup/TTFT/stream/IPC/tool/reload/memory/compaction                        | E4                       |
| Release     | typecheck/test/build/sign/package/platform smoke                             | CI artifacts             |

## 8. 推荐执行顺序（后续 agent 直接照此拆任务）

1. **先做 Phase 0**：生成当前 inventory 和 owner/authority 表，修文档漂移；不先扩市场。
2. **做 Phase 1.1**：拆 domain deps、canonical event envelope、generation fence；这是所有后续功能的依赖。
3. **做 Phase 2.1**：task/session/artifact schema 和 deterministic fake-provider loop；先建立真实产品闭环。
4. **做 Phase 3.1**：package trust、权限、失败回滚、reload/dispose leak；再开放用户扩展。
5. **做 Phase 5 基线**：在稳定 contract 上测 streaming/IPC/reload/memory，再优化 renderer 和队列。
6. **做 Phase 4 marketplace/UI**：只接 curated/exact-version package；真实外部包单独 E3。
7. **最后做 Phase 6 发布**：把跨平台、真实 provider、签名和性能报告作为 release gate。

## 9. 明确不做的事情

- 不在 OpenBuddy 内复制 Pi Agent loop、ModelRuntime、SessionManager、ResourceLoader 或 compaction 算法。
- 不把所有 Cordis service 强行改成 Pi extension；企业、邮件、协作、支付、存储等服务继续由 OpenBuddy owner 管理。
- 不把 Pi TUI/Ink/custom component 直接塞入 React renderer；必须走 RPC-safe adapter。
- 不把 marketplace/gallery 的元数据当安全认证或功能交付。
- 不默认执行第三方包 lifecycle scripts，不隐式下载/执行远程代码。
- 不用删除 LOC、fixture 通过或静态 import 数量证明产品完成。
- 不推测 WorkBuddy 未公开的私有协议、云服务、商业实现或内部数据结构。

## 10. 风险登记

| 风险                      | 影响                                 | 缓解                                                        |
| ------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| Pi 上游 breaking change   | runtime/extension/resource 失效      | exact resolved version、types/fixture contract、升级独立 PR |
| 两套状态源分叉            | session/task/metadata 丢失或重复扣费 | owner 表、SQLite/Pi 分层、shadow compare、原子迁移          |
| 第三方 extension 任意代码 | 凭据、文件、网络、shell 风险         | trust、hash/license、权限、curated、quarantine、回滚        |
| reload stale context      | 旧 listener/事件写入新 UI            | generation fence、whole-session reload 语义、dispose tests  |
| 高频事件导致渲染/内存退化 | 长流卡顿、丢事件、崩溃               | bounded queue、coalescing、selector store、E4 benchmark     |
| 文档重复且互相矛盾        | 错误实现和错误发布承诺               | 3.0 作为路线索引，历史文档标注版本和状态                    |
| 企业能力被 Pi 化削弱      | 多租户/审计/计费失效                 | OpenBuddy Product Kernel owner 明确、负向测试               |
| 无桌面/无凭据环境误报     | 发布质量和可信度下降                 | `not-run` 明确记录，真实 provider/platform 单独证据         |

## 11. 当前验收结论

本轮已完成**全量静态分析 + Phase 0 inventory + Phase 1 eventId 对齐**（E1/E2 Verified）。以下是已验证结果和已知约束：

**已验证（E1/E2）：**

| 结论                       | 证据                                                                                                                     | 位置                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Phase 0 inventory          | ✅ `evidence/pi-capability-inventory.json` 生成（10 builtin、12 adapter、5 runtime API）                                 | `evidence/pi-capability-inventory.json`        |
| eventId 字段缺失           | ✅ 已修复：`SessionEventRecord.eventId?: string` + `randomUUID()`                                                        | `electron/main/agent/pi-event-bridge.ts:10-12` |
| emit 返回类型 pre-existing | ✅ 已修复：`emit(): void`（替代 `unknown`）                                                                              | `electron/main/agent/pi-event-bridge.ts:7`     |
| typecheck                  | ✅ `tsc --noEmit -p tsconfig.json` 0 errors                                                                              | 直接 tsc                                       |
| event bridge regression   | ✅ 9/9；覆盖 eventId UUID 格式、唯一性和 snapshot 保留                     | `electron/main/agent/pi-event-bridge.test.ts` |
| task storage lifecycle    | ✅ 7/7；TaskService.close() 在 plugin teardown 释放 SQLite driver            | `electron/main/agent/host-modules/__tests__/task-service.test.ts` |
| vitest Pi events + session | ✅ 82/82（pi-extensions 39 + pi-session-runtime 12 + plugin-event-bus 19 + observability 5 + lifecycle 4 + forwarded 3） | `vitest run --reporter=dot`                    |
| streaming benchmark        | ✅ delta-reducer 17.2µs/iter，frame headroom 15.29ms                                                                     | `scripts/perf/streaming-bench.mjs`             |
| ipc-latency benchmark      | ✅ session.list p95=0.988ms，plugin.snapshot p95=1.102ms                                                                 | `scripts/perf/ipc-latency.mjs`                 |
| build                      | ✅ `pnpm build` 成功（16.9s）                                                                                            | moon `openbuddy:build`                         |

**已知约束：**

- Electron smoke：❌ Linux 无 X server/Wayland（环境约束，preflight 正确报告 `desktopSmokeReady: false`）
- 真实 provider E3：⬜ 未执行（无凭据）
- 全量 vitest：⬜ 未执行（600 files 超时）
- moon typecheck：需要 Node ~22，环境仅有 Node 24；直接 tsc 无此约束

后续任何“通过”“已完成”“性能达标”表述都必须附当前 commit、命令、样本和 evidence level；不得直接复用旧 plan 中与当前 checkout 不一致的数字。

## 12. 官方 Pi 资料索引

以当前安装依赖对应的 Pi 文档为准，同时保留公开入口供后续复核：

- Pi 首页：<https://pi.dev/>
- Package gallery：<https://pi.dev/packages>
- SDK：<https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md>
- Extensions：<https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md>
- Packages：<https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md>
- RPC：<https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md>
- Compaction：<https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md>
- Providers：<https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md>

外部网页搜索在本环境因当前模型不支持 native web search 未执行；本计划没有把未核实的网页内容作为事实，采用仓库源码和本地安装的 Pi 官方文档作为主要依据。
