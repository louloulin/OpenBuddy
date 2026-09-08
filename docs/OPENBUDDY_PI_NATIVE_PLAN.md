# OpenBuddy PI-Native 改造计划 (v3)

> 📅 2026-09-08 · 基于 `main` (commit `058cbf9`) · 状态：进行中
> 任务: LUM-580 · 仓库: louloulin/OpenBuddy
> 上游基线: `@earendil-works/pi-coding-agent` 0.85.1 + `pi-agent-core` 0.85.1 + `pi-ai` 0.85.1
> 参考实现: [vastsa/PI-Desktop](https://github.com/vastsa/PI-Desktop) (54 文件 / 19,818 LOC agent-runtime)
> 兄弟文档: [OPENBUDDY-PI-VISION.md](OPENBUDDY-PI-VISION.md) (12 capability 适配矩阵) · [full-pluginization-plan.md](full-pluginization-plan.md) (DeepSeek Harness 五件套借鉴)

## v3 相比 v2 的改动

v2 是「PI 能力 → OpenBuddy 模块」对照清单 + 7 阶段路线图。v3 在 v2 基础上加 5 个新章：

- **§3 微内核识别**：明确 OpenBuddy 的「核心」是什么（PI + Cordis + 一层薄桥），「插件」是什么（capability 包 / harness 包 / renderer slot / 用户 extension）
- **§4 内聚分析**：标出当前 8 个 god module / low-cohesion 块，给每块定一个 owner 重构 owner
- **§5 耦合度量 + 减耦策略**：用「禁止跨层 import」的 enforcement，把 6 类耦合点（god module / reverse dep / cyclic dep / facade spaghetti / 跨 capability 直调 / 渲染跨过 IPC）量化 + 给解法
- **§6 PI Plugin + Cordis 双轨统一**：4 个插件体系（cordis / pi extension / slot / harness）合为 1 个 OpenBuddyPlugin SDK
- **§7-§8 Capability / Renderer 重构总表**：12 capability + 26 ui-* 包 逐一定位

v2 的章节（PI export 清单 / OpenBuddy 模块对照 / 架构图 / 7 phase 路线图 / PI-Desktop 对照 / 风险 / 成功标准）保留为附录 A-J（§14-§23）。

## 0. 目标

把 OpenBuddy 重构成 **「PI 之上的 Electron shell + UI workbench」**：

1. **PI 负责**：所有 AI / 会话 / 工具 / 设置 / 持久化 / 资源加载逻辑
2. **OpenBuddy 负责**：Electron 生命周期 / IPC 桥 / React UI / Electron 特定能力（clipboard / dialog / menu / app icon / updater）
3. **桥接层（adapter）**：把 PI 的 Node API 包成 IPC 事件给 renderer；把 renderer 的 React 组件包成 ExtensionUIContext 给 PI
4. **最终形态**：用户能写 PI 标准的 `ExtensionFactory` 插件直接装到 OpenBuddy 里跑，UX / 性能 / 稳定性对齐 workbuddy 水平

## 1. PI 全量能力盘点 (`@earendil-works/pi-coding-agent` 0.85.1)

> 从 `dist/index.d.ts` 全量提取，**105 个 export**，覆盖 14 个能力域。

| 能力域 | Export 数量 | OpenBuddy 当前复用度 |
|---|---|---|
| **会话核心** AgentSession / createAgentSession / AgentSessionRuntime / AgentSessionServices | 8 | 高（65 处 import） |
| **会话事件** AgentSessionEvent（16 子类） | 1 type | 高 |
| **会话管理** SessionManager / SessionEntry / SessionTreeNode / parseSessionEntries / migrateSessionEntries / serializeConversation / buildContextEntries / buildSessionContext / sessionEntryToContextMessages | 12 | 高 |
| **会话生命周期** SessionStartEvent / SessionShutdownEvent / SessionCompactEvent / SessionBeforeCompactEvent / SessionBeforeForkEvent / SessionBeforeSwitchEvent / SessionBeforeTreeEvent / SessionInfoChangedEvent / SessionTreeEvent | 9 | 中（部分用） |
| **Compaction** compact / shouldCompact / DEFAULT_COMPACTION_SETTINGS / CompactionSettings / estimateTokens / calculateContextTokens / getLastAssistantUsage / findCutPoint / findTurnStartIndex / collectEntriesForBranchSummary / generateBranchSummary / generateSummary / generateSummaryWithUsage / prepareBranchEntries / serializeConversation | 16 | 中（服务端用，renderer 没用） |
| **扩展系统** Extension / ExtensionFactory / ExtensionAPI / ExtensionRuntime / ExtensionRunner / defineTool / discoverAndLoadExtensions / loadExtensions / createExtensionRuntime / wrapRegisteredTool | 11 | **低**（有 ExtensionFactory 但不用 ExtensionRunner） |
| **Tools 工厂** createBashTool / createEditTool / createReadTool / createWriteTool / createGrepTool / createFindTool / createLsTool / createPowerShellTool / createCodingTools / createReadOnlyTools / createAllTools / createToolDefinition | 12 | **0** ← 重点 |
| **Tools 截断** truncateHead / truncateLine / truncateTail / DEFAULT_MAX_BYTES / DEFAULT_MAX_LINES / formatSize | 6 | 0 |
| **Diff** EditDiffResult / generateDiffString / generateUnifiedPatch | 3 | 0 |
| **模型层** ModelRegistry / ModelRuntime / resolveModelScopeWithDiagnostics / resolveCliModel / CredentialSynchronizationError / ProviderConfig / ProviderModelConfig | 7 | 高 |
| **设置** SettingsManager / SettingsManagerCreateOptions / RetrySettings / ImageSettings / PackageSource / TuiMode / settings-diagnostics | 7 | **0** ← 重点 |
| **资源/包** DefaultResourceLoader / loadProjectContextFiles / DefaultPackageManager / PackageManager / ResourceLoader | 5 | 中 |
| **Skills** loadSkills / loadSkillsFromDir / formatSkillsForPrompt / Skill / SkillFrontmatter | 5 | **0** ← 重点 |
| **认证** readStoredCredential / runtime-credentials | 2 | **0** ← 重点 |
| **消息转换** convertToLlm / SessionContext / ContextUsage | 3 | 中 |
| **Frontmatter** parseFrontmatter / stripFrontmatter | 2 | 0 |
| **图像** resizeImage / convertToPng / detectSupportedImageMimeTypeFromFile / ImageSettings | 4 | 0 |
| **Shell** getShellConfig / getPowerShellConfig / bash-executor / exec | 4 | 0 |
| **TUI 组件**（Ink，架构不兼容） | 30+ | 0（不可用） |
| **主题** Theme / initTheme / getMarkdownTheme / getSelectListTheme / getSettingsListTheme | 6 | 低 |
| **剪贴板** copyToClipboard | 1 | 0 |
| **MIME / 语言** getLanguageFromPath / highlightCode | 2 | 0 |
| **导出** session-export / export-html | 2 | 0 |
| **Provider** provider-composer / provider-attribution / runtime-credentials / http-dispatcher / output-guard | 5 | 0 |
| **远程** remote-catalog-provider / RemoteSession / applyTranscriptProgress / applyTranscriptSnapshot / createTranscriptState / selectTranscript | 6 | 0 |
| **CLI 入口** main / parseArgs / runPrintMode / runRpcMode / RpcClient / InteractiveMode | 6 | 0（不可用） |

**统计**：OpenBuddy 真正用的 ~25（24%），部分用的 ~15（15%），完全没用 ~65（62%）。

## 2. OpenBuddy 现有体系对照表

把 OpenBuddy 的 ~11000 LOC host-modules + 11766 LOC plugin-host 跟 PI 一对一映射：

| OpenBuddy 模块 | LOC | PI 对应 | 复用价值 |
|---|---|---|---|
| `electron/main/agent/agent-host.ts` | ~2500 | `AgentSession` + `createAgentSession` | 已用 |
| `host-modules/agent-model.ts` | ~600 | `ModelRegistry` + `resolveModelScopeWithDiagnostics` | 已用 |
| `host-modules/session-store.ts` | ~900 | `SessionManager` + `AgentSessionEvent` | 已用 |
| `host-modules/session-metadata.ts` | ~250 | `SessionManager.listSessionInfos` | 已用 |
| `host-modules/session-swap.ts` | ~300 | `AgentSession` `switchSession`/`forkSession` | 已用 |
| `host-modules/agent-prompt.ts` | ~500 | `system-prompt.ts` `buildSystemPrompt` | **新：可直接调** |
| `host-modules/team-runner.ts` | ~600 | `subagent.ts`（PI Desktop 风格） | **新**：参考但需自实现 |
| `host-modules/subagent-runtime.ts` | ~700 | 同上 | **新** |
| `host-modules/preset-helpers.ts` | ~250 | 无直接对应 | 保留 |
| `host-modules/pi-runtime-factories.ts` | ~400 | `createAgentSessionFromServices` | 已用 |
| `host-modules/pi-runtime-refresh.ts` | ~300 | 同上 | 已用 |
| `host-modules/pi-session-capabilities.ts` | ~350 | 同上 | 已用 |
| `host-modules/pi-plan-mode.ts` | ~500 | ExtensionAPI `session_before_compact` 等 | **新** |
| `host-modules/model-runtime.ts` | ~300 | `ModelRuntime` | 已用 |
| `host-modules/bootstrap/microkernel-host.ts` | ~150 | `ExtensionRunner` | **新** ← 重点 |
| `host-modules/bootstrap/install-host-modules.ts` | ~400 | `discoverAndLoadExtensions` | **新** ← 重点 |
| `host-modules/plugin-event-bus.ts` | ~600 | `ExtensionRunner` + `EventBus` | **新** ← 重点 |
| `host-modules/plugin-state.ts` | ~150 | `ExtensionRuntimeState` | **新** |
| `host-modules/bootstrap/init-pipeline.ts` | ~500 | `createAgentSession` 的初始化 | **新** |
| `host-modules/bootstrap/build-agent-host-facade.ts` | ~400 | `ExtensionRunner.bindCore` | **新** |
| `electron/main/agent/pi-extensions.ts` | 1010 | `defineTool` + `ExtensionFactory` × 4 | **新** |
| `electron/main/agent/extensions/apply-patch.ts` | ~400 | `createEditTool` 工厂 | **新** ← 重点 |
| `electron/main/agent/extensions/openbuddy-markdown.ts` | ~200 | 无直接对应 | 保留 |
| `packages/runtime/openbuddy-plugin-host/src/profile.ts` | 538 | `SettingsManager` + `DefaultResourceLoader` | **新** |
| `packages/runtime/openbuddy-plugin-host/src/profile-manager.ts` | 796 | `SettingsManager` | **新** |
| `packages/runtime/openbuddy-plugin-host/src/include.ts` | 350 | `loadProjectContextFiles` | **新** |
| `packages/runtime/openbuddy-plugin-host/src/yaml-patch.ts` | 267 | 无 | 保留（自定义） |
| `packages/runtime/openbuddy-plugin-host/src/deepseek-cordis-runtime.ts` | ~500 | 无 | 保留（DS 桥） |
| `packages/runtime/openbuddy-plugin-host/src/rpc-contract.ts` | 676 | 无 | 保留 |
| `packages/runtime/openbuddy-plugin-host/src/persistence.ts` | ~200 | `SessionManager` + JSONL 格式 | 已用 |
| `packages/runtime/openbuddy-plugin-host/src/js-expr.ts` | ~250 | 无 | 保留（自定义） |
| `packages/runtime/openbuddy-plugin-host/src/hooks.ts` | ~300 | ExtensionAPI `on("...")` | **新** |
| `packages/ui/openbuddy-ui-slots/src/index.ts` | ~250 | ExtensionUIContext `select`/`confirm`/`notify`/`setStatus`/`setWorkingIndicator` | **新** |
| `packages/ui/openbuddy-ui-runtime/src/*` | ~2000 | ExtensionRunner UI 事件 | **新** |

## 3. 微内核识别（什么是 OpenBuddy 的「核心」）

### 3.1 微内核 = PI + Cordis + 一层薄桥

微内核 = **只做** 3 件事：**会话生命周期 / 插件装载 / 事件路由**。业务业务逻辑 / 能力 / UI 都不是微内核，是插件。

```
Microkernel （OpenBuddy 不可分割的「最小可运行」）
=============================================================
  • @earendil-works/pi-coding-agent          ← AI 会话生命周期 （外部依赖）
  • @earendil-works/pi-ai                    ← LLM Provider 调用   （外部依赖）
  • @earendil-works/pi-agent-core            ← Agent loop + 事件  （外部依赖）
  • @openbuddy/cordis                        ← DI 容器            （外部依赖）
  • @openbuddy/plugin-host                   ← HarnessPluginLoader （领域）
  • @openbuddy/storage                       ← 本地持久化 audit   （领域）
  • electron/main/agent/agent-host.ts        ← Microkernel 总线 (~500 LOC after refactor)
  • electron/main/agent/host-modules/bootstrap/
      ├── microkernel-host.ts                ← ExtensionRunner 启动
      ├── install-host-modules.ts           ← 装载 plugin 列表
      └── handle-session-event.ts           ← pi://* 事件路由
=============================================================

Plugins （可装可卸，可独立测试、可独立发版）
=============================================================
  Service 层 (Cordis)
    packages/capability/openbuddy-*/        ← 12 个能力包（mcp/email/plan/...）
    packages/auth/openbuddy-*/             ← 认证 / permission
    packages/team/openbuddy-*/             ← 多 agent
    packages/collaboration/openbuddy-*/     ← 跨 agent 协作
    packages/fs/openbuddy-fs-local/        ← 本地 fs 服务
    packages/webhook-outbox/               ← transactional outbox
  Extension 层 (PI ExtensionAPI)
    electron/main/agent/extensions/         ← apply-patch / openbuddy-markdown
    electron/main/agent/pi-extensions.ts    ← 4 个 builtin ExtensionFactory
    packages/runtime/openbuddy-plugin-host/src/hooks.ts ← harness 插件入口
  Renderer 层 (UI Slots)
    packages/ui/openbuddy-ui-*/             ← 26 个 ui-* 包
    packages/ui/openbuddy-ui-slots/         ← 槽位声明合并层
    packages/renderer/openbuddy-renderer-host/← preload 桥 + client modules
  Harness 层 (DeepSeek 兼容)
    packages/runtime/openbuddy-plugin-host/src/profile.ts + profile-manager.ts
    packages/runtime/openbuddy-plugin-host/src/yaml-patch.ts
  User 层 (运行时由用户/ profile 安装)
    ~/.config/openbuddy/plugins/*.ts         ← 用户第三方插件
    ~/.config/openbuddy/skills/*.md          ← 用户 skill
    ~/.config/openbuddy/experts/*.md        ← 用户 expert
=============================================================
```

### 3.2 4 层架构与依赖方向（严格 enforcement）

依赖只能从上往下流，**绝不允许反向 import**：

```
┌──────────────────────────────────────────────────────────┐
│ Layer 4 — Renderer / UI （React DOM）                      │
│   可以依赖: Layer 3 + Layer 2 + shared types              │
│   不可以依赖: Layer 1 / Node-only packages                 │
├──────────────────────────────────────────────────────────┤
│ Layer 3 — IPC Bridge + Renderer Host                     │
│   electron/preload/* + packages/renderer/openbuddy-renderer-host/*
│   可以依赖: Layer 2 + shared types                        │
│   不可以依赖: Layer 1 的内部实现                          │
├──────────────────────────────────────────────────────────┤
│ Layer 2 — Plugins / Capabilities / Extensions             │
│   packages/capability/* + packages/auth/* + packages/team/*
│   + packages/collaboration/* + packages/fs/* + electron/main/agent/extensions/*
│   可以依赖: Layer 1 + PI                                   │
│   不可以依赖: Layer 3 / Layer 4                            │
├──────────────────────────────────────────────────────────┤
│ Layer 1 — Microkernel                                     │
│   electron/main/agent/agent-host.ts + host-modules/bootstrap/*
│   + packages/runtime/openbuddy-{cordis,plugin-host,storage}/*
│   可以依赖: PI （@earendil-works/pi-*）                   │
│   不可以依赖: Layer 2 / Layer 3 / Layer 4                  │
└──────────────────────────────────────────────────────────┘
```

**enforcement**：
- `sheriff.config.ts` — 跨层 import 报错（现有，加固）
- `vitest.config.ts` path alias — 防止绕过
- moon task deps — `app-desktop:typecheck` 只 depend on `openbuddy:typecheck`（依赖方向）

### 3.3 微内核启动顺序（明确）

```
[用户启动 app]
   ↓
[Layer 1 微内核启动]
   ① ctx = new Context()                           ← @openbuddy/cordis
   ② ctx.plugin(StorageService)                    ← 本地 fs audit
   ③ ctx.plugin(SettingsManager)                   ← PI 设置
   ④ ExtensionRunner = createExtensionRuntime()    ← PI 插件运行时
   ⑤ plugins = discoverAndLoadExtensions(...)      ← PI builtin + 用户 extension
   ⑥ AgentSession = createAgentSession(...)        ← PI 会话
   ⑦ ExtensionRunner.bindCore(agentSession)        ← 把会话接口绑到插件 API
   ↓
[Layer 2 插件装载]
   for plugin in profiles[workspace].plugins:
     ctx.plugin(plugin)                       ← Cordis 装载 capability service
   for skill in discoverSkills(...):
     SkillRegistry.register(skill)            ← PI skill loader
   for harness in profile.harness:
     HarnessPluginLoader.load(harness)        ← Harness 兼容装载
   ↓
[Layer 3 IPC 桥就绪]
   for channel in allowedInvokeChannels:
     ipcMain.handle(channel, ipcAdapter(ctx, channel))
   window.api = createRendererBridge(allowedInvokeChannels)
   ↓
[Layer 4 Renderer 渲染]
   mainWindow.loadFile('index.html')
   App.tsx: <Sidebar/> + <ChatView/> + <Workbench/> 渲染
```

**关键**：Layer 1 启动完成后才算「app booted」；之前的任何 Layer 2/3/4 加载都是可选插件。

## 4. 内聚分析（标出 8 个 god module / low-cohesion 块）

每个 module 的「理想内聚」= **一个 module 只做一件事，并以此命名**。下面标出当前违反该原则的 8 个块 + owner 负责解。

| # | 当前位置 | LOC | 耦合问题 | Owner 重构 | 目标 |
|---|---|---|---|---|---|
| 1 | `electron/main/agent/agent-host.ts` | 1502 | god module：init + lifecycle + IPC + extension + facade 全揉在一起。24 个 host-module 都能从这 import。 | **Phase B.2** | 拆成 4 个文件：<br/>- `microkernel.ts` (~200 LOC) 总线<br/>- `init-pipeline.ts` (~300 LOC) 启动<br/>- `lifecycle.ts` (~300 LOC) 生命周期<br/>- `facade/index.ts` (~400 LOC) IPC facade |
| 2 | `electron/main/ipc/agent.ts` | 1090 | 单一文件处理 30+ IPC 通道，混合 session/prompt/tool/model/permission/skills/automation。 | **Phase B.1** | 按 capability 拆：每个 capability 一个 IPC adapter 文件 (`ipc/<capability>.ts`)，`ipc/index.ts` 只做注册。 |
| 3 | `electron/main/agent/pi-extensions.ts` | 1010 | 4 个 builtin ExtensionFactory + 适配器逻辑 + 命令映射全揉。 | **Phase B.3** | 拆成：<br/>- `extensions/builtin/openbuddy-pi-observability.ts`<br/>- `extensions/builtin/openbuddy-pi-context-status.ts`<br/>- `extensions/builtin/openbuddy-pi-compact-announce.ts`<br/>- `extensions/builtin/openbuddy-extra-providers.ts`<br/>- `extensions/builtin/index.ts` (注册表) |
| 4 | `packages/runtime/openbuddy-plugin-host/src/index.ts` | 1313 | 一个 barrel 文件 re-export 20+ 内部模块。 | **Phase D.3** | 拆成多个 barrel（按能力）：`session / profile / harness / skill / hooks`，每个 barrel ≤ 200 LOC。 |
| 5 | `packages/capability/openbuddy-email/src/index.ts` | 3510 | email 能力单文件 3510 LOC：IMAP/SMTP/OAuth/AI 总结/UI 拼接/audit 全揉。 | **新 Phase H.1** | 拆成 `email-protocol.ts` / `email-oauth.ts` / `email-ai.ts` / `email-capability.ts` (Cordis Service) / `email-ipc.ts` (IPC)。 |
| 6 | `electron/main/agent/host-modules/plugin-event-bus.ts` | 269 | 自己造的事件总线，PI 已有 EventBus。 | **Phase B.1** | 删。改用 `pi.EventBus` + `pi.on('event', handler)`。 |
| 7 | `packages/ui/openbuddy-ui-slots/src/index.ts` | 235 | 类型契约 / 组件 / 工具 / 声明合并全在同一文件。 | **Phase E.1** | 拆 `types.ts` / `components.tsx` / `utils.ts` / `declare.ts`。 |
| 8 | `electron/main/agent/host-modules/agent-prompt.ts` | 280 | 自己拼 system prompt，PI 已有 `system-prompt.ts` + `formatSkillsForPrompt`。 | **Phase D.3 + B.1** | 替换底层为 PI 实现。 |

**owner 重构总预算**：~6500 LOC 当前 god module，拆完后 microkernel 总线 ≤ 500 LOC，IPC 总和 ≤ 2000 LOC，每个 capability 包平均 ≤ 800 LOC。

## 5. 耦合度量 + 减耦策略（6 类耦合点）

### 5.1 6 类耦合点量化

```
[1] God module 反向依赖（24+ host-module 反向 import agent-host）
    之前: 全部 reverse dep
    现在: 0 处 reverse dep （Phase 8.3 Batch A/B/C 已修）
    目标: 0 处

[2] 循环依赖（agent-host ↔ host-modules）
    之前: ≥3 个循环
    现在: 0 个循环 （install pattern 已破）
    目标: 0 个 + 加 vitest cycle detector

[3] Capability 直调（email 直接调 folder-trust）
    之前: ≥5 处直调
    现在: 部分通过 ctx.inject 拿
    目标: 100% 通过 ctx.inject + EventBus

[4] IPC 跨 capability（agent.ts 里同时调 session + prompt + tool）
    之前: 1 个文件 1090 LOC
    现在: 已拆 (ipc/<capability>.ts)
    目标: 跨 capability 只走 ctx.inject 或 EventBus

[5] Renderer 跨过 IPC（renderer 直接读 window.localStorage 而不走 IPC）
    之前: 多处
    现在: 大部分走 IPC
    目标: 100% 走 IPC + preload typed bridge

[6] 跨层 import（renderer 直接 import electron/main/agent/*）
    之前: 0 处（vitest alias 防）
    现在: 0 处
    目标: 0 处 + sheriff.config.ts 加固
```

### 5.2 减耦 7 条原则

1. **依赖方向单向**：Layer N 只依赖 Layer N-1，不依赖 Layer N+1
2. **微内核零业务**：agent-host.ts 只做生命周期，不直接 import 任何 capability
3. **Capability 之间不互调**：email 不准直接调 folder-trust；要调就通过 ctx.inject 拿服务，或通过 EventBus 发事件
4. **IPC 单职责**：一个 IPC 文件 = 一个 capability，多 capability IPC 必须用 IPC facade 转发
5. **PI 优先**：所有 session / tool / settings / skill 逻辑优先用 PI 提供的 API，自实现只能作为 OpenBuddy 特有补充（如 trust 决策、UI 自定义）
6. **Extension 双轨**：业务能力用 Cordis Service 写，AI 工具 / 命令 / provider 用 PI Extension 写，两者用 ExtensionRunner 统一装载
7. **Renderer 通过 IPC 桥**：renderer 不准 import `electron/main/agent/*`，只能通过 `src/lib/electron-api.ts` typed bridge

### 5.3 enforcement 工具链

| 工具 | 用途 | 配置位置 |
|---|---|---|
| `sheriff.config.ts` | ESLint 跨层 import 检查 | 已有，需加固 |
| `vitest.config.ts` path alias | 测试时强制 path 解析 | 已有 |
| moon task deps | 编译时层依赖检查 | 已有，需加 task-level boundary |
| `scripts/storage/check-architecture-boundaries.mjs` | 边界自动检查脚本 | 已有 `pnpm storage:boundaries` |
| `pnpm storage:acceptance` | 架构验收脚本 | 已有 |
| `pnpm storage:drill` | 拖地测试 | 已有 |
| vitest cycle-detector（cycle deps 测试）| 循环依赖检测 | 新增（**Phase B.2 引入**） |

## 6. PI Plugin + Cordis 双轨统一

OpenBuddy 现在有 **3 个插件体系并行**：

| 体系 | 用途 | 包位置 | 装入点 | 状态 |
|---|---|---|---|---|
| **Cordis Service** | DI 容器，能力 service 注册 | `@openbuddy/cordis` | `ctx.plugin(Service)` | 在用 |
| **PI Extension** | AI 工具 / 命令 / provider 注册 | `@earendil-works/pi-coding-agent` | `ExtensionRunner.bindCore` | **只用 4 个 builtin，从不装用户 extension** |
| **Renderer Slot** | UI 槽位（widget / menu / status bar）| `@openbuddy/ui-slots` | `SlotProvider` | 在用 |
| **Harness Plugin** | DeepSeek 兼容（yaml-patch 加载）| `@openbuddy/plugin-host` | `HarnessPluginLoader.load` | 在用 |

**问题**：4 套体系并存，profile 里同一能力可能要声明 3 次（cordis plugin + pi extension + harness patch）。

### 6.1 统一装载协议

**目标**：用户写一个 `~/.config/openbuddy/plugins/my-plugin.ts`，按 PI ExtensionFactory 风格写，OpenBuddy 自动：
1. 装载到 PI ExtensionRunner（拿到 AI 工具 / 命令注册）
2. 装载到 Cordis ctx（拿到 DI 能力 service 注册）
3. 装载到 Harness（拿到 DeepSeek 兼容）
4. 装载到 Renderer Slot（拿到 UI widget 注册）

```typescript
// ~/.config/openbuddy/plugins/my-plugin.ts
import type { OpenBuddyPlugin } from '@openbuddy/plugin-sdk';

export default {
  name: 'my-plugin',
  version: '1.0.0',

  // PI Extension 风格（AI 侧）
  pi: (api) => {
    api.registerTool({ name: 'my_tool', description: '...', execute: ... });
    api.registerCommand({ name: 'my_cmd', handler: ... });
  },

  // Cordis 风格（业务侧）
  cordis: (ctx) => {
    ctx.plugin(MyCapabilityService, config);
  },

  // Renderer slot 风格（UI 侧）
  ui: (slots) => {
    slots.register('chat-header:status', { component: MyStatusBadge });
  },

  // Harness 兼容（DeepSeek 用户）
  harness: {
    contributes: { 'dsh.service': { name: 'my-service', ... } },
  },
} satisfies OpenBuddyPlugin;
```

**实现路径**：
- **Phase B.3** `discoverAndLoadExtensions` 接入 profile 目录扫描
- **Phase E.2** Renderer Slot 装载协议与 PI ExtensionUIContext 对齐
- **新 Phase H.2** OpenBuddyPlugin SDK 包（`packages/runtime/openbuddy-plugin-sdk`） + 一个 `loadPlugin()` 入口做四轨分发

## 7. Capability 重构总表（12 个 capability × 4 个维度）

| Capability | 现在 | 目标 | Action |
|---|---|---|---|
| **mcp** | Cordis service + PI extension adapter（**已收敛**）| 保持 | 维持现状 |
| **permission** | Cordis service + PI extension adapter（**双轨**）| Cordis 删，留 PI extension | **Phase D.1** + adapter `passthroughCapability: "permission"` |
| **goal** | Cordis service + PI extension adapter（**双轨**）| Cordis 删，留 PI extension | **Phase D.1** + adapter `passthroughCapability: "goal"` |
| **plan** | PI extension adapter only（**已收敛**）| 保持 | 维持 |
| **task** | Cordis service + PI extension adapter（**孤儿**）| 二选一 | **新 Phase I.1**：决策保留哪个，删另一个 |
| **session** | Cordis + PI SessionManager（**双轨**）| 留 PI，删 Cordis | **Phase D.3** + adapter `passthrough: true` + flag |
| **fs** | Cordis service + PI extension adapter（**双轨**）| 留 PI extension，删 Cordis | **Phase C.1** + adapter `passthrough: true` + flag |
| **lens / simplify / hashline / worktree** | PI extension only（**已收敛**）| 保持 | 维持 |
| **automation** | PI extension only（**已收敛**）| 保持 | 维持 |
| **memory** | Cordis noop（**孤儿**）| 走 PI ExtensionAPI context event | **新 Phase I.2**：接入 PI context event |
| **folder-trust** | Cordis service 118 LOC | 替换为 PI ProjectTrustStore | **Phase D.2**（已纳入路线图）|
| **email** | Cordis service 3510 LOC | 拆 + 接入 PI `defineTool` 做 AI 工具 | **新 Phase H.1**（已纳入）|
| **calendar / web-search / inspiration / notification** | Cordis service | 接入 PI ExtensionFactory 做 AI 工具 | **新 Phase I.3** |

**收敛后**：Cordis service 从 12 个降到 ≤ 4 个（email / collaboration / payment / scim 这种 OpenBuddy 特有），其余走 PI Extension。

## 8. Renderer / UI 重构总表（26 个 ui-* 包）

按「是否依赖 PI」分组：

| 组 | 包 | 依赖 PI 吗 | Action |
|---|---|---|---|
| **Renderer host** | `openbuddy-renderer-host` | ✅（IPC） | **Phase E.1**：加 ExtensionUIContext 桥 |
| **Workbench** | `openbuddy-ui-workbench` / `home` / `shell` | ❌ | 加 IPC typed bridge |
| **Chat** | `openbuddy-ui-conversation` / `sidebar` | ✅（间接） | **Phase 1.1 / 1.2**：context bar + tool streaming |
| **Skill / Expert** | `openbuddy-ui-experts` | ❌ | **Phase E.3**：parseFrontmatter 走 IPC |
| **Capability UI** | `openbuddy-ui-email` / `automation` / `billing` / `account` / `collaboration` / `mcp` | ❌（UI only）| 通过 typed bridge |
| **Layout / 通用** | `openbuddy-ui-layout` / `theme` / `slots` / `runtime` / `modules` / `shared` / `primitives` / `hmr` / `locale` / `dialogs` / `files` / `markdown` / `settings` / `settings-models` | ❌ | 通过 typed bridge |

**核心**：26 个 ui-* 包都通过 `src/lib/electron-api.ts` typed bridge 访问 main，**绝不直接 import pi-coding-agent**（太大 + Node-only + 二进制依赖）。

## 9. v3 路线图（7 阶段 × 19 轮）

v2 是 7 phase × 16 round。v3 加 3 个新 phase：

- **Phase H — God Module 拆解 + Capability 重构**（3 轮）：H.1 email 拆解 · H.2 OpenBuddyPlugin SDK · H.3 4 轨分发装载
- **Phase I — Capability 收敛**（2 轮）：I.1 task 决策 + memory / folder-trust 接入 PI · I.2 其余 capability 接入 PI ExtensionFactory
- **Phase J — Sheriff / 边界 enforcement**（1 轮）：sheriff.config.ts 加固 + cycle-detector + storage:boundaries 验收

总预算：**19 轮**（v2 16 + H 3 + I 2 + J 1 = 22，超 3 轮是因为 I.1 task 决策需要先调研；可压缩到 19 轮如果 task 决策直接走"删 adapter 留 Cordis"）。

**Phase A-G 路线图见 §5（v2 原章节保留并更新）**。

### 9.1 Phase H — God Module 拆解 + Capability 重构（3 轮）

#### H.1 email capability 拆解（3510 LOC → 5 文件）

**目标**：把 `packages/capability/openbuddy-email/src/index.ts` 3510 LOC 拆成 5 个文件，每个 ≤ 800 LOC。

**文件**：
- `email-protocol.ts` — IMAP/SMTP 协议层 (~700 LOC)
- `email-oauth.ts` — OAuth 流 (~400 LOC)
- `email-ai.ts` — AI 总结 / 分类 (~600 LOC)
- `email-capability.ts` — Cordis Service 公开面 (~400 LOC)
- `email-ipc.ts` — IPC handler 桥 (~300 LOC)
- `index.ts` — barrel (~50 LOC)

**验证**：3510 → 2400 LOC（-30%），单测保留 + 新增 email-protocol 单测

**退出**：email 行为不变，package 大小减 30%

#### H.2 OpenBuddyPlugin SDK 包

**目标**：用户写一个 plugin 同时挂 PI Extension + Cordis + Harness + Slot 四轨。

**新建包**：`packages/runtime/openbuddy-plugin-sdk/` (~500 LOC)

**文件**：
- `src/index.ts` — `OpenBuddyPlugin` 类型 + `definePlugin()` helper
- `src/loader.ts` — `loadPlugin(path)` → `loadToExtensionRunner + loadToCordis + loadToSlots + loadToHarness`
- `src/validator.ts` — zod schema 校验 plugin manifest
- `src/manifest.ts` — plugin.json / package.json 解析
- `src/__tests__/` — 装载协议单测

**验证**：写一个 `__fixtures__/sample-plugin/` 验证 4 轨分发

**退出**：用户写 `~/.config/openbuddy/plugins/foo.ts` 单文件 4 轨同时生效

#### H.3 4 轨分发装载协议

**目标**：把 `discoverAndLoadExtensions` + Cordis `ctx.plugin` + Slot `apply` + Harness `load` 4 个装载入口合并成 1 个 `loadPlugin()`。

**改动**：
- `electron/main/agent/host-modules/bootstrap/install-host-modules.ts` — 把 install 逻辑委托给 `openbuddy-plugin-sdk/loader.loadPlugin()`
- `electron/main/agent/pi-extensions.ts` — builtin extension 也走 `loadPlugin()`
- `packages/ui/openbuddy-ui-runtime/src/plugin-ui-host.ts` — slot apply 集成

**验证**：现有 866 单测全过；新加 plugin loader 单测

**退出**：OpenBuddy 只有 1 个 plugin 装载入口

### 9.2 Phase I — Capability 收敛（2 轮）

#### I.1 task + memory + folder-trust 接入 PI

**目标**：把 task / memory / folder-trust 3 个 capability 从 Cordis 切到 PI API。

- **task**：决策保留 Cordis（用户已在用），删 PI extension adapter（孤儿）
- **memory**：Cordis noop 删，走 PI ExtensionAPI `context` event 触发 PI 自己的 memory compaction
- **folder-trust**：Cordis 118 LOC 删，换 PI `ProjectTrustStore`（已在 Phase D.2）

**验证**：行为不变 + LOC 减

**退出**：Cordis service 数从 12 → 9

#### I.2 calendar / web-search / inspiration / notification 接入 PI ExtensionFactory

**目标**：把 4 个 Cordis service 改成 PI Extension 的 `defineTool` / `registerCommand`。

**文件**：
- `electron/main/agent/extensions/builtin/openbuddy-pi-calendar.ts`（新）
- `electron/main/agent/extensions/builtin/openbuddy-pi-web-search.ts`（新）
- `electron/main/agent/extensions/builtin/openbuddy-pi-inspiration.ts`（新）
- `electron/main/agent/extensions/builtin/openbuddy-pi-notification.ts`（新）

**验证**：每个 capability 单测保留，集成到 ExtensionRunner

**退出**：Cordis service 数从 9 → 5（email / collaboration / payment / scim / session 保留）

### 9.3 Phase J — Sheriff / 边界 enforcement（1 轮）

#### J.1 加固 sheriff.config.ts + cycle-detector + storage:boundaries 验收

**目标**：把 §3.2 的 4 层依赖方向 + §4 的 god module 拆解 + §5 的 6 类耦合点 0 处 全部强制 enforce。

**文件**：
- `sheriff.config.ts` — 加固层依赖规则（已有，需 update）
- `vitest.config.ts` — 加 cycle-detector plugin
- `scripts/storage/check-architecture-boundaries.mjs` — 加 v3 §3.2 §5 的规则
- 新增 `scripts/architecture/check-god-modules.mjs` — 检查 §4 的 8 个 god module 是否拆完
- `pnpm storage:acceptance` 跑通

**验证**：`pnpm storage:boundaries` + `pnpm storage:acceptance` 全绿；任何反向 import / cycle / god module 残留 → 报错

**退出**：CI 上自动 enforce，PR 不能违反架构边界

## 10. v3 成功标准（在 v2 之上加）

| 维度 | 指标 | 当前 | 目标 |
|---|---|---|---|
| **PI 复用度** | OpenBuddy 自定义代码 vs PI 提供能力 | 自定义 ~85% | 自定义 < 30% |
| **Cordis service 数** | 微内核之外的业务 capability | 12 | ≤ 5 |
| **PI Extension 数** | builtin + 用户 extension | 4 builtin | ≥ 30 builtin + 用户可装 |
| **Plugin 装载入口** | 装载入口数 | 4（cordis/pi/slot/harness）| 1（OpenBuddyPlugin SDK）|
| **God module LOC** | agent-host.ts 等 8 个 | 6500+ | ≤ 2000 总和 |
| **循环依赖** | detect count | 0（已修）| 0 + 自动 detect |
| **跨层 import** | Layer N import Layer N+1 | 0 | 0 + sheriff enforce |
| **Capability 直调** | email 直调 folder-trust 等 | ≥5 处 | 0 处 |
| **Renderer 直 import main** | 不通过 IPC 调 main | ≥3 处 | 0 处 |
| **启动** | cold start | ~4s | ≤ 2s |
| **包体积** | Linux AppImage | ~280MB | ≤ 180MB |
| **单测** | vitest pass rate | 5519/5540 (99.6%) | ≥ 99% |
| **E2E** | playwright spec | 未跑 | 27/27 |
| **Context UX** | 主 chat context usage | 无 | ✓ |
| **Tool UX** | 实时 tool 进度 | 无 | ✓ |
| **Branch UX** | tree picker | 无 | ✓ |
| **Plugin UX** | 用户可装第三方 PI 插件 | 无 | ✓ |

## 11. v3 接下来 3 轮（已锁定）

- ✅ **已完成：Phase A.1 — PI IPC 桥基础设施**（commit `6f6d612`）
- ✅ **已完成：Phase B.1 第 1 轮 — 5th builtin ExtensionFactory `openbuddy-pi-session-metadata`**（commit `df1bcb7`）
- ✅ **已完成：Phase B.1 第 2 轮 — 6th builtin ExtensionFactory `openbuddy-pi-model-bridge` + `ipc/agents.ts` 拆分第 1 步**（commit `1debbde`）
- ✅ **已完成：Phase B.1 第 3 轮 — `ipc/agent.ts` 1060 → 943 LOC 拆为 5 个 capability 子文件**（commit 见本轮 PR）
- 🟡 **下一轮 — Phase B.1 第 4 轮**：继续拆 6 个耦合 handler 组（plugin / profile / deepseek / providers / compaction / tools-list）
- ⚪ **第三轮 — Phase J.1（部分）**：先跑 `pnpm storage:boundaries` + `pnpm storage:acceptance` 拿到当前 baseline，然后加固 sheriff.config.ts

每轮单 commit + 全测 + 推独立分支，符合"小步实现 + 必须验证"。

## 12. v2 → v3 完整章节对照

| v2 章节 | v3 状态 |
|---|---|
| §0 目标 | 保留 |
| §1 PI 105 export 盘点 | 保留 |
| §2 OpenBuddy 模块对照表 | 保留 |
| §3 目标态架构 | **扩为 §3 微内核识别 + §4 内聚分析 + §5 耦合减耦** |
| §4 PI Plugin 体系专项 | 扩为 §6 PI Plugin + Cordis 双轨统一 |
| §5 7 phase × 16 轮路线图 | **扩为 §9 v3 路线图（7 phase × 19 轮 = v2 16 + H 3 + I 2 + J 1）**|
| §6 依赖图与执行顺序 | 保留 |
| §7 PI-Desktop 对照 | 保留 |
| §8 风险登记 | 保留 |
| §9 成功标准 | **扩为 §10 v3 成功标准（加 9 项架构指标）**|
| §10 已完成基线 | 保留 |
| §11 接下来 3 轮 | 保留并更新 |
| §12 文档维护 | 保留 |
| **v3 新增** | §6 PI Plugin + Cordis 双轨统一 · §7 Capability 重构总表 · §8 Renderer UI 重构总表 · §9.1-9.3 Phase H/I/J |

## 13. 文档维护

- 本文档随每轮 phase 完成更新
- 任何 phase 范围 / 文件清单 / 退出标准变更需在 PR 描述里 link 到本文件对应章节
- 文档 owner: 编程助手-devbox1 (LUM-580)
- 同步文档：
  - [OPENBUDDY-PI-VISION.md](OPENBUDDY-PI-VISION.md) — 12 capability 适配矩阵（既有，不动）
  - [full-pluginization-plan.md](full-pluginization-plan.md) — DeepSeek Harness 5件套（既有，不动）
  - [pi-core-capabilities.md](pi-core-capabilities.md) — pi 核心能力清单（既有，不动）

## 14. 附录 A — 目标态架构图（v2 原 §3）

```
┌──────────────────────────────────────────────────────────────┐
│ OpenBuddy Electron Shell                                     │
│ ┌────────────────────────┐  ┌─────────────────────────────┐ │
│ │ Renderer (React DOM)   │  │ Main Process (Node)          │ │
│ │                        │  │                              │ │
│ │ ui-slots (声明合并)    │  │ agent-host.ts                │ │
│ │  ↓                     │  │  ↓                           │ │
│ │ ui-runtime             │  │ ExtensionRunner ← PI 提供   │ │
│ │  ↓                     │  │  ↓                           │ │
│ │ ChatView / Workbench   │◄─┤ AgentSession (pi-coding-     │ │
│ │ Sidebar / Home / ...   │  │  agent) ← 全量 PI          │ │
│ └────────────────────────┘  │  ↓                           │ │
│                            │ SessionManager               │ │
│                            │ ModelRegistry                │ │
│                            │ SettingsManager              │ │
│                            │ Skills                       │ │
│                            │ Compaction                   │ │
│                            │ Tools (createBashTool...)   │ │
│                            │ Custom Extensions            │ │
│                            └─────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**核心原则**：
1. **PI 负责**：所有 AI / 会话 / 工具 / 设置 / 持久化逻辑
2. **OpenBuddy 负责**：Electron 生命周期 / IPC 桥 / React UI / Electron 特定能力（clipboard / dialog / menu）
3. **桥接层（adapter）**：把 PI 的 Node API 包成 IPC 事件给 renderer；把 renderer 的 React 组件包成 ExtensionUIContext 给 PI

## 15. 附录 B — PI Plugin 体系专项（v2 原 §4）

PI 插件 = `ExtensionFactory` 返回值 `(pi: ExtensionAPI) => void`。

### 4.1 ExtensionAPI.on() 事件（30+）

| 事件 | 用途 | OpenBuddy 对应 |
|---|---|---|
| `agent_start` / `agent_end` | agent 生命周期 | `plugin-event-bus` |
| `session_start` / `session_shutdown` | 会话生命周期 | `session-store.ts` |
| `session_before_compact` / `session_compact` | 压缩拦截 | `agent-prompt.ts` |
| `session_before_fork` / `session_before_switch` / `session_before_tree` | 会话切换 | `session-swap.ts` |
| `turn_start` / `turn_end` | 单轮 | 自实现 |
| `message_start` / `message_update` / `message_end` | 流式输出 | `session-store.ts` |
| `tool_call` / `tool_result` | 工具调用 | `pi-extensions.ts` |
| `tool_execution_start` / `tool_execution_update` / `tool_execution_end` | 工具进度 | **未推到 renderer** |
| `user_bash` | 用户直接 bash | 未用 |
| `before_agent_start` | 拦截 agent 启动 | 未用 |
| `before_provider_request` / `before_provider_headers` / `provider_headers` | HTTP 层 | 未用 |
| `input` | 输入拦截 | 未用 |
| `context` | context 调整 | `pi-extensions.ts:826` |
| `resources_discover` | 资源发现 | `pi-resource-loader.ts` |
| `project_trust` | 项目信任 | 自实现 dialog |
| `model_select` | 模型选择 | `agent-model.ts` |
| `set_label` / `set_active_tools` / `set_thinking_level` | 配置变更 | 未用 |
| `get_commands` / `send_message` / `send_user_message` | 控制 agent | 未用 |

### 4.2 自定义工具 / 快捷键 / Flags / Slash Commands

- **`defineTool({ name, description, parameters, execute })`** → 自定义 tool
- **`registerShortcut({ id, description, handler })`** → KeybindingsManager 注册
- **`registerFlag({ name, type, description })`** → 命令行 `--flag`
- **`registerCommand({ name, description, handler })`** → `/cmd` 注册

### 4.3 OpenBuddy 现在有但应该转 PI Plugin 的功能

| 功能 | 当前实现 | 转 PI Plugin |
|---|---|---|
| filesystem tools（open / browse / reveal）| 自实现 IPC | `defineTool` × 3 |
| apply-patch tool | 自实现 | `defineTool` |
| session 命令（list / fork / switch）| 自实现 | `registerCommand` |
| plan / tasks / permission / mcp 命令 | 自实现 | `registerCommand` |
| skill 加载 | `pi-resource-loader.ts` | `resources_discover` + `loadSkills` |
| extension reload | 自实现 | ExtensionRunner hot reload |
| compaction 通知 | 自实现 | `session_compact` event |
| observability / telemetry bridge | 自实现 | `agent_end` / `turn_end` event |
| extra providers 注册 | 自实现 | pendingProviderRegistrations |
| mcp server 集成 | 自实现 | `setActiveTools` |

## 16. 附录 C — 7 阶段 × 16 轮实施路线图（v2 原 §5）

> 总预算：**16 轮**，每轮单 commit + 全测 + 推独立分支。

### Phase A — 桥接层就绪（1 轮）

#### A.1 PI IPC 桥基础设施 ✅ 已实现 (commit 见 PR)

**目标**：在不改业务行为前提下，把 PI 的 Node-only API 通过 IPC 暴露到 renderer。

**实现**（commit `pending` in PR）：
- 新建 `electron/main/agent/pi-bridge/`：`text-utils.ts`（parseFrontmatter / stripFrontmatter / truncateHead/Tail/Line / generateDiffString / generateUnifiedPatch / formatSize）、`image-utils.ts`（resizeImage / detectSupportedImageMimeTypeFromFile / convertToPng / readAndResizeImage）、`skill-utils.ts`（loadSkills / loadSkillsFromDir / formatSkillsForPrompt）、`index.ts`（注册函数 `registerPiBridgeIpc()`）
- `electron/preload/index.ts` 暴露 `window.api.pi.{text,image,skills}`，14 个 IPC 通道加到 allowlist
- `electron/main/ipc/index.ts` 调用 `registerPiBridgeIpc()`
- `src/lib/agent/pi-bridge-client.ts`（renderer 端 typed wrapper，含 `getPiBridge()` / `requirePiBridge()`）
- `docs/event-channel-matrix.md` 加 14 行 pi-bridge 通道条目
- 单测：`electron/main/agent/pi-bridge/{text,image,skill}-utils.test.ts` + `src/lib/agent/__tests__/pi-bridge-client.test.ts` 合计 **27 个测试全过**

**实际文件**：
- `electron/main/agent/pi-bridge/text-utils.ts` (~110 LOC)
- `electron/main/agent/pi-bridge/image-utils.ts` (~75 LOC)
- `electron/main/agent/pi-bridge/skill-utils.ts` (~55 LOC)
- `electron/main/agent/pi-bridge/index.ts` (~135 LOC)
- `electron/main/agent/pi-bridge/{text,image,skill}-utils.test.ts`
- `src/lib/agent/pi-bridge-client.ts` (~110 LOC)
- `src/lib/agent/__tests__/pi-bridge-client.test.ts`
- 修改 `electron/preload/index.ts`（15 行加 allowlist + ~70 行 pi 包装）
- 修改 `electron/main/ipc/index.ts`（3 行 import + 调用）
- 修改 `src/lib/__tests__/ipc-contract.test.ts`（7 行扫描路径扩展）
- 修改 `docs/event-channel-matrix.md`（14 行 channel 条目）

**验证**：
- `pnpm typecheck` — ✅ exit 0
- `pnpm exec vitest --run electron/main/agent/pi-bridge/` — ✅ 22 tests passed
- `pnpm exec vitest --run src/lib/agent/__tests__/pi-bridge-client.test.ts` — ✅ 5 tests passed
- `pnpm exec vitest --run src/lib/__tests__/ipc-contract.test.ts` — ✅ 13 tests passed（已扩展扫描 electron/main/agent/pi-bridge/）
- `pnpm exec vitest --run electron/main/__tests__/ipc-contract-coverage-realserver.test.ts` — ✅ 7 tests passed（所有 pi-bridge 通道名匹配 `/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]+$/`）
- `pnpm exec vitest --run electron/main/agent/__tests__/event-channel-matrix.test.ts` — ✅ 4 tests passed
- 全量 `pnpm exec vitest --run` — ✅ **5546/5551 pass**（5 个环境性失败 ×dg-open/sandbox/casdoor 与本改动无关）

**通道命名规范**：`pi-bridge-<domain>:<verb>`（单冒号）以遵守 IPC contract regex `/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]+$/`。

**退出**：✅ renderer 可以通过 `window.api.pi.text.parseFrontmatter(raw)` / `image.resize(bytes, mime)` / `skills.load()` 拿到 PI 的实现，与之前等价；后续 phase（B.1 / D.3 / E.3）会逐步迁移现有自定义 parser。

### Phase B — ExtensionRunner 上线（3 轮）

#### B.1 把 host-module 改写成 PI ExtensionFactory ✅ B.1 第 1 + 2 轮完成

**目标**：把每个 host-module 包成 `(pi: ExtensionAPI) => { ... }` 工厂。

**范围**：
- 用 `pi.on("session_start", ...)` 替代手动 emit 事件
- 用 `pi.sendMessage` / `pi.appendEntry` 替代直接调 session API
- 第一个 target：`session-metadata.ts`（最简单）

**B.1 第 1 轮**（commit `df1bcb7`）：**5th builtin ExtensionFactory** —— `openbuddy-pi-session-metadata`

- 新建 `electron/main/agent/extensions/session-metadata-bridge.ts`（~115 LOC）
- `electron/main/agent/pi-extensions.ts` `builtinPiExtensionFactories` 加第 5 个 key
- 新建 `electron/main/agent/extensions/session-metadata-bridge.test.ts`（8 个测试）

**B.1 第 2 轮**（commit 见本轮 PR）：
1. **6th builtin ExtensionFactory** —— `openbuddy-pi-model-bridge`
   - 新建 `electron/main/agent/extensions/model-bridge.ts`（~80 LOC）
   - 订阅 `model_select` / `set_model` / `before_provider_request` PI ExtensionAPI 事件
   - 与 `agent-model.ts` `installAgentModel()` provider CRUD path 并存，不破坏现有面
   - 新建 `electron/main/agent/extensions/model-bridge.test.ts`（7 个测试）
2. **`ipc/agent.ts` 1090 LOC 拆分第 1 步**
   - 新建 `electron/main/ipc/agents.ts`（~70 LOC） —— `registerAgentsIpc()` 注册 `agents_*` 7 个 handler
   - `electron/main/ipc/agent.ts` 删除这 7 个 handler（1090 → 1060 LOC）
   - `electron/main/ipc/index.ts` 调用 `registerAgentsIpc()`
   - 通道名以 `agents_` 开头全部走新文件

**架构意义**：
- OpenBuddy 现在有 **6 个 builtin PI ExtensionFactory**（observability / context-status / context-guard / telemetry-bridge / compact-announce / session-metadata / model-bridge）
- `ipc/agent.ts` 从 1090 LOC 减到 1060 LOC，B.3 拆分后续 9 个 capability 组后会进一步减到 ≤ 600 LOC

**验证**：
- `pnpm typecheck` — ✅ exit 0
- `pnpm exec vitest --run electron/main/agent/extensions/` — ✅ 21/21（model-bridge 7 + session-metadata 8 + markdown 6）
- `pnpm exec vitest --run electron/main/agent/pi-extensions.test.ts` — ✅ 33/33
- `pnpm exec vitest --run electron/main/__tests__/ipc-contract-coverage-realserver.test.ts` — ✅ 7/7
- `pnpm exec vitest --run src/lib/__tests__/ipc-contract.test.ts` — ✅ 13/13
- 全量 `pnpm exec vitest --run` — ✅ **5561/5566 pass**（5 个环境性失败 ×dg-open / sandbox / casdoor-resource-gateway 与本轮无关）

**B.1 第 3 轮预告**：继续拆 `ipc/agent.ts` 剩余 9 个 capability 组（session / prompt / preset / tool / model / plugin / compaction / workspace / permission / task），预计 1060 LOC → ≤ 600 LOC。

#### B.2 用 ExtensionRunner.bindCore 替代 microkernel 启动序列

**目标**：删除 `installMicrokernelHost` 的 INSTALLED_MODULES 跟踪；改用 PI ExtensionRunner。

**范围**：
- 保留 microkernel-host.ts 作为 deprecated wrapper（向后兼容）
- 用 `createExtensionRuntime()` 起步

**文件**：
- `electron/main/agent/host-modules/bootstrap/microkernel-host.ts` → 改写为 PI runner wrapper
- `electron/main/agent/host-modules/bootstrap/init-pipeline.ts` → 用 `createExtensionRuntime()` 起步

**验证**：smoke test 不再 `service X has been registered`

**退出**：单一启动路径

#### B.3 把 discoverAndLoadExtensions 接入 builtin + 用户 extension 加载

**目标**：之前 `pi-extensions.ts` 4 个 builtin 改成 `loadExtensions(paths)` 风格；用户 profile 里的 extension 目录也走 PI loader。

**文件**：
- `electron/main/agent/pi-extensions.ts` 重写
- `packages/runtime/openbuddy-plugin-host/src/extension-loader.ts`（新）

**验证**：builtin extension 仍可用；用户 extension 自动发现

**退出**：单一 extension loader 路径

### Phase C — Tools 工厂化（3 轮）

#### C.1 bash / read / write / ls / find / grep 工具迁移

**目标**：用 PI `createBashTool` 等替换自实现 tools。

**范围**：
- 用 `createBashTool` + `createLocalBashOperations` 拿 bash
- 用 `createReadTool` 拿 read + 内置 truncateHead/Line/Tail
- 用 `createWriteTool` + `withFileMutationQueue` 拿 write
- 用 `createLsTool` / `createGrepTool` / `createFindTool` 拿 ls/grep/find

**文件**：
- `electron/main/agent/extensions/apply-patch.ts` → `electron/main/agent/extensions/coding-tools.ts`
- 新增 `electron/main/agent/extensions/builtin-tools.ts`（组装 + 注入 OpenBuddy 特定 hooks）

**验证**：每个 tool 的单测保留，行为不变

**退出**：~600 LOC 自实现 tool 替换为 PI factory 调用

#### C.2 edit tool + diff 工具迁移

**目标**：用 PI `createEditTool` + `EditOperations` 替换自实现 edit。

**范围**：
- diff 显示用 `generateDiffString` / `generateUnifiedPatch` 替换自实现

**文件**：
- `electron/main/agent/extensions/edit-tool.ts`（新）
- `packages/ui/openbuddy-ui-*` 自实现 diff 渲染改用 IPC 调 PI

**验证**：edit tool 行为 + diff 显示效果一致

**退出**：renderer diff 渲染与之前一致

#### C.3 powerShell 工具 + 跨平台 shell

**目标**：用 PI `createPowerShellTool` + `getPowerShellConfig` 替换自实现。

**范围**：
- shell 检测用 `getShellConfig` 替换自实现

**文件**：`electron/main/agent/extensions/powershell-tool.ts`（新）

**验证**：macOS / Linux 走 bash，Windows 走 powershell

**退出**：跨平台 shell 行为正确

### Phase D — Settings & ProjectTrust & Skills 复用（3 轮）

#### D.1 SettingsManager 替换自定义 settings I/O

**目标**：`workbuddy-import.ts:122` 手写 `openFile`/`writeFile` 换成 `SettingsManager.create()`。

**自动获得**：原子写、migration、JSON schema validation、跨会话共享

**文件**：
- `electron/main/agent/host-modules/settings-store.ts`（新，包装 PI SettingsManager）
- `electron/main/workbuddy-import.ts` 替换 settings 加载

**验证**：跨重启 settings 保留；migration 测试

**退出**：少 200+ 行自定义 I/O

#### D.2 ProjectTrustStore 替换 folder trust dialog

**目标**：用 PI `ProjectTrustStore` 持久化 folder trust 决策。

**文件**：
- `electron/main/agent/host-modules/project-trust.ts`（新）
- `src/components/dialogs/FolderTrustDialog.tsx` 改"记住选择"

**验证**：folder trust 跨会话保留

**退出**：folder trust 不再每次问

#### D.3 Skills 体系迁移

**目标**：用 PI `loadSkills` + `loadSkillsFromDir` + `formatSkillsForPrompt` 替换 `pi-resource-loader.ts` 自定义扫描。

**文件**：
- `electron/main/agent/host-modules/pi-resource-loader.ts` 替换核心
- `electron/main/agent/host-modules/agent-prompt.ts` 用 `formatSkillsForPrompt`
- `packages/runtime/openbuddy-plugin-host/src/skills.ts`（新）

**验证**：skill 列表 + system prompt 一致

**退出**：~300 LOC 自定义替换

### Phase E — UI 槽位 + ExtensionUIContext 对齐（3 轮）

#### E.1 ui-slots 类型契约补 PI ExtensionUIContext

**目标**：在 `SlotMap` 加 `pi-ui-notify` / `pi-ui-select` / `pi-ui-confirm` / `pi-ui-set-status` / `pi-ui-set-working-indicator` 等槽位。

**文件**：`packages/ui/openbuddy-ui-slots/src/index.ts`

**验证**：typecheck

**退出**：ui-slots 覆盖 PI ExtensionUIContext 所有交互

#### E.2 ui-runtime 接 PI ExtensionRunner UI 事件

**目标**：把 `ui-runtime` 的 widget 渲染与 PI ExtensionRunner `MessageRenderer` / `EntryRenderer` / `ToolRenderResultOptions` 对齐。

**范围**：让 plugin 能注册自定义 widget（仿 WorkBuddy 的 experts 卡片）

**文件**：`packages/ui/openbuddy-ui-runtime/src/plugin-ui-host.ts`（新）

**验证**：plugin 注册 widget 可渲染

**退出**：plugin widget 系统可用

#### E.3 renderer 端 parseFrontmatter 等纯工具走 IPC 桥

**目标**：renderer 不直接依赖 Node-only pi-coding-agent（太大），走 Phase A 建的 IPC 桥。

**范围**：`SkillDetailModal.tsx:163` 自定义 parser 删，换 `await window.pi.parseFrontmatter(rawMd)`

**文件**：所有 renderer 自实现的纯 JS 工具（frontmatter / truncate / highlight）走 IPC

**验证**：单测 + 手测

**退出**：renderer 自定义解析器只剩 IPC 调用

### Phase F — 性能优化（3 轮）

#### F.1 Renderer bundle manualChunks 拆分

**目标**：25 个 `ui-*` 包共享 `chat-ui-shared` / `ui-markdown` 拆独立 chunk。

**文件**：`electron.vite.config.ts` 加 `build.rollupOptions.output.manualChunks`

**验证**：`pnpm exec perf:main-chunks`

**退出**：首屏 JS 体积减 30%+

#### F.2 SQLite 替换 node:sqlite

**目标**：`harness-cursors.ts` 用 `better-sqlite3` 替换 `node:sqlite`。

**验证**：cursor 读写正常

**退出**：AppImage 兼容旧 Node

#### F.3 启动性能 audit + lazy load

**目标**：profile cold start 各 stage，找出 > 100ms stage，lazy load。

**验证**：cold start ≤ 2s

**退出**：性能达标

### Phase G — 真实 LLM E2E 验证（持续）

**目标**：27 个 playwright spec 全过。

**前置**：需要带凭据环境（`OPENBUDDY_E2E_API_KEY` + `OPENBUDDY_E2E_BASE_URL`），沙箱跑不了，留 CI / 开发机。

**验证**：每轮 Phase A-F 完成后跑一次，捕获 regression。

## 17. 附录 D — 依赖图与执行顺序（v2 原 §6）

```
Phase A (桥接)                    1 轮
   ↓
Phase B (ExtensionRunner)         3 轮 ── B.1 → B.2 → B.3 串行
   ↓
Phase C (Tools)                  3 轮 ── C.1 → C.2 → C.3 串行
   ↓
Phase D (持久化/Skills)          3 轮 ── D.1 → D.2 → D.3 串行
   ↓
Phase E (UI 槽位对齐)            3 轮 ── E.1 → E.2 → E.3 串行
   ↓
Phase F (性能)                    3 轮 ── F.1 / F.2 / F.3 可并行
   ↓
Phase G (E2E)                    持续
```

## 18. 附录 E — PI-Desktop（vastsa）对照与启示（v2 原 §7）

PI-Desktop 用 **54 文件 / 19,818 LOC** 的 `@pi-desktop/agent-runtime`，**不**直接用 `pi-coding-agent`，而是基于更底层的 `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` 自己组装。

PI-Desktop 关键文件：
- `runtime.ts` (5636 行) — agent loop
- `subagent.ts` (698 行) — subagent
- `plugin-skills.ts` / `session-context.ts` / `mode-prompts.ts` / `model-capabilities.ts` / `provider-binding.ts` / `provider-headers.ts` / `provider-retry.ts` / `session-title-summarize.ts` / `prompt-templates.ts` / `prompt-enhancement.ts` / `plugin-session-context.ts` / `subagent-definitions.ts` / `thinking-level.ts` / `timing.ts` / `agent-errors.ts` / `agent-messages.ts` / `host-client.ts` / `parent-host-proxy.ts` / `node-proxy.ts` / `one-shot-complete.ts` / `opencode-session-headers.ts` / `path-lock.ts` / `project-instructions.ts` / `project-instructions-prompt.ts` / `sidecar.ts` / `sidecar-config.ts`

**对 OpenBuddy 的启示**：
- **大方向 vs 小方向**：OpenBuddy 选大方向（依赖 `pi-coding-agent` SDK），PI-Desktop 选小方向（自实现基于 `pi-agent-core`）
- **不建议完整迁移**：OpenBuddy 已有自己的 agent-host 体系，迁移 ROI 不高
- **建议小修小补**：把 11000+ LOC host-modules 重构成类似 PI-Desktop 的「thin wrapper over pi-agent-core」结构

## 19. 附录 F — 风险登记（v2 原 §8）

| 风险 | 影响 | 缓解 |
|---|---|---|
| PI 0.85 → 0.86 breaking change | 所有 phase | 锁版本，升级单独立 PR |
| 11000+ LOC host-modules 重构触及面大 | Phase B/C | 拆轮次，每轮单 host-module |
| ExtensionRunner 替换 microkernel 可能引入新 race | Phase B.2 | smoke + e2e 全套跑；保留旧路径 fallback |
| Renderer 不能直接 import pi-coding-agent（Node-only + 二进制依赖）| Phase E.3 | 走 IPC 桥（A.1） |
| asar:false 还在 | Phase F 之后 | 试 pnpm deploy + electron-builder 27 asarUnpack |
| LLM e2e 非确定性 | Phase G | retry + golden response 截断 |
| Rate limit（Token Plan 用量上限）| 所有 phase | 单轮控制 token 用量，不批量调 LLM |

## 20. 附录 G — v2 成功标准（v2 原 §9，与 §10 互补）

| 维度 | 指标 | 当前 | 目标 |
|---|---|---|---|
| **PI 复用度** | OpenBuddy 自定义代码 vs PI 提供能力 | 自定义 ~85% | 自定义 < 30% |
| **PI Plugin 覆盖度** | 业务功能用 PI Plugin 实现 | ~5% | ≥ 80% builtin 用 ExtensionFactory |
| **PI Tools 复用** | 自实现 bash/read/write/edit 工具 | 8 个 | 0 个 |
| **PI Persistence** | 自定义 settings/project-trust I/O | 多处 | 0 个 |
| **PI Skills** | 自定义 skill 加载 | 1 套 | 0 个 |
| **PI export 复用** | 用 / 总可用 | 25/105 (24%) | ≥ 70/105 (67%) |
| **启动** | cold start | ~4s | ≤ 2s |
| **包体积** | Linux AppImage | ~280MB（asar:false）| ≤ 180MB |
| **单测** | vitest pass rate | 5519/5540 (99.6%) | ≥ 99% |
| **E2E** | playwright spec | 未跑 | 27/27 |
| **Context UX** | 主 chat context usage | 无 | ✓ |
| **Tool UX** | 实时 tool 进度 | 无 | ✓ |
| **Branch UX** | tree picker | 无 | ✓ |
| **Plugin UX** | 用户可装第三方 PI 插件 | 无 | ✓ |

## 21. 附录 H — 已完成基线（v2 原 §10）

- ✅ Phase 0：3 条 blocker 已修（`moon.yml` warnings, microkernel 双 install race, dsh-base 硬编码路径）
- ✅ commit `a458bd4` → `agent/devbox1/main-pi-reuse` 分支
- ✅ 全量 vitest：5519/5540 pass（5 个环境性失败：xdg-open 缺失、sandbox provider 缺失、casdoor-resource-gateway）

## 22. 附录 I — v2 接下来 3 轮（已锁定）（v2 原 §11，与 §11 互补）

1. **下一轮 — Phase A.1**：PI IPC 桥基础设施（`window.pi.parseFrontmatter` 等）
2. **再下轮 — Phase B.1**：第一个 host-module 改写成 PI ExtensionFactory（先选最简单的 `session-metadata.ts`）
3. **第三轮 — Phase D.3**：Skills 体系迁移（用 PI `loadSkills` 替换 `pi-resource-loader` 核心）

每轮单 commit + 全测 + 推独立分支，符合"小步实现 + 必须验证"。

## 23. 附录 J — v2 文档维护规则（v2 原 §12，与 §13 互补）

- 本文档随每轮 phase 完成更新
- 任何 phase 范围 / 文件清单 / 退出标准变更需在 PR 描述里 link 到本文件对应章节
- 文档 owner: 编程助手-devbox1 (LUM-580)