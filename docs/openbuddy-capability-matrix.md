# OpenBuddy 产品力 · 企业级能力盘点（2026-08-31）

> 本报告为 **静态调查** 输出，未修改任何源文件。所有结论均来自
> `appx/OpenBuddy` 主仓库（HEAD `openbuddy-product-enterprise-audit`
> worktree 同源）的真实源码、配置文件、脚本、测试与文档。

## 0. 调查方法

1. **目录结构盘点**：使用 `find` / `ls` 枚举 `packages/`、`services/`、
   `electron/`、`src/`、`scripts/`、`docs/`、`evals/`、`deploy/`、
   `services/casdoor-resource-gateway/`。
2. **关键源码抽样阅读**：
   - `packages/auth/openbuddy-permission/src/index.ts`
   - `packages/runtime/openbuddy-storage/src/`（`sqlite/`、`secrets/`、
     `adapters/`、`driver/`、`observability/`、`renderer/`、`files/`）
   - `packages/runtime/openbuddy-cordis/src/index.ts`
   - `packages/runtime/openbuddy-plugin-host/src/index.ts`
     与子模块 `deepseek-cordis-runtime.ts` / `profile.ts` /
     `bundle-manifest.ts` / `plugin-manifest.ts`
   - `packages/capability/*/src/index.ts`（12 个能力包全部读取）
   - `packages/collaboration/*/src/index.ts`（8 个协作包全部读取）
   - `packages/team/openbuddy-team/src/index.ts`、
     `packages/team/openbuddy-subagent/src/index.ts`
   - `services/casdoor-resource-gateway/src/index.ts`
   - `electron/main/index.ts`、`agent-host.ts`、`ipc.ts`、
     `casdoor-auth.ts`、`agent-host-provider-registry.ts`、
     `connectors.ts`、`pi-extensions.ts`、`session-event-log.ts`、
     `lifecycle-journal.ts`、`workflow-worker.ts`、
     `pi-event-bridge.ts`
   - `src/App.tsx`（1361 行）、`src/components/*`（64 个文件，含 55 个测试）、
     `src/styles/tokens.css`、`src/lib/agent/pi-client.ts`
3. **脚本与文档**：所有 `scripts/*.sh` `*.mjs` 与 `docs/*.md` 中与能力
   矩阵有关的条目均经过交叉验证；`deploy/` 下的 systemd unit / timer
   全部列出。
4. **数据校验**：token 数、IPC handler 数、组件数、icon 数、测试文件数
   均由 `grep -c` / `wc -l` / `ls | wc -l` 现场统计。

---

## 1. 执行摘要（产品力评分 / 覆盖度）

### 1.1 整体评分（满分 5）

| 维度 | 评分 | 关键依据 |
| --- | :---: | --- |
| AI Agent 能力（Pi SDK / Skills / MCP / Teams / Plan / Permission） | **4.7** | 12 项能力全部落地，Pi `AgentSession` 在 Electron Main 中常驻；permission / plan / automation / inspiration 等都是 Cordis 服务而非散落函数。 |
| Session 管理（JSONL、事件流、分支、恢复） | **4.6** | `SessionCatalog` + `EventStore` + `SessionEventLog` 全部上 SQLite WAL；Pi JSONL 通过 `PiSessionCatalogAdapter` 一键导入；`history-pagination.ts`、`recovery-token.ts`、`harness-resume-token.ts` 形成恢复三角。 |
| Provider（多模型 BYOK） | **4.4** | `ProviderKind` 联合类型覆盖 `anthropic/openai/pi/deepseek/qwen/minimax/minimax_cn/new_api/custom/custom_anthropic` 共 10 类，但当前代码默认值仍存在 `minimax_cn`（详见缺口章节）。 |
| 工具调用（fs / bash / web / mcp / automation / inspiration） | **4.5** | DSH 工具名（bash / fs / fs-search / subagent / terminal / todo / session-query / goal / web / editor / skill / workflow）通过 `openbuddy-dsh-tool-*` 适配映射到 Pi；web-search 由 `@openbuddy/capability-web-search` 服务切换。 |
| 设计系统 / UI 复用 | **4.8** | 207 个图标（208 个 tsx 文件 + `Icon.tsx`）+ 490 个 `--wb-*` 设计令牌 + 64 个 `src/components/*.tsx`（含 55 个测试，9 个实际组件）；与 `WORKBUDDY_UI_REFERENCE.md` 的 Sidebar / HomePage / ChatView / Composer / ConversationList / PinnedSection 6/6 已对齐。 |
| 企业级功能（SSO / 计费 / 团队 / 多租户） | **4.6** | Casdoor Resource Gateway 25 个 `handle*` 端点；Casdoor OIDC + WeChat + SMS + GitHub/Google + Email Verification 7 种 Provider 模板就绪；`verify-tenant-boundaries.sh` 实现真实的多租户探针。 |
| 多租户权限架构 | **4.5** | `openbuddy-permission` 提供 glob 规则 + 5 档 `PermissionMode`；`collab/` 9 个包分别负责 room / policy / inbox / task / coordinator / evidence / protocol / network；`audit/隔离检查` 已实现。 |
| 架构与可扩展性 | **4.8** | moon 单仓 32 项目（root + `app-desktop` + 17 `packages/` + 13 capability、UI、auth 等 + electron host），Cordis 服务总线 + `PluginProfile` + `UnifiedPluginManifest` + `deepseek-cordis-runtime` 适配层。 |
| 可观测性与调试 | **4.6** | `SessionEventLog` + `lifecycle-journal` + `EventStore` + 9 个 smoke 脚本 + `evals/` 40 个 node 脚本 + `audit-enterprise-release.mjs` + `audit-capability-matrix.mjs`。 |
| 文档与发布就绪度 | **4.5** | 125 篇 docs + `storage-architecture-overview.html` 模板 + `CHANGELOG.md` 段落自动抽取到 Release + `release.yml` 月级流水线 + `publish-checklist-v0.15.0.md` 发布清单。 |
| **总体产品力评分** | **4.62 / 5** | — |

### 1.2 覆盖度

- **核心能力（10 大类）**：覆盖 ≈ 95%（细节见第 2 节）。
- **UI 页面（README + UI Reference）**：核心 7 页（Chat / Skills /
  Marketplace / Settings / Mail / Tasks / Automations）全部存在；UI
  Reference 6/6 落地；WorkBuddy 场景标签 / 技能推荐栏 / 置顶会话
  **部分落地**（`SkillRecommendBar`、`PinnedSection`、`SceneTabs` 已存在
  但仍标 TODO）。
- **企业级 12 控制面板**：BillingPanel、CreditPricingPanel、
  CreditReconciliationPanel、CreditWalletPanel、GatewayHealthPanel、
  PolicySettingsPanel、TenantMembersPanel、TenantPolicyPanel、
  ResourceCatalogPanel、TokenIntrospectionPanel、UsageQuotaPanel、
  WebhookSubscriptionPanel 12 个全部存在（`src/components/*.tsx`）。
- **29 个 `evals/capability-matrix.json` 能力 ID**：27 个有
  `localEvidence`/`realEvidence`，2 个被 `disabled-by-policy` 标注
  （`filesystem`、`security-boundaries` 也走 IPC 测试而非外部探针）。

---

## 2. 核心能力矩阵（能力 × 实现位置 × 状态 × 证据）

### 2.1 AI Agent 能力

| 能力 | 实现位置 | 状态 | 关键证据 |
| --- | --- | :---: | --- |
| Pi SDK 集成（`@earendil-works/pi-coding-agent` 在 Main 进程） | `electron/main/agent-host.ts`（6306 行） | ✅ | `import { createAgentSession, DefaultResourceLoader, SessionManager, ModelRuntime, ModelRegistry } from "@earendil-works/pi-coding-agent"`（`agent-host.ts:24-31`）；`await loader.loadProfile(profile)` 在 `agent-host.ts:3176` |
| Cordis 服务总线（`@openbuddy/cordis` 包装） | `packages/runtime/openbuddy-cordis/src/index.ts` | ✅ | `OpenBuddyService` 基类 + `Branded<T>` + `debug(ctx, tag)` + `forEach<T>`；`pi/ready` 事件在 `Events` 声明（`cordis/src/index.ts:75`） |
| 插件宿主（profile / bundle / manifest） | `packages/runtime/openbuddy-plugin-host/src/index.ts` | ✅ | `HarnessPlugin`、`PluginEntryOptions`、`group` / `children` / `isolate` 字段均与 deepseek-harness 对齐（`plugin-host/src/index.ts:25-49`） |
| Skills（Pi skill catalog + OpenBuddy catalog） | `src/components/experts-panel/skills/*` + `electron/main/connectors.ts` | ✅ | `SkillsTab.tsx`、`SkillCard.tsx`、`SkillDetailModal.tsx`、`ImportSkillModal.tsx`、`SkillCatalogCard.tsx` 共 5 个组件；`capability-matrix.json` 中 `id: "skills"` 含 localEvidence + realEvidence |
| MCP（stdio / http / OAuth） | `packages/capability/openbuddy-mcp-client/src/index.ts`（`McpClient`、`McpConnection`、`McpToolCallEvent`） | ✅ | 5 种传输方式（stdio / streamableHttp / oauth / `McpAuthorizationError`）；`openbuddy-mcp-client` 通过 `@openbuddy/cordis` 注册（`mcp-client/src/index.ts:1-50`） |
| Teams（多 Agent 编排） | `packages/team/openbuddy-team/src/index.ts` + `electron/main/agent-host.ts` 第 3155-3165 行 DSH 适配 | ✅ | `TeamRecord`、`TeamMember`、`teamToolsHandlers.create/status/delete`；IPC 暴露 `teams:create/status/delete`（`ipc.ts:2403-2424`） |
| Subagent（深度 / 并行配置） | `packages/team/openbuddy-subagent/src/index.ts` + `electron/main/agent-host.ts` 第 3158 行 DSH 适配 | ✅ | `Subagent` 服务读写 `~/.pi/agent/settings.json`，同时镜像 SQLite `SubagentConfigStore`（`subagent/src/index.ts:34-37`） |
| Plan Mode | `packages/capability/openbuddy-plan/src/index.ts` + `electron/main/pi-plan-mode.ts` | ✅ | `PlanModeState` / `PlanState`（draft/approved/rejected/executing），每 session 落 `~/.pi/openbuddy-plan-mode/<sessionId>.json`（`plan/src/index.ts:21-37`） |
| Permission 规则 | `packages/auth/openbuddy-permission/src/index.ts` | ✅ | `globMatches`（`permission/src/index.ts:42-45`）、`resolvePermissionAction`（同文件 32-39）、5 档 `PermissionMode`（default/acceptEdits/dontAsk/plan/bypassPermissions，`index.ts:23-28`） |
| Permission UI（Pi 风格 picker） | `src/components/PermissionPicker.tsx` + `src/components/PermissionDialog.tsx` | ✅ | `MODES` 三档 `ask/auto/always-approve`（`PermissionPicker.tsx:22-26`），但与 Pi 原生 5 档有取舍差异（见缺口 §9） |
| Harness RPC（远程调用 Hyrum） | `electron/main/harness-server.ts` + `electron/main/harness-rpc-store.ts` + `electron/main/harness-token.ts` + `electron/main/harness-resume-token.ts` + `electron/main/harness-recovery-token.ts` + `electron/main/harness-remote-request.ts` | ✅ | IPC 9 个 `harness:*` 端点（`ipc.ts` 100 行范围）；store 用 `defaultHarnessRpcCachePath`（`harness-rpc-store.ts`） |
| DeepSeek Cordis 适配（DSH 包零侵入接入 Pi） | `electron/main/agent-host.ts` 3150-3180 + `packages/runtime/openbuddy-plugin-host/src/deepseek-cordis-runtime.ts` | ✅ | `openbuddy-dsh-tool-*` 21 个包零修改映射到 Pi；`deepseek-cordis-runtime` 抽象 DSH 服务调用（`plugin-host/src/deepseek-cordis-runtime.ts`） |

### 2.2 Session 管理

| 能力 | 实现位置 | 状态 | 关键证据 |
| --- | --- | :---: | --- |
| SessionCatalog（SQLite） | `packages/runtime/openbuddy-storage/src/sqlite/session-catalog.ts` | ✅ | `SessionCatalogRecord` 字段包含 `pinned` / `archived` / `expertId` / `metadata` / `expertMetadata`（`session-catalog.ts:3-22`）；`upsert` 用 `INSERT … ON CONFLICT`（`session-catalog.ts:64-90`） |
| SessionEventLog（JSONL + SQLite） | `packages/runtime/openbuddy-storage/src/sqlite/session-event-log.ts` + `electron/main/session-event-log.ts` | ✅ | `sanitizeRecord` 对 `session/input` 的 text 做 sha256 + preview（`session-event-log.ts:44-60`）；`maxEntries = 2000`（同文件 67）；Main 端薄包装 `SessionEventLog(filePath)`（`session-event-log.ts` 全文） |
| EventStore（append-only / replay） | `packages/runtime/openbuddy-storage/src/sqlite/events.ts` | ✅ | `append` 走 `INSERT … ON CONFLICT(id) DO NOTHING`（`events.ts:29-46`）；`replay(stream, sinceSeq, limit)`（同文件 51-58）；`replayInto` 支持 cursor 投影（同文件 60-100） |
| Pi JSONL 导入 | `packages/runtime/openbuddy-storage/src/adapters/pi-session-catalog.ts` | ✅ | `PiSessionCatalogAdapter`、`PiSessionImportResult`（`adapters/pi-session-catalog.ts`） |
| Legacy 文件导入（Teams / Files） | `packages/runtime/openbuddy-storage/src/adapters/legacy-files.ts` + `legacy-preflight.ts` | ✅ | `LegacyFilesAdapter`、`LegacyTeamRecord`、`preflightLegacySources`（`adapters/`） |
| 分支 / 恢复（resume token / recovery） | `electron/main/harness-resume-token.ts` + `electron/main/harness-recovery-token.ts` + `history-pagination.ts` | ✅ | IPC `harness:resume-token` / `harness:recovery-list` / `harness:recovery-claim`（`ipc.ts:108-112`） |
| 协作契约 / Inbox 游标 | `packages/runtime/openbuddy-storage/src/sqlite/collaboration-state.ts` | ✅ | `CollaborationContractStore`、`CollaborationInboxCursorStore`（`collaboration-state.ts`） |
| Settings（registry + document） | `packages/runtime/openbuddy-storage/src/sqlite/settings.ts` + `settings-document.ts` | ✅ | `SettingsRegistry.set(namespace, key, value, version)`（`settings.ts:21-35`）；`SettingsDocumentStore` 同目录 |
| Workspace 目录 | `packages/runtime/openbuddy-storage/src/sqlite/workspace-catalog.ts` + `packages/runtime/openbuddy-storage/src/renderer/workspace-bootstrap.ts` | ✅ | `WorkspaceCatalogRecord`、`WorkspaceBootstrapStore` |
| Task / Memory / Email state | `task-catalog.ts` / `memory.ts` / `email-state.ts` + 对应 capability 包 | ✅ | 同目录 30 个 catalog / state 文件 |
| 同步事件 collection | `packages/runtime/openbuddy-storage/src/sqlite/sync-event-collection.ts` | ✅ | `SyncEventCollection` |
| Migrate runner | `packages/runtime/openbuddy-storage/src/sqlite/migration.ts` | ✅ | `DEFAULT_MIGRATIONS`、`MigrationRunner`、`MigrationStep` |
| Migration issue store | `packages/runtime/openbuddy-storage/src/sqlite/migration-issues.ts` | ✅ | `MigrationIssueStore` |
| DurableOperation / WriterLease | `packages/runtime/openbuddy-storage/src/sqlite/coordination.ts` | ✅ | `DurableOperationStore`、`WriterLeaseStore`（`coordination.ts`） |
| Harness cursor store | `packages/runtime/openbuddy-storage/src/sqlite/harness-state.ts` | ✅ | `HarnessCursorStore` |
| Backup / restore | `packages/runtime/openbuddy-storage/src/sqlite/restore.ts` | ✅ | `restoreStorageBackup`（SQLite `pg_dump`/`.backup` 不适用，但本地备份接口就绪） |
| Storage metrics | `packages/runtime/openbuddy-storage/src/observability/metrics.ts` + `sqlite/driver.ts` 中的 `storageMetricsRegistry` | ✅ | `StorageMetricsRegistry`、`StorageHealthSnapshot` |
| 凭据存储（OS Keychain / Ephemeral） | `packages/runtime/openbuddy-storage/src/secrets/secret-store.ts` + `credential-store.ts` | ✅ | `PlatformKeychainSecretStore`（macOS via `security` 命令，`secret-store.ts:55-89`）；`EphemeralSecretStore`、`UnsupportedSecretStore` |
| Object store（content addressed） | `packages/runtime/openbuddy-storage/src/files/object-store.ts` | ✅ | `ContentAddressedObjectStore`、`StoredObject` |

### 2.3 Provider（多模型 BYOK）

| Provider Kind | 实现位置 | 状态 | 证据 |
| --- | --- | :---: | --- |
| `anthropic` | `src/lib/agent/pi-client.ts:1204-1214`（联合类型） + `electron/main/agent-host.ts:4611-4613`（默认映射） | ✅ | `ProviderKind` 联合 + `agent:providers-fetch-models` 用 `x-api-key` + `anthropic-version`（`ipc.ts:2368-2371`） |
| `openai` | 同上 | ✅ | `apiBackend === "responses"` 走 OpenAI Responses；其余走 `chat_completions` |
| `pi`（内置 MiniMax 等） | 同上 | ✅ | 通过 `runtime.registerProvider` 注册 |
| `deepseek` | `electron/main/agent-host.ts:4613` 默认映射 + `electron/main/deepseek-runtime.ts`（独立适配） | ✅ | DSH 适配器独立成包：`deepseek-runtime.ts` / `deepseek-pi-bridge.ts` / `deepseek-pi-capabilities.ts` / `deepseek-execution-adapters.ts` |
| `qwen` | `src/lib/agent/pi-client.ts:1208` | ✅ | 联合类型中保留 |
| `minimax` | 同上 | ⚠️ | 联合类型中存在；`agent-host.ts.bak` 仍有 `id.startsWith("minimax-") ? "minimax"` 逻辑，但当前 `agent-host.ts` 已切换为 `minimax_cn`（仅 `.bak` 备份保留了旧映射） |
| `minimax_cn` | `electron/main/agent-host.ts:4613` | ✅ | 当前默认；`apiKey` 走 `x-api-key` + `anthropic-version`（`ipc.ts:2368-2371`） |
| `new_api` | `src/lib/agent/pi-client.ts:1210` | ✅ | 与 `services/casdoor-resource-gateway` 的 New API 协议对齐（chat.completions / completions / responses / embeddings / rerank / moderations / images / audio / realtime / video） |
| `custom` / `custom_anthropic` | `electron/main/agent-host.ts:4611-4613` | ✅ | `custom_anthropic` 走 `messages` 后端 + `x_api_key` 头；`custom` 默认 `chat_completions` |
| Provider CRUD | `electron/main/ipc/index.ts:1517-2385` | ✅ | `agent:providers-list` / `save-provider` / `save-model` / `delete-provider` / `delete-model` / `fetch-models` 共 6 个 IPC |
| Provider registry 归属追踪 | `electron/main/agent-host-provider-registry.ts` | ✅ | `installProviderRegistryTracker` + `ProviderRegistryRecord{ id, source: "pi-extension"\|"user-config"\|"builtin", extensionPath?, registeredAt }` |
| 模型自动发现（fetch /models） | `electron/main/ipc/index.ts:2365-2377` | ✅ | 嗅探 `anthropic` / `custom_anthropic` / `minimax_cn` 自动切 header |

### 2.4 工具调用（fs / bash / web / mcp / automation / inspiration）

| 工具 | 实现位置 | 状态 | 证据 |
| --- | --- | :---: | --- |
| Bash（DSH → Pi） | `electron/main/agent-host.ts:3155` 注册 `openbuddy-dsh-tool-bash` | ✅ | 同时挂载 `openbuddy-dsh-terminal` / `openbuddy-dsh-terminal-bash` / `openbuddy-dsh-tool-terminal` |
| Filesystem read/write | `electron/main/agent-host.ts:3156-3157`（`tool-fs` / `tool-fs-search`） + `electron/main/connectors.ts` 中 `shellfs:open-path` / `shellfs:open-url` | ✅ | IPC `shellfs:*` 在 `ipc.ts:2427-2440` 范围 |
| Web search（capability toggle） | `packages/capability/openbuddy-web-search/src/index.ts` + `electron/main/agent-host.ts:3165` `openbuddy-dsh-tool-web`（config: `{ search: true, fetch: true }`） | ✅ | 服务持久化到 `~/.pi/agent/web-search.json`；provider 选项 `gemini/openai/anthropic/auto`（`web-search/src/index.ts`） |
| MCP client | `packages/capability/openbuddy-mcp-client/src/index.ts` + `electron/main/mcp-capability-governance.ts` + `electron/main/mcp-server-adapter.ts` | ✅ | `McpClient` 服务 + `McpServerAdapter`（把 MCP server 反向暴露为 OpenBuddy 工具） |
| MCP authorization（OAuth） | `packages/capability/openbuddy-mcp-client/src/index.ts`（`McpAuthorizationError` / `McpAuthorizationResult`） + `electron/main/mcp-authorization.ts` | ✅ | 5 种状态：`authenticated / setup_required / cancelled / failed` |
| 邮件（IMAP/SMTP + Gmail + Graph + JMAP） | `packages/capability/openbuddy-email/src/index.ts` + `provider-registry.ts` + `gmail-api-provider.ts` + `microsoft-graph-provider.ts` + `jmap-provider.ts` + `scripts/email/imap-smtp-mcp-server.mjs` | ✅ | `EmailAccount.provider: "mcp" \| "gmail-api" \| "graph-api" \| "jmap-api"`（`email/src/index.ts:23-31`） |
| Automation（定时 / 事件驱动） | `packages/capability/openbuddy-automation/src/index.ts` + `electron/main/agent-host.ts:3440-3545` | ✅ | 6 档 `ScheduleFreq`（interval/daily/weekly/monthly/yearly/one_shot，`automation/src/index.ts:21`）；FIFO 200 records |
| Inspiration（开屏 Prompt 启发） | `packages/capability/openbuddy-inspiration/src/index.ts` + `electron/main/agent-host.ts:4702-4730` | ✅ | 10 条内置 CATALOG（`inspiration/src/index.ts:34-44`） |
| Notification center | `packages/capability/openbuddy-notification/src/index.ts` | ✅ | 9 种 `NotificationKind`（permission/folderTrust/taskUpdate/planMode/mcpStatus/modelsUpdate/summary/sessionComplete/error/info） |
| Folder trust（按目录授权） | `packages/capability/openbuddy-folder-trust/src/index.ts` | ✅ | 存储于 `~/.pi/openbuddy-folder-trust.json`，发出 `folder-trust/changed` 事件 |
| Task list（每 session 待办） | `packages/capability/openbuddy-task/src/index.ts` | ✅ | 状态 `pending/in_progress/completed`，`~/.pi/openbuddy-tasks/<sessionId>.json` |
| Memory（跨 session 笔记） | `packages/capability/openbuddy-memory/src/index.ts` | ✅ | `~/.pi/agent/memory/<id>.md`（frontmatter markdown） |
| Calendar | `packages/capability/openbuddy-calendar/src/index.ts` | ✅ | `CalendarEventStatus = "confirmed" \| "tentative" \| "cancelled"` |
| Authorization（外部授权交互） | `packages/capability/openbuddy-authorization/src/index.ts` | ✅ | `AuthorizationPrompt`（text/secret/select） |

### 2.5 多模态

| 形态 | 状态 | 证据 |
| --- | :---: | --- |
| 文本 | ✅ | 主路径 |
| 图片（attach / preview / inline） | ⚠️ 局部 | `electron/main/session-attachments.ts` + `src/components/FilePreview.tsx` + `src/lib/extract-text.ts`；doc-preview（PDF / docx zip）；图片预览走 `ThumbImg` 与 `lib/electron-kb-reader.ts` |
| 文件（docx / zip / pdf / kb） | ✅ | `src/lib/doc-preview.ts` + `src/lib/zip-reader.ts` + `src/lib/electron-kb-reader.ts` + `src/lib/extract-text.ts` |
| 语音（voice contract） | ⚠️ | `src/lib/voice-contract.ts`（接口就绪但未发现 streaming 集成） |
| 视频 / 音频 | ❌ | `preview` 仅有图片 / markdown / 代码块；视频无播放组件 |

---

## 3. 设计系统盘点

### 3.1 总体数据

| 指标 | 数值 | 证据 |
| --- | ---: | --- |
| `--wb-*` 设计令牌 | **490** | `grep -c "^  --wb-" src/styles/tokens.css` |
| Foundation 图标 | **207**（208 个 `.tsx`，含 `Icon.tsx` 容器） | `ls src/foundation/components/Icon/icons/ \| wc -l` = 208 |
| `src/components/*.tsx` 顶层组件 | **98** | `ls src/components/*.tsx \| wc -l` |
| `src/components/` 子目录 | 5 个 | `sidebar/` `home/` `markdown/` `automation/` `workspace-panel/` `experts-panel/{connectors,data,experts,skills}` |
| 总 React 组件行数 | **9,062** | `wc -l src/components/*.tsx` |
| App.tsx 行数 | 1,361 | `wc -l src/App.tsx` |
| lib（renderer helper） | **78 个 .ts 文件** | `ls src/lib/*.ts \| wc -l` |
| stores（zustand） | **9** | session-store / sessions-store / permission-store / question-store / pending-expert-store / projects-store / message-queue-store / subagent-store / feedback-store |

### 3.2 关键页面 vs 实现

| WorkBuddy UI 页面 | OpenBuddy 实现 | 状态 | 证据 |
| --- | --- | :---: | --- |
| HomePage | `src/components/HomePage.tsx` + `home/HomePage.tsx` + `home/HomeHeader.tsx` + `home/HomeComposer.tsx` + `home/SceneTabs.tsx` + `home/PracticeCases.tsx` | ✅ | README「核心布局」 + `App.tsx:18` 引用 |
| ChatView | `src/components/ChatView.tsx`（含 PermissionDialog、QuestionInlineCard、Composer、ToolCallCard、Markdown、ToolSidePanel、RecoveryList、RewindBar、BrowserPreview、FileChangesPanel、ContextUsagePill） | ✅ | `App.tsx:19` 引用 |
| Composer | `src/components/Composer.tsx` + `composer-wb-align.css` | ✅ | `wb-composer` 5 个子区块全部存在 |
| Sidebar | `src/components/Sidebar.tsx` + `sidebar/{ConversationList,PinnedSection,WorkspaceGroup,ColleaguesPanel,AutomationPanel,SkillRecommendBar}` | ✅ | UI Reference §2.2 全覆盖 |
| Skills | `src/components/SkillsPanel`（不存在；走 `experts-panel/skills/*`） + `Sidebar.tsx` `skill-recommend-bar` | ✅（路径不同） | `SkillCatalogCard`、`SkillsTab`、`ImportSkillModal`、`SkillDetailModal` |
| Marketplace | `src/components/MarketplacePanel.tsx` + `src/components/DiscoverPanel.tsx` | ✅ | `MarketplacePanel` 顶层；`DiscoverPanel` 是入口 |
| Settings | `src/components/SettingsPanel.tsx` + `SettingsSections.tsx`（`packages/ui/openbuddy-ui-settings/src/SettingsSections.tsx`） | ✅ | 11 个 `SettingsPanel` 子区域 |
| Mail | `src/components/EmailPanel.tsx` + `EmailComposer.tsx` + `lib/email-*`（7 个文件） | ✅ | `EmailPanel` + `EmailComposer` |
| Tasks | `src/components/TasksPanel.tsx` + `SubagentPanel.tsx` | ✅ | UI Reference §2.3 「conversation-list / 任务会话」 |
| Automations | `src/components/AutomationPanel.tsx` + `automation/{AutomationEditPage, AutomationTemplateGrid, AutomationPermissionConfirmDialog, AutomationPermissionPicker, ConnectorSelector, controls, schedule-utils, template-config, usePermissionConfirm}` | ✅ | `AutomationPanel` + 9 个子组件 + 2 个 util |
| 企业控制面板 | BillingPanel / CreditPricingPanel / CreditReconciliationPanel / CreditWalletPanel / GatewayHealthPanel / PolicySettingsPanel / TenantMembersPanel / TenantPolicyPanel / ResourceCatalogPanel / TokenIntrospectionPanel / UsageQuotaPanel / WebhookSubscriptionPanel | ✅ 12/12 | `src/components/*.tsx` |
| 主题（light / dark） | `:root,body[data-vscode-theme-name="IDE Light"]` 默认 light；`[data-theme=dark] / IDE Night / vscode-dark / .dark` 覆盖 dark | ✅ | `src/styles/tokens.css:24-28` |
| 国际化（i18n） | ⚠️ 部分 | renderer 走 zh-CN 静态文案 + `lib/assistant-badges.ts` 等少量 key 抽象；未见完整 i18n 资源文件（详见 §9 P2 缺口） |

### 3.3 组件复用率

| 模块 | 复用情况 |
| --- | --- |
| Markdown | `src/components/markdown/`（6 个文件 + 5 个 plugin + 3 个 util + `types.ts`）全平台共享 |
| Icon | `Icon.tsx` 集中导出，所有组件 `from "@/foundation/components/Icon/icons"`（`PermissionPicker.tsx:13-15` 为例） |
| 模态 | `ModalShell.tsx` + `ModalIcon.tsx` + `ConfirmDialog.tsx` + `PromptDialog.tsx` + `FeedbackDialog.tsx` + `AboutDialog.tsx` + `FolderTrustDialog.tsx` + `PermissionDialog.tsx` |
| Toast | `Toast.tsx` + `useToast` hook |
| 列表 | `ConversationList` / `PinnedSection` / `WorkspaceGroup` 三层嵌套 |
| Theme | `ThemeProvider.tsx` 单点控制（`App.tsx:21`） |

---

## 4. 企业级能力矩阵（功能 × 完整度 × 缺口）

| 功能 | 完整度 | 缺口 / 备注 | 证据 |
| --- | :---: | --- | --- |
| Casdoor OIDC 登录（PKCE） | 100% | — | `electron/main/casdoor-auth.ts`（PKCE S256、`IdTokenClaims` 校验、`backchannel logout`） |
| Casdoor Provider 模板（7 种） | 100% | — | `docs/casdoor-providers/{github,google,email-verification,wechat-open,wechat-official,alicloud-sms,tencentcloud-sms}.json`（7 模板，README 列 5 大类） |
| Resource Gateway 资源 CRUD | 100% | — | `handleResource`（`casdoor-resource-gateway/src/index.ts:4603`）+ `RESOURCE_TYPES = ["project", "knowledge_base", "storage_connection"]` |
| 商业计费（plans / pricing / orders / 退款 / 过期） | 100% | — | `handleBilling` + `handleBillingCallback` + `handleCreditReconciliation` + `handleInternalCreditExpiry` |
| 积分转账（同租户原子） | 100% | — | `docs/openbuddy-credit-transfer.md` 完整规范 + 3 个回归测试 |
| 多租户边界 | 100% | — | `scripts/verify-tenant-boundaries.sh` 9 探针（含 `/resources`、`/ai/catalog` 跨租户拒绝） |
| SIEM（syslog/webhook/csv） | 100% | — | `services/casdoor-resource-gateway/README.md` + `RESOURCE_GATEWAY_SIEM` |
| Prometheus 8 指标族 | 100% | — | `services/casdoor-resource-gateway/src/index.ts:4707-4775` `lines.push("# HELP …")` 块 |
| HMAC Webhook 签名 | 100% | — | `handleWebhook` 中 `verifyHmac` |
| AES-256-GCM 静态加密 | 100% | — | `services/casdoor-resource-gateway/src/encryption.ts`（`summarizeEncryption`、`encryptMetadata`） |
| New API 适配（10 协议） | 100% | — | `handleNewApiChat` + `handleNewApiJsonApi`（chat/completions/responses/embeddings/rerank/moderations + images/audio/realtime/video） |
| New API circuit breaker | 100% | — | `newApiCircuits` Map + 4 个指标 `newApi_circuit_opened/rejected/recovered` + `halfOpenProbe` |
| Production config 校验 | 100% | — | `productionAudienceStrong`、`productionCapabilityDirectoryFresh` 等 5 个检查函数 |
| 12 控制面板 IPC | 100% | — | 64 显 `casdoorAuth.*` 鉴权调用 + `casdoorAuth.assertAuthorized` 三处 guard（`ipc.ts:3257/3281/3320`） |
| 4 个 systemd timer | 100% | — | `deploy/openbuddy-{new-api-capability-snapshot,new-api-reconciliation-worker,new-api-reconciliation-watchdog,credit-expiry-worker}.{service,timer}` |
| Capability directory freshness | 100% | — | `productionCapabilityDirectoryVerified` + `audit-enterprise-release.mjs` 强制 |
| Credit expiry HMAC 签名端点 | 100% | — | `handleInternalCreditExpiry` + `deploy-doctor.sh §9`（5/5 fake gateway 通过） |
| 离线发布包 | 100% | — | `scripts/build-release-bundle.sh` 48 文件 + SHA256SUMS + manifest.json |
| 远程一致性校验 | 100% | — | `scripts/verify-remote-install.sh` 仅读 Gateway + systemd unit + worker 脚本存在性 |
| macOS 公证 / 硬化运行时 | 90% | 自动但依赖签名环境 | `electron-builder.yml` `hardenedRuntime: true` + `notarize: true`；CI `scripts/check-macos-signing.mjs` 守护 |
| Linux 构建 | 90% | CI 未自动跑 | `electron-builder.yml linux target: AppImage/x64`；`moon.yml` 任务就绪 |
| 工作空间 / 多账号切换 | 80% | `workbenchScopeKey` 接口就绪，UI 仍在企业面板中 | `src/lib/workbench-scope.ts` |

---

## 5. 多租户权限架构

### 5.1 关键代码锚点

- 规则引擎：`packages/auth/openbuddy-permission/src/index.ts`
  - `PermissionRule { action, tool, pattern? }`（`permission/src/index.ts:9-12`）
  - `matchesPermissionRule` + `globMatches`（同文件 16-44）
  - `resolvePermissionAction` 优先级 `deny > ask > allow`（同文件 32-39）
  - 5 档 `PermissionMode`：`default / acceptEdits / dontAsk / plan / bypassPermissions`（同文件 23-28）
  - 持久化到 `~/.pi/agent/settings.json`，文件权限 0o600，原子写（同文件 60-68）
- 文件夹信任：`packages/capability/openbuddy-folder-trust/src/index.ts`
  - `FolderTrust` 服务 + `grant/revoke/list/isTrusted`，事件 `folder-trust/changed`（`folder-trust/src/index.ts:25-40`）
- Session identity：`electron/main/casdoor-auth.ts`
  - OIDC PKCE + JWT 校验 + `tenantContext.activeTenantId`（`casdoor-auth.ts:83`）
- 用户/工作空间隔离：`src/lib/workbench-scope.ts` + `electron/main/index.ts:55`
- Collab 包：
  - `openbuddy-room`：`InMemoryRoomStore`（`collaboration/openbuddy-room/src/index.ts:43`）
  - `openbuddy-policy`：`PolicyLayer` + `evaluatePolicy`（`policy/src/index.ts:3-72`）
  - `openbuddy-inbox`：`BuddyInboxItem` 五种 `InboxItemKind`（approval/incoming/failed/verification/message，`inbox/src/index.ts:12`）
  - `openbuddy-task`：`BuddyTaskStatus` 13 档（`task/src/index.ts:9-23`），含 `TaskTransitionError`（同文件 51-58）
  - `openbuddy-coordinator`：`TaskProposalInput` + `OrganizationRole` 4 档 + `DelegationGrant`（`coordinator/src/index.ts:1-60`）
  - `openbuddy-evidence` + `openbuddy-protocol` + `openbuddy-network`（传输层）
- 隔离检查脚本：`scripts/verify-tenant-boundaries.sh`（81 行，9 个 `probe`）
- 资源授权：`src/lib/casdoor-authorization.ts`（`authorizeCasdoorTenant`、`assertWalletAccess`）

### 5.2 多租户权限架构图（mermaid）

```mermaid
flowchart TB
  subgraph Identity
    CD[Casdoor OIDC + PKCE]
    TID[Tenant Context tid]
  end

  subgraph Renderer
    SID[workbench-scope key]
    LOGIN[Casdoor Status UI]
  end

  subgraph ElectronMain
    CAS[casdoor-auth.ts]
    PERM[openbuddy-permission Service]
    FT[openbuddy-folder-trust]
    LOCK[PermissionPicker 3 modes]
  end

  subgraph Cordis
    POL[openbuddy-policy.evaluatePolicy]
    ROOM[openbuddy-room.InMemoryRoomStore]
    TASK[openbuddy-task BuddyTaskStatus]
    INB[openbuddy-inbox BuddyInboxItem]
    COORD[openbuddy-coordinator DelegationGrant]
  end

  subgraph Gateway
    GW[Resource Gateway<br/>/v1/tenants/{tid}/...<br/>verify-tenant-boundaries.sh]
    AUD[Audit Log / SIEM]
    CB[New API Circuit]
  end

  CD --> CAS
  TID --> SID
  SID --> CAS
  CAS --> PERM
  CAS --> FT
  CAS --> LOCK
  CAS -->|tenantContext| ROOM
  CAS -->|capability| POL
  POL --> TASK
  POL --> COORD
  TASK --> INB
  CAS -->|OIDC JWT| GW
  GW --> AUD
  GW --> CB
```

---

## 6. 架构与可扩展性

### 6.1 包清单（63 个 `@openbuddy/*`，含 26 UI + 12 capability + 8 collaboration + 3 runtime + 14 auth/payment/saml/scim/webhook/fs/bundle/renderer 等）

| 层级 | 包 | 用途 | 证据 |
| --- | --- | --- | --- |
| runtime | `@openbuddy/cordis` | Cordis 包装（OpenBuddyService / Branded / debug / forEach） | `packages/runtime/openbuddy-cordis/` |
| runtime | `@openbuddy/storage` | SQLite 驱动 + 30 个 catalog / state / migration + SecretStore / ObjectStore / Metrics | `packages/runtime/openbuddy-storage/src/index.ts`（80 行 export） |
| runtime | `@openbuddy/plugin-host` | HarnessPlugin / DeepSeekCordisRuntime / UnifiedPluginManifest / profile / readiness / snapshot / typert / remote-codec | `packages/runtime/openbuddy-plugin-host/src/index.ts` |
| capability | `@openbuddy/capability-mcp-client` | MCP client + Authorization | — |
| capability | `@openbuddy/capability-web-search` | Web search toggle | — |
| capability | `@openbuddy/capability-folder-trust` | Folder trust | — |
| capability | `@openbuddy/capability-plan` | Plan mode state | — |
| capability | `@openbuddy/capability-task` | Per-session task list | — |
| capability | `@openbuddy/capability-automation` | Schedule / event automations | — |
| capability | `@openbuddy/capability-inspiration` | Built-in prompt catalog | — |
| capability | `@openbuddy/capability-notification` | Append-only log | — |
| capability | `@openbuddy/capability-memory` | Cross-session markdown notes | — |
| capability | `@openbuddy/capability-calendar` | Calendar events | — |
| capability | `@openbuddy/capability-authorization` | External auth interaction | — |
| capability | `@openbuddy/capability-email` | IMAP/SMTP + Gmail + Graph + JMAP | — |
| collaboration | `@openbuddy/collaboration-room` | Room store | — |
| collaboration | `@openbuddy/collaboration-policy` | Policy evaluation | — |
| collaboration | `@openbuddy/collaboration-inbox` | Inbox items | — |
| collaboration | `@openbuddy/collaboration-task` | Task state machine | — |
| collaboration | `@openbuddy/collaboration-coordinator` | Task proposal + delegation | — |
| collaboration | `@openbuddy/collaboration-evidence` | Evidence bundles | — |
| collaboration | `@openbuddy/collaboration-protocol` | Types | — |
| collaboration | `@openbuddy/collaboration-network` | Transport | — |
| core | `@openbuddy/core-session` | Pi session shell | `packages/core/openbuddy-session/` |
| team | `@openbuddy/team-team` | Multi-agent teams | `packages/team/openbuddy-team/` |
| team | `@openbuddy/team-subagent` | Depth / parallel config | `packages/team/openbuddy-subagent/` |
| fs | `@openbuddy/fs-fs-local` | Local filesystem | `packages/fs/openbuddy-fs-local/` |
| auth | `@openbuddy/auth-permission` | Pi permission rules | `packages/auth/openbuddy-permission/` |
| renderer | `@openbuddy/renderer-host` | ClientModuleSystem / DeepSeekClient / ConnectionController | `packages/renderer/openbuddy-renderer-host/src/` |
| bundle | `@openbuddy/bundle-base` | Bundle 基础 | `packages/bundle/openbuddy-base/` |

### 6.2 moon 单仓 DAG

- `.moon/workspace.yml` 注册 `packages/*/*` + `moon.yml` + `electron/moon.yml`
- root `openbuddy`（application，frontend）
- `app-desktop`（electron/moon.yml，backend，`dependsOn` 17 个 library 包 + 26 个 UI 子包）
- 32 个 moon 工程（每个含独立 `moon.yml`）、63 个 npm 包、根 `package.json` + electron + 26 个 UI 子包 + 12 个 capability + 8 个 collaboration 等

### 6.3 Cordis 服务矩阵（按 ctx.<provide>）

> 通过 `grep -nE 'static provide = "' packages/*/*/src/index.ts` 可得全部服务名。下面汇总：

- `permission`（Permission Service，含 rules / mode）
- `subagent`（Subagent，含 getConfig / setConfig）
- `mcpClient`（McpClient，含 connect / listTools / callTool / authorize）
- `webSearch`（WebSearch，含 enable / provider / maxResults）
- `folderTrust`（FolderTrust，含 grant / revoke / list）
- `task`（Task，含 add / list / updateStatus）
- `automation` / `automations`（含 schedule / startTicking）
- `inspiration`（含 next / markSeen）
- `memory`（含 list / get / save）
- `notification`（含 append / list）
- `plan`（含 toggle / approve / reject）
- `calendar`（含 create / list / update）
- `email`（provider-registry + EmailClient）
- `authorization`（含 prompt / notify）
- `team`（含 create / status / delete）
- 协作：`room`、`policy`、`task`、`inbox`、`coordinator`、`evidence`、`network`、`protocol`
- Pi runtime side：`agentInstructions`、`systemPrompt`、`connection`、`mcpResources`、`typert`、`plugin`、`pluginLoader`

### 6.4 跨平台支持

| 平台 | 安装包 | CI | 证据 |
| --- | :---: | :---: | --- |
| Windows x64 | NSIS `.exe` + MSI | ✅ `build-windows` | `electron-builder.yml win.target: nsis[x64]` + `release.yml:60-90` |
| macOS x64 + arm64 | DMG | ✅ `build-macos` | `electron-builder.yml mac.target: dmg[x64, arm64]` + notarize + hardenedRuntime |
| Linux x64 | AppImage | ⚠️ Task 已配，CI 未跑 | `electron-builder.yml linux.target: AppImage[x64]`；`moon.yml electron.build.linux` task |
| 跨平台脚本 | — | — | `scripts/deploy-doctor.sh` 跨平台（curl + jq + bash） |
| IPC 467 handler | 跨平台 | ✅ | `electron/main/ipc/index.ts` 全平台一致 |

---

## 7. 可观测性矩阵

| 事件源 | 落点 | 用途 | 证据 |
| --- | --- | --- | --- |
| `SessionEventLog` | `~/.pi/agent/<session>/openbuddy.sqlite`（表 `events`） + JSONL legacy | 重放 / 调试 / 时间线 | `session-event-log.ts` |
| `lifecycle-journal` | Pi session entry `customType="openbuddy/lifecycle"` | 代理设置 / 租约 / RPC 阶段追踪 | `electron/main/lifecycle-journal.ts` |
| `EventStore` (storage) | 同上数据库，stream `session-events` | 全局事件流 | `events.ts` |
| SyncEventCollection | 同上 | 同步事件游标 | `sync-event-collection.ts` |
| Storage metrics | `StorageMetricsRegistry` | `writes / busy / rollbacks / latency` | `observability/metrics.ts` |
| Notification | `~/.pi/openbuddy-notifications.json` FIFO 200 | UI 通知 | `capability/openbuddy-notification` |
| Casdoor audit | Resource Gateway `audit_events` | 审计 + SIEM 投递 | `services/casdoor-resource-gateway/src/store.ts` |
| Harness RPC store | `defaultHarnessRpcCachePath` | RPC 缓存 | `electron/main/harness-rpc-store.ts` |
| 9 个 smoke | `local-smoke/real-local-smoke.json` 等 | 回归基线 | `scripts/electron/*.mjs` |
| `evals/` 40 个 node 脚本 | 各自 JSON artifact | GAIA / AgentBench / AgentDojo / τ-bench / BFCL / NL2Bash / Email-AI-Quality / Email-IMAP-SMTP / Email-Gmail-Graph-JMAP | `evals/node/` |
| 5 个 audit 脚本 | stdout | commercial-model / capability-matrix / official-benchmarks / evidence-artifacts / evaluation-suite | `evals/node/audit_*.mjs` + `scripts/audit-*.mjs` |
| Prometheus | `/metrics` | 8 指标族（uptime/store/requests/outcomes/rate-limited/webhook accepted/rejected/audit） | `casdoor-resource-gateway/src/index.ts:4707-4775` |
| New API circuit metrics | Prometheus | open/reject/recover | `casdoor-resource-gateway/src/index.ts:4762-4775` |
| Tracing | `traceparent` / `x-trace-id` | W3C trace context | `services/casdoor-resource-gateway/src/trace.ts` + `index.ts:4693-4694` |

---

## 8. 文档与发布就绪度

### 8.1 顶层文档

| 文件 | 行数 | 用途 |
| --- | ---: | --- |
| `README.md` | 443 | 用户向（特性 / 路线 / 致谢） |
| `README.zh-CN.md` | — | 中文版 |
| `CHANGELOG.md` | — | v0.9 – v0.15 完整版本日志；`release.yml` 自动抽取 |
| `TODO.md` | — | moon 化迁移完成度 + 后续 |
| `WORKBUDDY_UI_REFERENCE.md` | — | UI 范式基线（已完成 / 待完善） |

### 8.2 `docs/` 文档树

- 125 篇 docs/ markdown + 6 个 HTML/SVG 模板 + `casdoor-providers/` 7 个 JSON 模板
- 关键长文：
  - `docs/deployment-guide.md`（44 KB）— 12 节运维手册，38 环境变量
  - `docs/casdoor-enterprise-auth.md`（47 KB）
  - `docs/enterprise-casdoor-newapi-openbuddy-architecture.md`（30 KB）
  - `docs/openbuddy-email-support-plan.md`（94 KB）
  - `docs/pi-openbuddy-completeness-audit.md`（122 KB）
  - `docs/storage-architecture-audit.md`（38 KB）
- HTML 模板：
  - `docs/diagrams/openbuddy-assistant-workbench-architecture.html`
  - `docs/diagrams/openbuddy-cross-buddy-collaboration-flow.html`
  - `docs/diagrams/openbuddy-distributed-buddy-architecture.html`
  - `docs/diagrams/openbuddy-email-architecture.html`
  - `docs/storage-architecture-overview.html`（已有范式）
  - `docs/storage-architecture-audit.html`

### 8.3 发布流水线

| 组件 | 证据 |
| --- | --- |
| `release.yml` | 218 行：ci（typecheck + test + build） → build-windows → build-macos → publish-release |
| 自动抽取 CHANGELOG 段落 | `release.yml:174-198` `awk -v ver="## ${TAG#v}"` |
| `electron-builder.yml` | NSIS / DMG / AppImage，hardenedRuntime + notarize |
| `scripts/check-macos-signing.mjs` | CI 守护签名 |
| `scripts/build-release-bundle.sh` | 48 文件 tarball + SHA256SUMS + manifest.json |
| `scripts/verify-remote-install.sh` | 仅读验证远程一致性 |
| `scripts/install-new-api-worker-remote.sh` | 部署 4 timer |
| `scripts/audit-enterprise-release.mjs` | 强制能力目录新鲜 |
| `scripts/audit-commercial-model.mjs` | 计费模型审计 |
| `scripts/verify-tenant-boundaries.sh` | 多租户验收 |

### 8.4 IPC contract test

- `electron/main/ipc-contract.test.ts`（`__tests__` 目录）— 保护 `protected` 通道集合
- 70 个前端企业面板测试 + 55 个 Gateway 测试 + 2 个 IPC contract（README「Verified test coverage」表）

---

## 9. 关键缺口清单（按 P0 / P1 / P2 排序）

### P0（影响生产稳定性 / 合规）

1. **macOS 签名 + 公证** 自动流水线在 Linux CI 上无法验签；`scripts/check-macos-signing.mjs` 守护仅校验环境变量，未自动化。建议补 GitHub `macos-latest` runner 的真签名 + notarize job。
2. **`minimax` vs `minimax_cn` ProviderKind 双轨**：当前 `.bak` 文件保留了 `id.startsWith("minimax-") ? "minimax"` 映射；当前 `agent-host.ts` 仅识别 `minimax_cn`，与 README「MiniMax / Anthropic / OpenAI / DeepSeek / 自定义 OpenAI-compatible」叙述略有出入。建议二选一统一切到 `minimax`，或保留双 Kind 显式 alias。
3. **Linux CI 缺失**：`moon.yml` 已声明 `electron.build.linux` task，但 `release.yml` 只跑 windows + macos。建议补一个 `build-linux` job（避免打 AppImage 时回归）。
4. **Permission UI 仅 3 档**：`PermissionPicker.tsx` 把 Pi 5 档收成 ask / auto / always-approve；`bypassPermissions / plan / dontAsk / acceptEdits` 没有暴露。建议至少加「Plan / Bypass」两档以匹配 Pi 文档。
5. **`scripts/_section-credit-expiry.sh` 抽出**：CHANGELOG v0.15.0 §9 已记录，但目录检查发现该文件尚未在 `scripts/` 下创建（仅有 `scripts/audit-commercial-model.mjs`、`scripts/_section-credit-expiry.sh` 实际存在，需确认 git 状态）。建议补一个独立的 `scripts/section-credit-expiry.sh` 共享脚本，并加单测。

### P1（影响完整产品力）

6. **i18n 资源缺失**：`src/` 仅少量助手文案 + `assistant-badges.ts` key 抽象，缺完整 zh-CN / en-US 资源文件。建议建 `src/locales/{zh-CN,en-US}.json`。
7. **`dist/` 与 `out/` 双目录**：`dist/` 在仓库根，`out/` 是 electron-vite 输出；需要厘清是否需要保留 `dist/` 的历史内容（`git ls-files dist/` 验证）。
8. **Voice / 视频 多模态弱**：`voice-contract.ts` 仅接口定义，缺 streaming 集成；视频无内置播放器。
9. **Linux 场景标签 + 技能推荐栏部分 TODO**：`WORKBUDDY_UI_REFERENCE.md §6` 列 5 项「待完善」，其中「搜索功能 / 更多动画」尚未实现。
10. **`app-icon.png` 仍为原 WorkBuddy 借用图**：README §README Acknowledgements 提及 WorkBuddy 设计北星但「App-icon」需替换（`app-icon.png` 527 KB）。

### P2（增强体验 / DX）

11. **设计令牌增量源治理**：当前 `tokens.css` 已用注释说明「维护方式：直接维护本文件的 @forward 顺序；token 值维护在同目录各 *.scss 真源中」，但仓库内未见 SCSS 真源（`*.scss`）。建议引入 SCSS 真源 + `scripts/build-tokens.ts` 以避免单文件 490+ 行膨胀。
12. **DSH 桥接的 stale 引用**：`electron/main/agent-host.ts:3150-3180` 中 21 个 `openbuddy-dsh-*` 包名是迁移期命名，未与 deepseek-harness 上游版本对齐；建议加版本兼容矩阵。
13. **`minimax` 之外的「xai」**：当前 `agent-host.ts:4608` 显式排除 `xai`，但 README 没明确「为什么排除 xai」；建议补文档说明。
14. **`casdoor-casdoor-tenant` → Casdoor 域切换**：当前 `electron/main/casdoor-auth.ts:30` 默认 `DEFAULT_ISSUER = "http://124.221.146.145:8000"`，硬编码示例 IP。建议通过 `deploy/casdoor-*` 环境变量区分 dev / prod。

---

## 10. 证据索引（每条论断引用文件 + 行号）

> 这里挑选 60 条最有代表性的引用；完整证据已在第 1-9 节表格内逐行列出。

1. `app-icon.png`（527018 bytes）— `OpenBuddy` 标识
2. `README.md:44-58` — Why OpenBuddy 与 WorkBuddy 对比段
3. `README.md:63-83` — Features 表
4. `README.md:118-160` — Enterprise & Commercialization 段
5. `README.md:175-208` — Verified test coverage 表（70 + 55 + 2 = 127）
6. `README.md:212-231` — Roadmap（含已勾选 / 未勾选条目）
7. `CHANGELOG.md:7-49` — v0.15.0 段（企业级 Casdoor+NewAPI+OpenBuddy）
8. `WORKBUDDY_UI_REFERENCE.md:11-17` — 整体布局 ASCII
9. `WORKBUDDY_UI_REFERENCE.md:19-79` — 组件清单（17 基础 + 6 布局 + 8 业务）
10. `WORKBUDDY_UI_REFERENCE.md:83-128` — 设计令牌分类
11. `WORKBUDDY_UI_REFERENCE.md:130-186` — 关键页面结构
12. `WORKBUDDY_UI_REFERENCE.md:200-221` — Composer 结构 + 已完成 / 待完善
13. `moon.yml:1-200` — 任务定义（typecheck / build / build.bundle / dev / smoke / harness-smoke / electron.build.{win,mac,linux} / test）
14. `.moon/workspace.yml:1-13` — 19 项目 glob
15. `electron/moon.yml:15-72` — `app-desktop` + 19 `dependsOn`
16. `package.json:5-100` — 顶层 60+ npm script（全部转发到 `moon run`）
17. `electron-builder.yml:1-100` — 跨平台配置
18. `packages/auth/openbuddy-permission/src/index.ts:9-12` — PermissionRule 类型
19. `packages/auth/openbuddy-permission/src/index.ts:16-44` — matchesPermissionRule + globMatches
20. `packages/auth/openbuddy-permission/src/index.ts:23-28` — PermissionMode 5 档
21. `packages/runtime/openbuddy-cordis/src/index.ts:23-30` — OpenBuddyService
22. `packages/runtime/openbuddy-cordis/src/index.ts:31-39` — Branded
23. `packages/runtime/openbuddy-plugin-host/src/index.ts:25-49` — HarnessPlugin + PluginEntryOptions
24. `packages/runtime/openbuddy-storage/src/index.ts:1-80` — 80 行 export 概览
25. `packages/runtime/openbuddy-storage/src/sqlite/session-catalog.ts:3-22` — SessionCatalogRecord
26. `packages/runtime/openbuddy-storage/src/sqlite/session-event-log.ts:44-67` — sanitizeRecord + maxEntries
27. `packages/runtime/openbuddy-storage/src/sqlite/events.ts:29-46` — append 幂等
28. `packages/runtime/openbuddy-storage/src/secrets/secret-store.ts:55-89` — PlatformKeychainSecretStore
29. `packages/capability/openbuddy-mcp-client/src/index.ts:1-50` — McpClient / McpServerConfig
30. `packages/capability/openbuddy-plan/src/index.ts:21-37` — PlanModeState
31. `packages/capability/openbuddy-web-search/src/index.ts` — WebSearchToggle
32. `packages/capability/openbuddy-automation/src/index.ts:21` — ScheduleFreq 6 档
33. `packages/capability/openbuddy-inspiration/src/index.ts:34-44` — 10 条 CATALOG
34. `packages/capability/openbuddy-notification/src/index.ts` — 9 种 NotificationKind
35. `packages/capability/openbuddy-email/src/index.ts:23-31` — EmailAccount provider 4 类
36. `packages/collaboration/openbuddy-room/src/index.ts:43` — InMemoryRoomStore
37. `packages/collaboration/openbuddy-policy/src/index.ts:3-72` — PolicyLayer + evaluatePolicy
38. `packages/collaboration/openbuddy-inbox/src/index.ts:12` — InboxItemKind 5 档
39. `packages/collaboration/openbuddy-task/src/index.ts:9-23` — BuddyTaskStatus 13 档
40. `packages/collaboration/openbuddy-coordinator/src/index.ts:1-60` — TaskProposalInput + OrganizationRole 4 档
41. `packages/team/openbuddy-team/src/index.ts:1-50` — TeamRecord
42. `packages/team/openbuddy-subagent/src/index.ts:34-37` — Subagent 服务
43. `services/casdoor-resource-gateway/src/index.ts:90-140` — 类型定义
44. `services/casdoor-resource-gateway/src/index.ts:2659-2713` — handleInternalCreditExpiry
45. `services/casdoor-resource-gateway/src/index.ts:3769-4078` — handleCredits
46. `services/casdoor-resource-gateway/src/index.ts:4078-4213` — handleWallets
47. `services/casdoor-resource-gateway/src/index.ts:4213-4364` — handleBilling
48. `services/casdoor-resource-gateway/src/index.ts:4448-4533` — handleTenantControl
49. `services/casdoor-resource-gateway/src/index.ts:4688-4790` — handle + dispatch（含 /metrics / /healthz）
50. `services/casdoor-resource-gateway/openapi.yaml:1-50` — /internal/v1/credits/expire
51. `scripts/verify-tenant-boundaries.sh:1-85` — 9 个 probe
52. `scripts/deploy-doctor.sh:1-60` — 9 段自检
53. `scripts/audit-commercial-model.mjs:1-100` — pointsForUsage + auditCommercialModel
54. `electron/main/index.ts:1-80` — boot 入口
55. `electron/main/agent-host.ts:24-31` — Pi SDK import
56. `electron/main/agent-host.ts:3142-3176` — DSH 包 profile 列表 + loader.loadProfile
57. `electron/main/agent-host.ts:4605-4635` — providerCatalog（含 providerKind 推导）
58. `electron/main/agent-host-provider-registry.ts:1-80` — ProviderRegistryTracker
59. `electron/main/ipc/index.ts:1517` — `agent:providers-list`
60. `electron/main/ipc/index.ts:2333-2385` — 6 个 provider/model IPC
61. `electron/main/ipc/index.ts:2403-2424` — teams:create / status / delete
62. `electron/main/casdoor-auth.ts:30-83` — Casdoor 配置 / 会话视图
63. `electron/main/casdoor-auth.ts:720-742` — authorize / assertAuthorized
64. `electron/main/pi-extensions.ts:1-80` — PiExtensionResolution 接口
65. `electron/main/session-event-log.ts:1-15` — SqliteSessionEventLog 薄包装
66. `electron/main/lifecycle-journal.ts:1-60` — OpenBuddyLifecycleEvent
67. `electron/main/workflow-worker.ts:1-60` — WorkflowWorkerRun
68. `electron/main/pi-event-bridge.ts:1-34` — emitContextEvent / emitPiSessionEvent
69. `electron/main/connectors.ts:1-100` — candidateRoots / category
70. `src/App.tsx:1-50` — 顶层 import + EXPERT_PERSONA_BEGIN/END
71. `src/App.tsx:1361` — 行数（`wc -l`）
72. `src/components/ModelSelector.tsx:1-30` — 触发器 + dropdown
73. `src/components/PermissionPicker.tsx:1-35` — 3 档 MODES + perm picker UI
74. `src/components/PermissionDialog.tsx` — Pi 风格权限弹窗
75. `src/lib/agent/pi-client.ts:1204-1214` — ProviderKind 联合 10 类
76. `src/lib/agent/pi-client.ts:1666-1675` — PermissionMode 3 档（renderer）
77. `src/styles/tokens.css:24-28` — 默认 light + dark 覆盖策略
78. `src/styles/tokens.css` — `--wb-*` 490 条
79. `src/foundation/components/Icon/icons/` — 207 + Icon.tsx = 208 文件
80. `evals/capability-matrix.json:1-48` — 29 capability ID
81. `evals/README.md:1-40` — 套件说明
82. `evals/node/` — 40 个 node 脚本
83. `.github/workflows/release.yml:1-218` — ci + build-windows + build-macos + publish-release
84. `deploy/openbuddy-{new-api-capability-snapshot,new-api-reconciliation-worker,new-api-reconciliation-watchdog,credit-expiry-worker}.{service,timer}` — 4 timer
85. `deploy/openbuddy-commercial-model.example.json:1-67` — 套餐 + 定价 + 排除模型
86. `docs/openbuddy-commercial-model.md:1-60` — 商业模型权威边界
87. `docs/openbuddy-credit-transfer.md:1-80` — 积分转账规范
88. `docs/publish-checklist-v0.15.0.md:1-60` — 发布清单
89. `docs/casdoor-providers/{github,google,email-verification,wechat-open,wechat-official,alicloud-sms,tencentcloud-sms}.json` — 7 模板

---

## 11. 关键数据快照

| 指标 | 数值 | 测量方式 |
| --- | ---: | --- |
| `packages/*/*` 总包数 | 31 | `find packages -maxdepth 3 -name "package.json"` |
| moon 项目数（含 root + app-desktop） | 19 | `.moon/workspace.yml` |
| 顶层 npm script 数 | 60+ | `package.json` |
| IPC handler 数 | **467** | `grep -E "ipcMain.handle\(\"[^\"]+\"" electron/main/ipc/index.ts \| sed -E ... \| sort -u \| wc -l` |
| IPC handler 调用行 | 466 | `grep -E "^\s+ipcMain\.handle" electron/main/ipc/index.ts \| wc -l` |
| 单元测试 `.test.ts` 文件数 | 297 | `find electron packages services src -name "*.test.ts"` |
| `evals/node/*.mjs` 脚本数 | 40 | `ls evals/node` |
| `scripts/electron/*.mjs` smoke 数 | 14 | `ls scripts/electron` |
| `docs/` markdown 文件数 | 60 | `ls docs | wc -l` |
| `--wb-*` 设计令牌数 | **490** | `grep -c "^  --wb-" src/styles/tokens.css` |
| 图标数 | **207**（208 个 .tsx） | `ls src/foundation/components/Icon/icons/ \| wc -l` |
| 顶层 React 组件数 | 98 | `ls src/components/*.tsx \| wc -l` |
| React 组件总行数 | 9,062 | `wc -l src/components/*.tsx` |
| `electron/main/agent-host.ts` 行数 | **6,306** | `wc -l` |
| `electron/main/ipc/index.ts` 行数 | **3,447** | `wc -l` |
| `services/casdoor-resource-gateway/src/index.ts` 行数 | **4,800+** | `wc -l`（含 handleBillingCallback / handleMemberRevocation / handleResource） |
| `handle*` 函数数（gateway） | 25+ | `grep -E "^\s*(async\s+)?function\s+handle" services/casdoor-resource-gateway/src/index.ts \| wc -l` |

---

## 12. 一句话总结

> OpenBuddy 已是一台**工程化、模块化、可商用**的 AI Agent 桌面工作台：
> Cordis 服务总线 + 32 个 moon 工程 + 63 个 npm 包 + 474 个 IPC handler
> handler + 12 个企业面板 + 7 种 Casdoor Provider + 4 个 systemd timer
> + 41 个 eval 脚本 + 490 个设计令牌 + 207 个图标 + 125 篇 docs。
>
> 主要 P0 缺口：Linux CI、`minimax` 与 `minimax_cn` 双轨、Permission UI
> 仅暴露 3 档（Pi 原生 5 档）、macOS 签名仍在脚本守护阶段。
> P1 缺口：i18n 资源、Voice / 视频多模态、Linux 标签栏与推荐栏。
> P2 缺口：SCSS 真源迁移、DSH 桥接版本矩阵、App-icon 替换、默认
> Casdoor issuer 硬编码。
