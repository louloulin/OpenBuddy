# OpenBuddy PI-Native 改造计划 (v2)

> 📅 2026-09-08 · 基于 `main` (commit `058cbf9`) · 状态：进行中
> 任务: LUM-580 · 仓库: louloulin/OpenBuddy
> 上游基线: `@earendil-works/pi-coding-agent` 0.85.1 + `pi-agent-core` 0.85.1 + `pi-ai` 0.85.1
> 参考实现: [vastsa/PI-Desktop](https://github.com/vastsa/PI-Desktop) (54 文件 / 19,818 LOC agent-runtime)

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

## 3. 目标态架构

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

## 4. PI Plugin 体系专项

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

## 5. 7 阶段 × 16 轮实施路线图

> 总预算：**16 轮**，每轮单 commit + 全测 + 推独立分支。

### Phase A — 桥接层就绪（1 轮）

#### A.1 PI IPC 桥基础设施

**目标**：在不改业务行为前提下，把 PI 的 Node-only API 通过 IPC 暴露到 renderer。

**范围**：
- 新建 `electron/main/agent/pi-bridge/`，封装 `parseFrontmatter` / `calculateContextTokens` / `formatSkillsForPrompt` / `resizeImage` 等为 IPC handler
- `electron/preload/preload.ts` 暴露 `window.pi.*`
- `src/lib/pi-client.ts`（renderer 端 typed wrapper）

**文件**：
- `electron/main/agent/pi-bridge/text-utils.ts`（frontmatter / truncate / diff）
- `electron/main/agent/pi-bridge/image-utils.ts`（resize / mime / png convert）
- `electron/main/agent/pi-bridge/skill-utils.ts`（loadSkills / formatSkillsForPrompt）
- `electron/preload/preload.ts`
- `src/lib/pi-client.ts`

**验证**：单测每个 IPC handler；renderer 端 typecheck

**退出**：renderer 可以通过 `window.pi.parseFrontmatter(raw)` 拿到 PI 的实现，与之前等价

### Phase B — ExtensionRunner 上线（3 轮）

#### B.1 把 host-module 改写成 PI ExtensionFactory

**目标**：把每个 host-module 包成 `(pi: ExtensionAPI) => { ... }` 工厂。

**范围**：
- 用 `pi.on("session_start", ...)` 替代手动 emit 事件
- 用 `pi.sendMessage` / `pi.appendEntry` 替代直接调 session API
- 第一个 target：`session-metadata.ts`（最简单）

**文件**：每个 `host-modules/*.ts`（约 20 个文件需要 wrapper）

**验证**：vitest + agent-host 全套 e2e

**退出**：所有业务行为不变

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

## 6. 依赖图与执行顺序

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

## 7. PI-Desktop（vastsa）对照与启示

PI-Desktop 用 **54 文件 / 19,818 LOC** 的 `@pi-desktop/agent-runtime`，**不**直接用 `pi-coding-agent`，而是基于更底层的 `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` 自己组装。

PI-Desktop 关键文件：
- `runtime.ts` (5636 行) — agent loop
- `subagent.ts` (698 行) — subagent
- `plugin-skills.ts` / `session-context.ts` / `mode-prompts.ts` / `model-capabilities.ts` / `provider-binding.ts` / `provider-headers.ts` / `provider-retry.ts` / `session-title-summarize.ts` / `prompt-templates.ts` / `prompt-enhancement.ts` / `plugin-session-context.ts` / `subagent-definitions.ts` / `thinking-level.ts` / `timing.ts` / `agent-errors.ts` / `agent-messages.ts` / `host-client.ts` / `parent-host-proxy.ts` / `node-proxy.ts` / `one-shot-complete.ts` / `opencode-session-headers.ts` / `path-lock.ts` / `project-instructions.ts` / `project-instructions-prompt.ts` / `sidecar.ts` / `sidecar-config.ts`

**对 OpenBuddy 的启示**：
- **大方向 vs 小方向**：OpenBuddy 选大方向（依赖 `pi-coding-agent` SDK），PI-Desktop 选小方向（自实现基于 `pi-agent-core`）
- **不建议完整迁移**：OpenBuddy 已有自己的 agent-host 体系，迁移 ROI 不高
- **建议小修小补**：把 11000+ LOC host-modules 重构成类似 PI-Desktop 的「thin wrapper over pi-agent-core」结构

## 8. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| PI 0.85 → 0.86 breaking change | 所有 phase | 锁版本，升级单独立 PR |
| 11000+ LOC host-modules 重构触及面大 | Phase B/C | 拆轮次，每轮单 host-module |
| ExtensionRunner 替换 microkernel 可能引入新 race | Phase B.2 | smoke + e2e 全套跑；保留旧路径 fallback |
| Renderer 不能直接 import pi-coding-agent（Node-only + 二进制依赖）| Phase E.3 | 走 IPC 桥（A.1） |
| asar:false 还在 | Phase F 之后 | 试 pnpm deploy + electron-builder 27 asarUnpack |
| LLM e2e 非确定性 | Phase G | retry + golden response 截断 |
| Rate limit（Token Plan 用量上限）| 所有 phase | 单轮控制 token 用量，不批量调 LLM |

## 9. 成功标准

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

## 10. 已完成基线

- ✅ Phase 0：3 条 blocker 已修（`moon.yml` warnings, microkernel 双 install race, dsh-base 硬编码路径）
- ✅ commit `a458bd4` → `agent/devbox1/main-pi-reuse` 分支
- ✅ 全量 vitest：5519/5540 pass（5 个环境性失败：xdg-open 缺失、sandbox provider 缺失、casdoor-resource-gateway）

## 11. 接下来 3 轮（已锁定）

1. **下一轮 — Phase A.1**：PI IPC 桥基础设施（`window.pi.parseFrontmatter` 等）
2. **再下轮 — Phase B.1**：第一个 host-module 改写成 PI ExtensionFactory（先选最简单的 `session-metadata.ts`）
3. **第三轮 — Phase D.3**：Skills 体系迁移（用 PI `loadSkills` 替换 `pi-resource-loader` 核心）

每轮单 commit + 全测 + 推独立分支，符合"小步实现 + 必须验证"。

## 12. 文档维护

- 本文档随每轮 phase 完成更新
- 任何 phase 范围 / 文件清单 / 退出标准变更需在 PR 描述里 link 到本文件对应章节
- 文档 owner: 编程助手-devbox1 (LUM-580)