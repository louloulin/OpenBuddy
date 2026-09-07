# agent-host v6-G 微内核 + 插件架构图（中文）

> 📅 2026-09-07 ｜ 终态测绘：本文件所有架构决策均从源码实测
> 配套文档：`docs/agent-host-v6g-modularization-plan.md`（4 里程碑改造方案）

---

## 1. 整体分层架构（OpenBuddy vs WorkBuddy 对标）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         渲染层 (Renderer)                                    │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  React 18 + Zustand + --wb-* 设计令牌 + React.lazy + Suspense         │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │  │
│  │  │  Sidebar │ │  Topbar  │ │ ChatView │ │ Composer │ │ Conversation │ │  │
│  │  │          │ │          │ │          │ │ (输入)   │ │ List         │ │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────┘ │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │  │
│  │  │  Home    │ │ Settings │ │ Marketplace│ │ Plugin  │ │ Skill        │ │  │
│  │  │  Page    │ │  Panel   │ │  Panel     │ │ Panel   │ │ Recommend    │ │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────┘ │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                       26 个 UI 包 (@openbuddy/ui-*) 全部接入 React            │
└───────────────────────────────▲──────────────────────────────────────────────┘
                                │ window.api (类型化 contextBridge)
┌───────────────────────────────▼──────────────────────────────────────────────┐
│                       Preload 桥 (electron/preload/)                         │
│   允许列表 IPC channels · 安全 contextBridge · MessageChannelMain            │
└───────────────────────────────▲──────────────────────────────────────────────┘
                                │ contextBridge.invoke / on / MessageChannelMain
┌───────────────────────────────▼──────────────────────────────────────────────┐
│                  Electron Main IPC 层 (electron/main/ipc/)                    │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌────────────────┐      │
│  │ agent/  │ │ collab/  │ │ misc/    │ │connectors/│ │ harness/       │      │
│  │ (61K)   │ │ (31K)    │ │ (33K)    │ │ (17K)     │ │ (3.5K)         │      │
│  └─────────┘ └──────────┘ └──────────┘ └───────────┘ └────────────────┘      │
│                       白名单 IPC handlers                                     │
└───────────────────────────────▲──────────────────────────────────────────────┘
                                │ agentHost.<method>(...)  ← 121 facade 方法
┌───────────────────────────────▼──────────────────────────────────────────────┐
│          agent-host.ts (2,098 行) ── 微内核组合根 + facade                    │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │ state 单例 (AgentHostState) + 17 域 state map + Cordis Context      │      │
│  │ initialize() ── 9 阶段装配流水线 (v6-E)                              │      │
│  │ dispose()    ── 反向编排                                              │      │
│  │ ~110 个 IPC facade 方法 (1 行 *Impl 转发)                            │      │
│  │ 共享 type re-export (AgentHostState / PiAgentRuntime / …)           │      │
│  └────────────────────────────────────────────────────────────────────┘      │
└───────────────────────────────▲──────────────────────────────────────────────┘
                                │ bootstrap/<stage>(deps)
┌───────────────────────────────▼──────────────────────────────────────────────┐
│          host-modules/bootstrap/ ── 9 阶段装配 (28 模块)                      │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │ L1  session-event-log       ─  L2  model-runtime                   │      │
│  │  3  install-host-modules    ─  4  create JobsRegistry              │      │
│  │  5  wire-context-services   ─  6  wire-dsh-services                │      │
│  │  7  init-profile            ─  8  init-plugin-loader               │      │
│  │  9  inject-system-prompt    ─ 10  init-session                     │      │
│  │ 11  init-deepseek           ─ 12  dispose-host (反向)              │      │
│  └────────────────────────────────────────────────────────────────────┘      │
└───────────────────────────────▲──────────────────────────────────────────────┘
                                │ installXxx(deps)  // 50+ host-modules
┌───────────────────────────────▼──────────────────────────────────────────────┐
│             host-modules/<domain>/ ── 微内核服务 (78 模块)                    │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │ profile/ (7)        loader · watchers · snapshot · bundles · …     │      │
│  │ session-store · session-metadata · session-rebind · session-swap  │      │
│  │ session-projection · session-queue-items                           │      │
│  │ plugin-event-bus · plugin-state · plugin-mutations · plugin-runtime│      │
│  │ pi-runtime-factories · pi-runtime-refresh · pi-extension-configure  │      │
│  │ deepseek/ (4)       agent-runtime · cordis · bridge · host-runner  │      │
│  │ agent-prompt · agent-model · agent-preset-runtime · subagent-rt    │      │
│  │ hook-permission · ui-request-resolver · workbench-scope(-sync)     │      │
│  │ harness-cursors · mcp-runtime · models-config · telemetry-sink     │      │
│  │ dispose-internal · rewind-snapshot · pagination · lifecycle        │      │
│  │ dsh-bridge-helpers · context-services-snapshot                     │      │
│  │ facade/ (12+)      IPC facade 提取（v6-G M1 目标）                  │      │
│  └────────────────────────────────────────────────────────────────────┘      │
└───────────────────────────────▲──────────────────────────────────────────────┘
                                │ Cordis context + 注入 hooks
┌───────────────────────────────▼──────────────────────────────────────────────┐
│         Pi SDK (@earendil-works/pi-coding-agent 0.84.3)                       │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │ AgentSession · ModelRuntime · SessionManager · ResourceLoader      │      │
│  │ Pi extensions · skills · slash commands · prompts · themes         │      │
│  │ Pi 原生能力 (事件总线 · 工具调度 · LLM 流式 · 权限管理 · 事件订阅)     │      │
│  └────────────────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 微内核 install 流水线（v6-E 终态 9 阶段）

```
用户/IPC 触发 agentHost.init(opts)
              │
              ▼
       ┌─────────────────┐
       │  initialize()   │  early-return 守卫 / coalesce
       └────────┬────────┘
                ▼
       ┌─────────────────────────────────────────────┐
       │  __runInitialize(opts, cwd)                 │
       │  ┌─────────────────────────────────────┐    │
       │  │ L1 bootstrapSessionEventLog         │    │
       │  │    装载 SessionEventLog + state     │    │
       │  ├─────────────────────────────────────┤    │
       │  │ L2 bootstrapModelRuntime            │    │
       │  │    创建 ModelRuntime + auth.json    │    │
       │  ├─────────────────────────────────────┤    │
       │  │ 3 installHostModules (microkernel)  │    │
       │  │    9 Profile + 9 Session +          │    │
       │  │    11 Plugin + 10 Runtime = 39 模块  │    │
       │  ├─────────────────────────────────────┤    │
       │  │ 4 createContext + createJobsRegistry│    │
       │  ├─────────────────────────────────────┤    │
       │  │ 5 wireContextServices               │    │
       │  │    30 个 context.provide(...)       │    │
       │  ├─────────────────────────────────────┤    │
       │  │ 6 wireDshServices                   │    │
       │  │    DSH cluster + typert ready       │    │
       │  ├─────────────────────────────────────┤    │
       │  │ 7 initProfile + 8 initPluginLoader  │    │
       │  ├─────────────────────────────────────┤    │
       │  │ 9 injectSystemPromptSections        │    │
       │  ├─────────────────────────────────────┤    │
       │  │ 10 initSession                      │    │
       │  │     Pi AgentSession 创建 + RPC UI   │    │
       │  ├─────────────────────────────────────┤    │
       │  │ 11 initDeepSeek                     │    │
       │  │     DSH cordis runtime + 7 capability│    │
       │  └─────────────────────────────────────┘    │
       └─────────────────────────────────────────────┘
                │
                ▼
         state.session = session  (Pi AgentSession)
         state.model    = session.model
         state.extensionsBound = true
                │
                ▼
       IPC handler `agent:init` 返回 { ok: true, ... }
```

---

## 3. 微内核 vs 插件边界（权威判据）

| 角色 | 归属 | 判据 | 当前数量 |
|---|---|---|---|
| **微内核服务** | `host-modules/<domain>/` | 无 agent-host / IPC 反向依赖；经 `installXxx(deps)` 或 `bootstrap/deps` 注入 state；**单一职责域** | ~78 |
| **组合根/facade** | `agent-host.ts` | 只编排、只装配、只暴露 API；不持实现逻辑 | 1 |
| **插件** | pi extension + `openbuddy-core-plugin.ts` + `capability-plugins.ts` | 面向 LLM 生命周期事件 (`session_start`/`tool_call`/`before_agent_start`…) 与工具注册 | ~12 capability |
| **公共 API 面** | `buildAgentHostFacade` | 唯一 grep 目标，供 IPC 表 `Object.keys(agentHost)` 交叉核对 | 121 方法 |
| **IPC handler** | `electron/main/ipc/*.ts` | 接受 IPC channel 参数、参数校验、白名单、调用 facade | 481 channels |

**反向依赖不变量**（与 pi `core/` 一致）：host-module **一律不 `import` agent-host**；跨域回调经参数注入。

---

## 4. WorkBuddy 产品力对标（v6-G 当前 + 缺口）

| 维度 | WorkBuddy | OpenBuddy v6-E | 差距 | v6-G 行动 |
|---|---|---|---|---|
| 侧栏布局 | ✅ Sidebar + MainContent | ✅ 完全对齐 | 无 | — |
| HomePage | ✅ 场景标签 + 输入框 + 实践案例 | ✅ 已实现 | 缺场景标签 + 实践案例 | UI v7 |
| ChatView | ✅ 消息列表 + 输入 + 元信息 | ✅ 已实现 | 无 | — |
| 会话列表 | ✅ 置顶 + 任务 + 工作空间分组 | ⚠ 已实现但无置顶 + 工作空间分组 | UI v7 |
| 场景标签 (SceneTabs) | ✅ 日常/代码/设计… | ❌ | 缺 | UI v7 |
| 技能推荐栏 (SkillRecommendBar) | ✅ | ❌ | 缺 | UI v7 |
| 权限管理面板 | ✅ | ⚠ 基础 | 需完善 | v6-G M3 |
| 设置面板 | ✅ | ✅ | 完善中 | — |
| 搜索功能 | ✅ | ⚠ 基础 | 需完善 | UI v7 |
| 协作/网络 | ✅ Buddy 网络 | ✅ 已实现 (capability-plugins) | 分布式 Buddy 待 v8 | — |
| 工作空间 | ✅ | ⚠ 单 cwd | 多工作空间待 v8 | — |
| 任务视图 | ✅ | ✅ | — | — |
| 资料库 (KnowledgeBase) | ✅ | ❌ | 缺 | v8 |

---

## 5. 插件 vs 微内核（双轨收敛图）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Pi SDK (唯一运行时)                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  AgentSession · ModelRuntime · ResourceLoader · SessionManager       │   │
│  │                                                                      │   │
│  │  pi extensions 12 个:                                                │   │
│  │  ├─ mcp         (passthrough: true) ──────► openbuddy-mcp-client     │   │
│  │  ├─ permission  (passthrough: true) ──┐                              │   │
│  │  ├─ goal        (passthrough: true) ──┤ v6-G M3:                    │   │
│  │  ├─ plan        (passthrough: true) ──┤   删 Cordis mount             │   │
│  │  ├─ session     (passthrough: false→true) ┘  只留 pi                │   │
│  │  ├─ fs          (passthrough: false→true) ┘                          │   │
│  │  ├─ lens / simplify / hashline / worktree / automation              │   │
│  │  │   (passthrough: true, 无 Cordis)                                  │   │
│  │  └─ task        (Cordis 唯一)                                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────▲───────────────────────────────────────────────┘
                              │ 透传 passthroughCapability
┌─────────────────────────────▼───────────────────────────────────────────────┐
│               Cordis 能力网格 (剩余 7 capability)                              │
│  openbuddy-mcp-client (passthroughCapability: "mcp")                          │
│  openbuddy-task  (唯一)                                                      │
│  openbuddy-session / permission / goal / fs (v6-G M3 删除)                   │
│  openbuddy-memory (noop, v6-G 待迁移到 pi-memory)                            │
│                                                                              │
│  9 个 UI 能力包 + 11 个协作包 + 5 个企业包 + 4 个核心包 + …                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. v6-G 4 个里程碑（路线图）

| 里程碑 | 目标 | 验收命令 | 当前 |
|---|---|---|---|
| **M1** | agent-host.ts 完全 facade 化 (< 1500 行) | `wc -l electron/main/agent/agent-host.ts` < 1500 | 2,098 行 (待 −33%) |
| **M2** | 微内核零反向依赖 (独立可测试) | `grep -rn "from '../agent-host'" host-modules/` = 0 | 0 (已满足) |
| **M3** | 插件去重收官 (双轨归零) | `grep mountPermission\|mountGoal\|mountSession\|mountFsLocal openbuddy-core-plugin.ts` = 0 | 4 处 (待删) |
| **M4** | 架构图 + 验证脚本 | `node scripts/agent-host-verify.mjs` exit 0 | 待实现 |

---

## 7. 验证门槛（铁律）

```bash
# 1. 类型检查
cd electron && pnpm exec tsc -p tsconfig.json --noEmit --incremental false
# 期望: EXIT 0

# 2. 单元 + 集成测试
pnpm exec vitest run
# 期望: 542/542 文件、5517/5517 通过、15 跳过

# 3. Electron 真实端到端
timeout 120 node scripts/electron/ipc-surface-smoke.mjs
# 期望: 6/6 check 通过 (passed: 6, failed: 0)

# 4. 完整构建
pnpm exec electron-vite build
# 期望: EXIT 0

# 5. 反向依赖扫描
grep -rn "from '\.\./agent-host'" electron/main/agent/host-modules/
# 期望: 无输出 (0 violations)

# 6. facade 文件计数 (v6-G M1 验收)
ls electron/main/agent/host-modules/facade/ | wc -l
# 期望: ≥ 20 (M1 完成后)
```

---

## 8. 不变量（永久约束）

1. **零反向依赖**：host-modules/** 不得 import agent-host.ts
2. **零 PI 副作用外泄**：所有 pi 调用必须经过 host-modules/ 包装
3. **零隐式 IPC**：IPC channels 必须有白名单 + 类型契约
4. **零类型逃逸**：strict TypeScript，无 `any` 出现在 IPC boundary（仅 module 内部允许）
5. **零状态泄漏**：host-module 单例只能在 `install*` 时注入；不能在模块加载时假设存在
6. **零死代码**：每个 host-module 必须有 installXxx + __resetXxxForTest + 至少 1 个 test
7. **零调试日志污染**：commit 前 `grep process.stderr.write` 必须为空（生产代码）


---

## 9. v6-G 当前达成（实测 2026-09-07）

| 里程碑 | 目标 | 实测 | 状态 |
|---|---|---|---|
| **M1** | agent-host.ts < 1500 行 | 2,057 行 | ⚠️ 差 557 行 (facade alias 已抽取,initialize 仍 inline) |
| **M2** | host-modules 反向依赖 = 0 | 0 | ✅ |
| **M3** | openbuddy-core-plugin capability mount = 0 | 0 | ✅ |
| **M4a** | facade 文件 ≥ 20 | 20 | ✅ |
| **M4b** | installMicrokernelHost 调用 = 1 次 | 1 (line 1112) | ✅ |

**Build / Test 实测**:
- `pnpm exec tsc -p tsconfig.json --noEmit` → EXIT 0
- `pnpm exec electron-vite build` → ✓ built in ~6s
- `pnpm exec vitest run` → 542/542 文件, 5517/5517 tests passed (15 skipped)
- `timeout 120 node scripts/electron/ipc-surface-smoke.mjs` → 5/6 passed
- `node scripts/agent-host-verify.mjs` → 4/5 milestones (M1 待解决)

**Facade 文件清单 (20)**:
- `agent-host-facade-builders.ts` (legacy 5288 bytes)
- `auth-facade.ts` (authStatus / providerCatalog)
- `compaction-facade.ts` (compact / setAutoCompaction / abortRetry / abortBash / ...)
- `deepseek-facade.ts` (questionAnswer / deepSeekCordisSnapshot / invokeRemote / invokeConnection / createDeepSeekAgent / resumeDeepSeekAgent)
- `hooks-facade.ts` (requestHookPermission)
- `init-facade.ts` (init / waitUntilReady / ensureTypertReady stub)
- `lifecycle-facade.ts` (enqueueLifecycle / paginateHistoryEntries / lifecycleAppendQueues)
- `misc-facade.ts` (MCP / harness helpers)
- `plugin-lifecycle-facade.ts` (setPluginEnabled / reloadPlugin / refreshStoredPluginLayers / listPluginInventory / installProfileBundle / removeProfileBundle / enqueuePluginStateTransaction)
- `profile-facade.ts` (setProfilePiResourcePaths / refreshPiExtensions / profilePatchPaths / profileResourceWatchPaths / marketplaceArtifactPackagePaths / artifactPackagePaths / stopProfileWatchers / listProfileRemoteContributions / profilePackages / installDefaultPiPackages)
- `prompt-facade.ts` (getSession / onEvent / prompt / promptContent / steer / followUp / abort / setModel / listCommands / listRunningTasks)
- `reload-facade.ts` (reloadProfile / captureReloadableContextServices / restoreCapturedContextServices)
- `runtime-facade.ts` (piSessionRuntime / piRuntimeCoordinator / enqueueLifecycle / dispose / reload)
- `session-facade.ts` (renameSession / deleteSession / inspirationGenerate / subagent / killTask / loadSession / sessionInfo / sessionUsage / sessionFile / rewindSession)
- `session-helpers-facade.ts` (isCurrentSessionPath / selectedProfileDirectory)
- `session-lifecycle-facade.ts` (newSession / ensureNewSession / reportActivePluginTransaction / listActivePluginTransactions)
- `snapshot-facade.ts` (capturePiProfileSnapshot / restorePiProfileSnapshot)
- `team-facade.ts` (createTeamRunner)
- `telemetry-facade.ts` (telemetrySink / assistantMessageText / formatBranchSummaryText)
- `tools-facade.ts` (createToolRegistry / createPiRuntime / createPiSessionFacade stub)

**剩余工作 (M1)**:
- `initialize()` 函数 (line 1081-1415, 335 行) — 引用 36+ closure vars,完整抽取需 deps injection 重构
- `agentHost = buildAgentHostFacade({...})` properties object (line 1873-2006, 134 行) — 同样引用 closure vars
- 折中方案: 进一步拆分 facade 函数,把 closure vars 显式参数化 (M1.1 / M1.2 子任务)
