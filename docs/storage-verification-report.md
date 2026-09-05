# OpenBuddy 存储真实验证报告

验证时间：2026-08-30 · 工作树：`comet/storage-architecture-impl`

## 结论

SQLite-first 存储底座、迁移队列、事件/幂等、恢复、敏感数据边界、主要业务 adapter 和真实 Electron smoke 已通过本地可重复验证。Electron smoke 覆盖 session 生命周期、Pi JSONL shadow import、metadata projection、renderer reload、Electron restart persistence 及主要 capability probes；没有执行真实用户数据迁移、生产用户目录覆盖或第三方 OpenClaw 登录。

## 通过的检查

| 检查 | 结果 | 证据 |
|---|---|---|
| storage package tests + Main bootstrap facade | 通过 | 29 个测试文件、122 个测试通过；新增 `workspace-bootstrap.test.ts`/`collaboration-bootstrap.test.ts`/`__tests__/workspace-bootstrap.test.ts`/`__tests__/collaboration-bootstrap.test.ts` 共 11 个 bootstrap 用例；既有用例仍覆盖 email、workspace、subagent、calendar legacy import、SQLite persistence、重启恢复、兼容镜像、幂等 fixture、多源脱敏 migration、MCP OAuth pending/retry、MCP OAuth SQLite 损坏 fail-closed、FTS、session catalog、backup/restore、Harness cursor、迁移收敛、事务边界、lazy-open/close 生命周期、queued-write flush/backup 一致性、session event persistence failure 可见性、损坏/权限 legacy 文件显式失败、缺失源文件分类、migration issue 持久化/解决、undefined 幂等结果、legacy raw null 兼容、事件 identity 冲突和 content-addressed ObjectStore 并发去重/哈希校验 |
| `storage:metrics-history` 指标历史窗口 | 通过 | `StorageMetricsRegistry.recordSnapshot` 维护 32 长度环形缓冲，`recentStorageMetrics` 暴露最近 N 条；与 `storage:metrics` IPC 一起纳入 |
| `storage:renderer-storage` IPC façade | 通过 | `electron/main/storage/renderer-storage.ts` 提供 4 个 read/list/write/remove 入口；6 个隔离 fixture 测试覆盖 namespace/key 校验、secret-shape 拒绝、version conflict 与 DB 序列化脱敏 |
| `storage:preflight` 只读预检 | 通过 | `pnpm storage:preflight`；基于 `LegacySourcePreflight` 输出脱敏 manifest（status、sha256、recordCount、parseErrors、secretRisk、稳定错误码），由 4 个隔离 fixture 测试覆盖并纳入 `pnpm storage:acceptance` |
| `storage:task-bootstrap` / `storage:automation-bootstrap` Renderer 域 IPC | 通过 | `TaskBootstrapStore` + `AutomationBootstrapStore` 在脱敏 DTO（`openbuddy.storage-task-bootstrap.v1` / `openbuddy.storage-automation-bootstrap.v1`）上对 task content / prompt / error 做 redact envelope；6 个隔离 fixture 测试覆盖 |
| `storage:workspace-bootstrap` Renderer 域 IPC | 通过 | `WorkspaceBootstrapStore` 读取 `WorkspaceCatalog` 并返回脱敏 DTO（`openbuddy.storage-workspace-bootstrap.v1`，无 `sessionIds`、无 `apiKey`/`token`/`password`/`cookie` 等敏感字段）；3 个隔离 fixture 测试覆盖 |
| `storage:collaboration-bootstrap` Renderer 域 IPC | 通过 | `CollaborationBootstrapStore` 返回 `ContractsSnapshot` + `InboxCursorsSnapshot` + `EventsSnapshot` 脱敏 DTO（`openbuddy.storage-collaboration-bootstrap.v1`）；`CollaborationInboxCursorStore.list()` 暴露 cursor 列表；本轮新增 5 个隔离 fixture 测试覆盖 snapshot/stream/event/type cursor/query 字段 |
| `storage:metrics` 驱动脱敏指标 | 通过 | `StorageHealthSnapshot.metrics` 现包含 writes/busy/rollbacks/totalLatencyMs/maxLatencyMs/lastWriteAt/lastBackupAt/migrationIssues；2 个隔离 fixture 测试覆盖 |
| `storage:drill` 发布门禁 | 通过 | `pnpm storage:drill`；在隔离临时目录执行 migration fixture、backup/restore、integrity、重启读取、坏备份拒绝和目标已存在拒绝，共 2 个测试文件、9 个测试 |
| 跨产品存储形态调研（独立文档） | 通过 | `docs/storage-cross-product-survey.md`；逐条引用 Codex `codex-rs/state/src/sqlite.rs`（多 DB、`SqliteJournalMode`、sqlx）、Pi `@earendil-works/pi-session-backend-sqlite-node@0.84.1`（`node:sqlite` + FTS5 + migrations）、Hermes `~/.pi/agent/pi-hermes-memory/sessions.db`（sessions / messages / memories / memory_fts / session_files）、Grok `xai-grok-memory/src/{schema.rs,storage.rs}`（`chunks_fts` FTS5 + `chunks_vec` vec0 + `index.sqlite` + `JournalMode::for_db_path`）、OpenClaw 公开 commit `e5263a88…`（transcript/auth profile/memory lease）、WorkBuddy（本仓库 import JSON+Markdown）、DeepSeek-harness（源码扫描无核心 sqlite）、OpenBuddy 自研 `packages/runtime/openbuddy-storage/`；本地源码引用，不读任何用户运行态 |
| `storage:boundaries` 架构静态门禁 | 通过 | `pnpm storage:boundaries`；扫描 525 个生产/存储源码文件，检查 direct SQLite、内部 storage import、业务层 SQL、Renderer Node/storage 依赖和 storage→UI 反向依赖，0 个违规 |
| source storage inventory | 通过 | `pnpm storage:inventory`；只读 Codex/Pi 文件大小、SQLite pragma 和 `sqlite_master` 表名；Codex 当前发现 2 个新版 `codex*.db`，Pi 发现 OpenBuddy 与 Hermes 两个 WAL 数据库；OpenClaw 显式 skipped |
| collaboration runtime regression | 通过 | 24 个测试；覆盖默认 profile 主库路径、显式 fixture 隔离库、协作 contracts/cursor 落入 profile SQLite、协作事件/审批共享 database path 及现有跨进程/relay 行为 |
| affected integration tests | 通过 | 28 个测试文件、205 个测试通过；包含 core session/session facade、team、web-search、calendar、email、DeepSeek compatibility、MCP/resources、collaboration、跨进程 relay、session event log 和 storage contract |
| workspace typecheck | 通过 | `pnpm exec tsc --noEmit -p tsconfig.json` |
| storage package typecheck | 通过 | `pnpm exec tsc --noEmit -p packages/runtime/openbuddy-storage/tsconfig.json` |
| DeepSeek compatibility | 通过 | `electron/main/deepseek-compat.test.ts`，54 个测试；覆盖 workspace registry 与标准 Harness service graph |
| subagent package typecheck | 通过 | `pnpm exec tsc --noEmit -p packages/team/openbuddy-subagent/tsconfig.json` |
| Electron production build | 通过 | `pnpm exec electron-vite build` |
| real Electron smoke | 通过 | `pnpm test:electron` 通过；真实 Electron + Pi smoke 的 5 个任务全部完成，覆盖 startup bridge、session lifecycle、Pi session metadata projection、renderer reload、Electron restart persistence 及主要 capability probes |
| offline HTML and diff checks | 通过 | CSP 存在、无脚本、无外链、`git diff --check` 通过 |
| full workspace Vitest | 部分通过 | 188 个 suite 中 182 个通过、1738 个测试通过、4 个测试失败、2 个 skipped；3 个 suite 在收集阶段因硬编码不存在的 `zod@4.4.3` 路径失败，另有 3 个既有 collaboration suite 失败 |

## Full Vitest 的已知失败

最新全量测试为 182 个 suite 通过、6 个 suite 文件失败、1738 个测试通过、4 个测试失败、2 个 skipped。3 个 suite 在收集阶段失败，原因都是测试硬编码了不存在的 pnpm 路径 `node_modules/.pnpm/zod@4.4.3`：

- `electron/main/generated-artifact-integration.test.ts`
- `packages/renderer/openbuddy-renderer-host/src/index.test.ts`
- `packages/runtime/openbuddy-plugin-host/src/remote-codec.test.ts`

另有 3 个既有 collaboration suite 含 4 个失败测试：

- `packages/collaboration/openbuddy-coordinator/src/index.test.ts`（2 个）
- `packages/collaboration/openbuddy-network/src/durable-relay.test.ts`（1 个）
- `packages/collaboration/openbuddy-network/src/index.test.ts`（1 个）

这些失败没有触及 `packages/runtime/openbuddy-storage` 或本次受影响业务 adapter；没有修改它们来掩盖环境问题。

## A1–A10 证据矩阵

| 验收项 | 当前证据 | 本地结论 | 独立语义验收 |
|---|---|---|---|
| A1 driver 与安全 SQLite 基础能力 | storage package tests、`storage:drill`、18 张结构化表的 inventory、生产 build | 已实现并通过本地检查 | 待独立 Verifier |
| A2 events/cursors/idempotency/replay | `event-store.test.ts`、`session-event-log.test.ts`、`sync-event-collection.test.ts` | 已实现并通过定向测试 | 待独立 Verifier |
| A3 `openStorage` 与 versioned migration | `migration-fixture.test.ts`、`open-storage.test.ts`、schema v10 inventory | 已实现并通过迁移/恢复演练 | 待独立 Verifier |
| A4 基础 schema、半写入、恢复、脱敏、shadow、dedup | 18 个 storage suite、88 个测试、`storage:drill` | 已实现并通过本地测试 | 待独立 Verifier |
| A5 driver 选型、迁移/回滚文档与离线 HTML | audit Markdown、架构图、HTML CSP/no-script/no-external 检查 | 已完成文档与离线产物 | 待独立 Verifier |
| A6 package 模块边界、Main façade 无重复存储 | package exports、Main imports、workspace typecheck、Electron build、`storage:boundaries`、Renderer Gateway concurrency contract | 已实现并通过本地检查 | 待独立 Verifier |
| A7 Vitest/tsc/build/diff gate | storage 定向测试、类型检查、Electron build、diff check；全量有既有失败 | 受无关既有测试/环境路径限制 | 待独立 Verifier |
| A8 HTML 离线结构与关键词安全 | CSP、无 `<script>`、无外链、敏感边界检查 | 已通过 | 待独立 Verifier |
| A9 SQLite-first 域与原始协议/secret 边界 | Electron smoke、source inventory、session/team/web-search/storage tests、统一 platform secret provider selection | 已实现并通过本地检查 | 待独立 Verifier |
| A10 针对性检查与 OpenClaw not-run | `storage:drill`、inventory、Electron smoke；OpenClaw 明确 skipped | 已通过本地范围检查 | OpenClaw 运行态保持 not-run |

Comet Native 当前未能启动独立只读 semantic Verifier，因此 Runtime 将 A1–A10 保持 pending/blocked；以上“已实现”只表示本地可复现证据，不冒充独立验收通过。

## 真实覆盖范围

- SQLite：WAL/rollback、`busy_timeout`、foreign keys、参数化语句、显式事务、完整性/FK 检查。
- 生产诊断：`StorageHealthSnapshot` 只返回 journal、synchronous、FK、busy timeout、schema/event 计数、队列深度和完整性结果，不暴露路径、secret 或底层 `DatabaseSync`。
- 写入一致性：catalog、event、memory/FTS、settings、MCP、notifications、automation、approval、session/team、Harness cursor 和同步事件集合的多语句写入统一经过 driver transaction/queue；legacy settings/event/team、settings document、automation 和 team catalog 导入均先读取源文件，再以单事务提交；同步写入在异步队列存在时 fail-closed；Electron Main session metadata 只调用 canonical service，不再有重复 JSON 写入 fallback。
- 迁移：versioned `schema_meta`、失败记录、半写入回滚、重启重试、同一 profile 并发首次打开收敛。
- Harness/协作状态：schema v6 将 Harness cursor 持久化到 `harness_session_cursors`，将 task contracts/inbox cursor 持久化到 `collaboration_task_contracts`/`collaboration_inbox_cursors`；旧 JSON 只做一次性导入并继续镜像，敏感 resume token 仍保持文件边界。
- Email capability：schema v7 将 drafts、audit、sender policies、shares、reminders、projects、tags、thread tags、scheduled sends、pending sends 持久化到 `email_state_records`；`openbuddy-email.json` 只做一次性导入和 `0600` 兼容镜像，provider 远程线程/附件和凭据不进入本地状态。
- DeepSeek workspace/subagent：schema v8 将 workspace 顺序、路径、标题、session 归属、archived session 与 subagent config 持久化到 `workspace_catalog`、`workspace_archived_sessions` 和 versioned `settings` namespace；`dsh-workspaces.json`、`settings.json.subagents` 只做一次性导入和 `0600` 兼容镜像。
- Calendar：schema v9 将事件、时间范围、room/context filter、attendees 和 legacy import marker 持久化到 `calendar_events`/`calendar_state_meta`；`openbuddy-calendar.json` 只做一次性导入和 `0600` 兼容镜像，重启后 SQLite 仍为权威。
- Task compatibility：schema v10 为已有 profile 前向补齐 `session_task_snapshots`，避免旧数据库已记录 v3 迁移但缺少后续快照表时出现运行时 `no such table`；Pi `todo/write` 仍是任务权威源，SQLite 保存可重建 projection。
- Web search：非敏感 provider/model/host policy 使用 SQLite `settings` projection；`web-search.json` 仅作 legacy import/兼容镜像。API key 不写入 SQLite；已有 legacy key 只读兼容，生产接入应通过 Keychain/SecretStore 或环境变量。
- DeepSeek credentials：生产使用 OS Keychain/显式 SecretStore，测试使用 ephemeral provider；`dsh-credentials.json` 只读兼容和一次性迁移源，provider 不可用时新增/修改/删除 fail-closed，避免回退新增明文 secret。
- MCP OAuth：`McpAuthStore` 将状态写入 SQLite `settings` namespace，将 access/refresh token 写入 SecretStore；旧 `mcp-auth.json` 只做一次性迁移并被替换为脱敏状态镜像，测试已验证普通文件和 SQLite 不包含 token。
- Plan/Harness cache/spill：Plan custom session entry 仍由 Pi JSONL 权威；Harness RPC completed-request cache、resume token、relay outbox 和 subprocess spill 保持 transport/cache 文件边界，不为“SQLite-first”强行迁移。
- 事件：append-only event、稳定 stream sequence、consumer cursor、幂等结果、replay/rebuild、跨 adapter file lock。
- 数据域：session catalog、session event log、collaboration events/contracts/cursors、DeepSeek workspace catalog、subagent settings、teams、settings、tasks、automations、notifications、approvals、email state、memory FTS、MCP 非敏感 registry；renderer 临时状态仍是 localStorage 边界。协作生产默认与其它 profile domain 共用 `openbuddy.sqlite`，JSONL/游标/contract 仅保留兼容镜像，relay outbox 保持 transport 文件边界。
- 安全边界：credential value 不进 SQLite；MCP URL/userinfo/query secret 和嵌套 secret 字段脱敏；Pi transcript、Markdown、ObjectStore、Keychain 保留权威边界。
- 跨项目只读盘点：Codex 源码定义 6 个逻辑 SQLite runtime DB；当前本机 `~/.codex/sqlite` 实际发现 `codex.db` 与 `codex-dev.db` 两个新版数据库，均为 `journal_mode=delete`、foreign keys 开启，表名包含 `local_thread_catalog`、`thread_timeline_ledger`、`automations` 和 `inbox_items`。Pi OpenBuddy 主库与 Hermes memory 均为 WAL SQLite；Hermes 表名覆盖 sessions/messages/memories/session_files 与 FTS5。Grok 源码明确 `xai-grok-memory` 使用 SQLite chunks/FTS5 和可选 sqlite-vec，并保留 Markdown memory source。OpenClaw 公开源码 commit `e5263a88…` 明确 Agent transcript/session search 使用 SQLite `transcript_events` 与 FTS 投影，auth profile 与 memory lease 也使用 SQLite；本机 `~/.openclaw` 运行态仍未读取。OpenBuddy 历史盘点发现两个数据库，现已通过路径解析回归将生产默认收敛为一个 profile 主库。盘点只读取文件大小、pragma 和表名，不读取正文、prompt、token 或凭据。
- 可复现命令：`pnpm storage:inventory`；输出协议为 `openbuddy.storage-source-inventory.v1`，显式将 OpenClaw 运行态标记为 skipped/unknown/not-run；公开源码证据单独固定 commit，不读取用户运行目录。
- Renderer 项目状态：继续使用既有 `localStorage` 可重建镜像；本 change 不新增 renderer IPC/DTO，`RendererStorageGateway` 仅保留 package seam，未接入 renderer。
- 恢复：backup integrity、损坏 backup 拒绝、仅发布到不存在的新目标路径。
- 端到端 fixture：在临时目录模拟 Pi JSONL、legacy settings/events/teams/Markdown，导入同一 profile，重复导入验证幂等，确认 secret 脱敏、FTS/session projection，再执行 backup/restore/integrity、重启重读、坏备份拒绝和目标已存在拒绝；未读取或修改真实用户文件。
- 迁移问题：`MigrationIssueStore` 将兼容写失败持久化到 `migration_issues`，支持未解决列表、显式 resolve 和与 `DurableOperationStore` 的重试编排；不把异常吞成空状态。

## 未宣称的证据

- 本机存在 `~/.openclaw`，但按 A10 约束未读取运行状态、数据库或凭据；OpenClaw 运行态保持 `unknown/not-run`。公开仓库 commit `e5263a88…` 的模块源码已单独证明 SQLite transcript/FTS、auth profile 和 memory lease 边界，不把它当成本机运行态证据。
- WorkBuddy 本机盘点：`WorkBuddyExtension` 与 `WorkBuddy` 检查范围内未发现 `.sqlite`/`.sqlite3`/`.db` 文件，分别以 JSON 扩展缓存、Markdown/JSON 工作目录产物为主；这不是对完整 WorkBuddy 产品实现的断言。
- 没有执行真实用户目录迁移、真实生产用户路径覆盖或删除用户文件；独立 Comet semantic Verifier 当前不可用，因此本报告只声明可复现的 Runtime/本地验证，不声明独立语义验收。
- 当前平台无法启动独立只读 Comet semantic Verifier；本报告不把 Builder handoff 或本地测试冒充独立语义验收。
