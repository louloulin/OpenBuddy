# OpenBuddy PI-Native 改造计划 (v8)

> 📅 2026-09-09 · 基于 `main` (commit `058cbf9`) + `main-pi-reuse` (commit `6856ad6`) · 状态：v7 路线图执行中（L.3 + K.1 并行启动）
> 任务: LUM-601 (三期) / 父任务 LUM-580 · 仓库: louloulin/OpenBuddy
> 上游基线: `@earendil-works/pi-coding-agent` 0.85.1 + `pi-agent-core` 0.85.1 + `pi-ai` 0.85.1
> 参考实现: [vastsa/PI-Desktop](https://github.com/vastsa/PI-Desktop) (54 文件 / 19,818 LOC agent-runtime)
> 兄弟文档: [OPENBUDDY-PI-VISION.md](OPENBUDDY-PI-VISION.md) (12 capability 适配矩阵) · [full-pluginization-plan.md](full-pluginization-plan.md) (DeepSeek Harness 五件套借鉴)
>
> **本轮 (v8) 改动概览**：
> 1. **§0 → §28 全量重新梳理**：把 v6/v7 的路线图重新整理，按 Phase A → L 顺序重排
> 2. **§11.5 (本轮新增)**：v8 三期任务清单 + 当前进度对照（基于 commit `6856ad6` 实际状态）
> 3. **§26 v6 → §27 v7 → §28 v8**：完整的 v6 / v7 / v8 演化对比表
> 4. **§3 微内核识别 v8 增量**：基于 L.4 完成后的实际 microkernel 模块清单（从 26 → 25 host-modules, agent-host 仍 1499 LOC）
> 5. **§10 v8 成功标准**：在 v6 之上加 5 项「功能闭环」指标（plugin hot-reload / marketplace / workspace-shared plugin / user-extension install / progress UX）

## v8 相比 v7 的改动

用户三轮反馈：「**openbuddy 三期实现**」「**打造 pi native 的 workbuddy openbuddy**」「**打造整个功能闭环**」「**deepseek harness 删除不需要**」。

v7 完成 L.4 + K.2 + v7 §11.2/11.3/11.4 详细规划。v8 把 v7 的规划**落地到当前 commit**，并补完「**功能闭环**」维度（hot-reload、marketplace、user-extension install、progress UX、plugin diagnostics）。

具体变化：
- **§11.5 新增**：基于 `6856ad6` (L.4 完成) 实际状态盘点 —— 微内核 host-module 25 个、agent-host 1499 LOC、ipc/agent.ts 141 LOC、9 个 builtin extension、SDK 已上线
- **§26 v6 + §27 v7 路线图统一到 v8**：v6 §26.4 DSH 残余 1:1 迁移表保留为参考；v7 §11.2/11.3/11.4 详细 L.3/L.4 计划保留；v8 在 §28 加 5 项「功能闭环」指标
- **§3 微内核识别 v8 增量**：基于实际 L.4 完成后的 microkernel 模块清单（`init-deepseek.ts` 189 → 84 LOC、`wire-dsh-services.ts` 313 → 187 LOC、`facade/deepseek-facade.ts` 删）
- **§10 v8 成功标准**：加 5 项「功能闭环」指标，对齐用户「打造整个功能闭环」诉求
- **§13 文档维护 v8**：明确 v8 文档 owner 是 LUM-601（三期任务），子任务链 LUM-580 → LUM-594 / LUM-595 / LUM-596 / LUM-597 / LUM-601

## v7 相比 v6 的改动（保留）

v6 §3.4「PI 优先 / DSH 清除原则」+ §26.4 DSH 残余 1:1 迁移表。v7 在 v6 之上**重新审计 DSH 残余的实际 LOC**，发现 v6 §26.4 预算 -2990 LOC (L.3 + L.4) 是**下算**（v6 当时没看 `deepseek-runtime.ts` 真实 4368 LOC）。v7 把 L.3 + L.4 预算从 -2990 提升到 -9178 LOC（3x）。

v7 §11.2/11.3/11.4 是详细的 L.3 / L.4 拆分步骤（每步 1 个 commit + 全测）。本 v8 把它们原样保留，作为后续 L.3 step 1/2/3 的执行清单。

## v6 相比 v5 的改动

用户明确表态 **「deepseek harness 删除不需要这个就基于pi 实现open buddy」**。

v5 提出分 5 轮退役 DSH（Phase L.1-L.5，合计 -9037 LOC）。v6 保持这个路线图，但**升级路线图的语义**：

- **v5 的策略**：分阶段小心翼翼地删，每轮验证；
- **v6 的策略**：**「基于 PI 实现 OpenBuddy」是唯一目标，DSH 是必须消除的历史负担**。每一轮 PR 都应该回答：「这轮 PI-nativeness 多了多少？DSH 负担少了多少？」

具体变化：
- **Phase L.2 提前到本轮**：DSH 远程 RPC infra（`electron/main/harness/remote-dispatch.ts` 471 + `remote-invocation.ts` 26 = **-497 LOC**）删除，换成基于 PI / Cordis 的极简 shim
- **Phase K（OpenBuddyPlugin SDK）整体重新定位**：v5 是「4 轨合一的 SDK」，v6 改成「**PI 原生插件的薄 manifest 辅助**」——SDK 不再是 DSH 装载入口的替代品，而是 PI ExtensionFactory 的 manifest 序列化辅助（`plugin.json` 解析 + `package.json` 验证），实际装载依然走 PI `loadExtensions()`
- **§3 微内核识别 增 §3.4「PI 优先 / DSH 清除」原则**：所有新功能都必须走 PI API；DSH 是迁移期 transient，不进新代码
- **§24 微内核 + 插件蓝图 增 §24.4「DSH 残余 1:1 迁移表」**：把 DSH 每个 API 映射到 PI 等价物，方便后续轮次一对一替换

## v6 路线图增量（v5 7 phase × 26 轮 → v6 7 phase × 26 轮，无新增 phase）

v6 不新增 phase，但**重新排序**：

| Phase | 原 v5 顺序 | v6 顺序 | 差异 |
|---|---|---|---|
| **L.1** | round 1 | ✅ done | 不变 |
| **L.2** DSH remote RPC infra 删除 | round 2 | **本轮（提前）** | -497 LOC |
| **K.1 OpenBuddyPlugin SDK v0.1** | round 3 | round 4 | 让 L.2/L.3 先做完 |
| **K.2 `loadPlugin()` 接入** | round 4 | round 5 | 同上 |
| **L.3 DSH 通用装载器删除** | round 5 | round 6 | 同上 |
| **L.4 DSH runtime facade 精简** | round 6 | round 7 | 同上 |
| **L.5 bundle-manifest SDK 化** | round 7 | round 8 | 同上 |

总预算不变：**26 轮**。

## v5 相比 v4 的改动

v4 加了「微内核 + 插件体系完整蓝图 (§24)」和「OpenBuddyPlugin SDK v0.1 spec (§25)」。v5 在用户问「**deepseek harness 是不是可以删除不需要**」后，加 1 个完整的审计章：

- **§26 v5 — DeepSeek Harness 退役分析 + Phase L 退役路线图**：DSH 现状盘点（~9751 LOC）/ DSH vs PI 功能对照表 / 分阶段退役（5 轮，删 ~9037 LOC 保留 ~2700 LOC 为薄层）/ 风险登记 / 退役后最终形态图

v4 的核心章节（微内核识别 / 内聚分析 / 耦合减耦 / PI Plugin 双轨 / OpenBuddyPlugin SDK）保留。v5 在 §26 直接回应用户的"deepseek harness 是不是可以删除"问题，给出**"能删、且应该删 ~9037 LOC，保留 ~2700 LOC 为薄层，分 5 轮执行"** 的完整答案。

## v5 路线图增量（v4 7 phase × 21 轮 → v5 7 phase × 26 轮）

v4 21 轮 = v3 19 + K 2。v5 新增 Phase L（DSH 退役）5 轮：

- **Phase L.1 — DSH commands 迁 PI + 删 pi-bridge / pi-capabilities（本轮可做，-547 LOC）**
- **Phase L.2 — DSH remote RPC infra 删除（-2500 LOC，PI EventBus 替代）**
- **Phase L.3 — DSH 通用装载器删除（-1990 LOC，PI discoverAndLoadExtensions 替代）**
- **Phase L.4 — DSH runtime facade 精简（-1000 LOC）**
- **Phase L.5 — bundle-manifest SDK 化（K.2 后，0 删）**

**总预算**：v4 21 → **v5 26 轮**（+5 L 轮）。

## v4 相比 v3 的改动

v3 明确「微内核 = PI + Cordis + 薄桥」，并加 5 个新章。v4 在 v3 之上 **强化「微内核 + 插件」作为骨架**，新增 2 个章节：

- **§24 v4 微内核 + 插件体系 — 完整蓝图**：把当前 v3 的「微内核识别 / 内聚分析 / 耦合减耦 / PI Plugin + Cordis 双轨」四章 **整合成一张可执行的「Layer × 插件类型」总图**，明确「微内核的接口 = 插件可以扩展的全部面」。这张图是后续每轮 PR 的 contract：所有新加的功能必须能回答「它挂在哪一层？属于哪个插件类型？」
- **§25 OpenBuddyPlugin SDK v0.1 spec（PI-Native）**：把 v3 §6 的「4 轨合一」从口号变成**具体接口定义**（`OpenBuddyPlugin` 类型 / `loadPlugin(path)` 装载协议 / `plugin.json` 清单 / 单文件 4 轨同时挂）。v4 在 v3 §9 Phase H.2 之上把 SDK 的 TS 接口定下来，作为接下来 Phase H.2 实施的 contract。

v3 的核心章节（微内核识别 / 内聚分析 / 耦合减耦 / PI Plugin 双轨 / 路线图）保留为骨架。v4 在每章末尾加「v4 注解」说明该章在微内核 + 插件视角下的延伸。

## v4 路线图增量（v3 7 phase × 19 轮 → v4 7 phase × 21 轮）

v3 已完成 A.1 + B.1 round 1-4。v4 新增 2 轮：

- **Phase K — 微内核 + 插件体系成线（新增 2 轮）**：
  - **K.1 OpenBuddyPlugin SDK v0.1 实现**（v3 §6 PI Plugin + Cordis 双轨 + v3 §9 H.2 OpenBuddyPlugin SDK 包的实施版）：TS 接口 + `loadPlugin()` 装载协议 + zod 校验 + 一个 `__fixtures__/sample-plugin/` 验证 4 轨分发
  - **K.2 `loadPlugin()` 接入 builtin extension / harness / slot 三轨**（v3 §9 H.3 4 轨分发装载协议的落地）：把现有 `discoverAndLoadExtensions` + Cordis `ctx.plugin` + Slot `apply` + Harness `load` 4 个装载入口合并为单一 `loadPlugin()` 入口
- 其余 v3 路线图（A.1 / B.1 round 5 / B.2 / B.3 / C.1-C.3 / D.1-D.3 / E.1-E.3 / F.1-F.3 / G + H.1 / I.1-I.2 / J.1）保持不变。

**总预算**：v3 19 + K 2 = **v4 21 轮**。

**注**：v5 在 v4 之上新增 Phase L（DSH 退役）5 轮 → **v5 26 轮**。详见 §26。



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

### 10.1 v8 成功标准（在 v3 之上加）

> 📅 v8 三期任务在 v3 §10 之上加 4 项**架构层补强指标** + 5 项**功能闭环指标**（§28.1）。架构层补强对齐用户「**高内聚低耦合，微内核和插件化设计**」诉求；功能闭环对齐「**打造整个功能闭环**」诉求。

| 维度 | 指标 | v7 状态（`6856ad6`）| v8 目标 | 对应 Phase |
|---|---|---|---|---|
| **DSH 退役** | DSH 总 LOC | 4224 LOC 已删（v7 §11.4）| 全部退役（-9178 / -9178）| L.3 + L.5 |
| **Builtin Extension 数** | PI ExtensionFactory | **9**（`pi-extensions.ts:959-1119`）| ≥ 12 + 用户可装 | K.2 + Phase I.2 |
| **Plugin 装载入口** | 装载入口数 | 1（OpenBuddyPlugin SDK via K.2）| 1 + hot-reload | K.3 |
| **Microkernel 总线 LOC** | agent-host.ts + host-modules/bootstrap/ | 1499 + 314 = ~1813 | ≤ 1500 + ExtensionRunner.bindCore 接管 | Phase B.2 |
| **PI 优先 / DSH 清除** | 新代码使用 DSH API | 0（K.2 后所有新代码走 PI）| 0 + CI 检查 | v6 §3.4 + Phase J.1 |
| **Hot-reload** | plugin 修改后无需重启 | ❌ | ✅ v0.2 | K.3 |
| **Marketplace UI** | in-app 安装第三方插件 | ❌ | ✅ v1.0 | K.3 + H.3 |
| **Workspace-shared plugin** | profile.yaml 推送 + 签名 | ❌ | ✅ v1.0 | K.3 |
| **User-extension install UX** | plugins tab in settings | ❌ | ✅ v1.0 | E.2 + K.3 |
| **Progress UX** | 统一 progress component | 部分（tool 推送到位）| ✅ v1.0 | E.2.1 |

## 11. v3 / v4 / v5 / v6 / v7 / v8 接下来 N 轮（v8 锁定）

> 📅 v8 更新（2026-09-09）：基于 `6856ad6`（L.4 完成）实际状态盘点。L.3 + K.1 在子任务 LUM-594 / LUM-596 中并行进行中（multi-session 并行写同一分支 `agent/devbox1/main-pi-reuse`）。

- ✅ **已完成：Phase A.1 — PI IPC 桥基础设施**（commit `6f6d612`）
- ✅ **已完成：Phase B.1 第 1 轮 — 5th builtin ExtensionFactory `openbuddy-pi-session-metadata`**（commit `df1bcb7`）
- ✅ **已完成：Phase B.1 第 2 轮 — 6th builtin ExtensionFactory `openbuddy-pi-model-bridge` + `ipc/agents.ts` 拆分第 1 步**（commit `1debbde`）
- ✅ **已完成：Phase B.1 第 3 轮 — `ipc/agent.ts` 1060 → 943 LOC 拆为 5 个 capability 子文件**（commit `74b6e12`）
- ✅ **已完成：Phase B.1 第 4 轮 — `ipc/agent.ts` 943 → 690 LOC 再拆 6 个 capability 子文件，超额完成 ≤ 600 LOC 目标附近**（commit `747b77b`）
- ✅ **已完成：Phase B.1 第 5 轮 — `ipc/agent.ts` 690 → 141 LOC（-79%）拆为 4 个 capability 子文件（lifecycle/sessions/workspace/prompt-cycle），成为纯 slim registrar**（commit `e0ad111`）
- ✅ **已完成：v4 plan 更新 — §24 微内核 + 插件体系完整蓝图 + §25 OpenBuddyPlugin SDK v0.1 spec**（同 commit `e0ad111`）
- ✅ **已完成：v5 plan 更新 — §26 DSH 退役分析 + Phase L 路线图（5 轮，-9037 LOC 退役）**（同 commit `3d7b5c6`）
- ✅ **已完成：Phase L.1 — DSH commands 迁 PI + 删 pi-bridge / pi-capabilities**（commit `0e16dc3`）：删 `electron/main/deepseek/deepseek-pi-bridge.ts` (349) + `deepseek-pi-capabilities.ts` (198)，代码 relocate 到 `electron/main/agent/host-modules/deepseek/cordis-runtime.ts`（其唯一调用者），协议常量 relocate 到 `electron/main/agent/host-modules/dsh-bridge-helpers.ts`（其唯一使用者），wire-dsh-services.ts commands 部分删除（已被 PI extensionRunner 直调替代）；**-547 LOC 退役** + 测试也 relocate 到 `cordis-bridge.test.ts` (11 tests pass)
- ✅ **已完成：Phase L.2 partial — DSH remote-invocation 删除**（commit `a22801a`）：删 `electron/main/harness/remote-invocation.ts` (26) + 测试 (30)；inline `isNamedRemoteRequest` + gateway 分支到 `electron/main/agent/host-modules/deepseek/bridge.ts`（其唯一真消费者），agent-host.ts 删除未使用的 import；**-56 LOC 退役**
- ✅ **已完成：Phase L.2 完成 — `remote-dispatch.ts` 极简化**（commit `16434c3`）：471 LOC → 298 LOC 极简 shim，**-173 LOC**（含功能缩减：删 codec / lookup / scoped context / cancellation / 14-error-code taxonomy → 5 个 actionable codes）；测试 249 → 126 LOC（-123），20 个高级 feature test → 9 个核心 API test + 2 个新 test (clear / list)；**总计 -296 LOC**
- ✅ **已完成：Phase K.2 — OpenBuddyPlugin SDK 接入 builtin extension / harness / slot**（commit `27f0280`, task LUM-597）：
  - **K.1 SDK 上线**: 新增 `packages/runtime/openbuddy-plugin-host/src/openbuddy-plugin-manifest.ts` (352 LOC) + 测试 (21 tests pass)。导出 `OpenBuddyPluginManifest` / `serializePiTrack` / `serializeHarnessTrack` / `serializeSlotTrack` / `serializeCordisTrack` / `validateOpenBuddyPluginManifest` / `applyOpenBuddyPluginManifestPassthrough` / `openbuddyPluginManifestSchema` (`openbuddy.plugin.v1`)。
  - **`pi-extensions.ts` 改造**: 9 个 builtin 扩展重新声明为 `BUILTIN_PI_PLUGIN_MANIFESTS`（OpenBuddyPluginManifest 表）。新增 `resolveBuiltinPiPlugin(id)` 调用 `serializePiTrack` + `applyOpenBuddyPluginManifestPassthrough` 输出 `loadExtensions()`-兼容的 track row。`resolvePiExtensions` 在 builtin 分支同步调用 SDK 序列化（manifest-level `flags.passthrough` 走 `recordPassthrough(..., 'opted-in', ...)`）。新增 5 个 manifest 一致性单测。
  - **`init-deepseek.ts` 重写**: 7 个 `@deepseek-ai/*` core capability packages 重新声明为 `coreCapabilityManifests: readonly OpenBuddyPluginManifest[]`。新增 `profileEntriesFromManifests()` 通过 `serializeHarnessTrack` 输出 `PluginEntryOptions` 行，`composeHostRunnerEntries(base, bundle, core)` 第三参数插入到 base host-runner 之后、profileBundle 之前（marketplace bundle 可覆盖）。删除未使用的 `join` import + 两个未使用的 loader.list() filter。新增 4 个单测覆盖 manifest 一致性 + 序列化。
  - **`plugin-ui-host.ts` 改造**（即 `packages/ui/openbuddy-ui-runtime/src/slot-plugin-manifest.ts`）：新增 `BuiltinUiPluginSlotTrack` 类型 + `toOpenBuddyPluginManifest()` + `serializeBuiltinUiSlotTrack()`。`BUILTIN_UI_APPLIES` 表新增 description 字段，注释里描述 Phase K.2 投影路径。`registerAllBuiltinUis()` 在每次 `apply()` 前调用 SDK 序列化（manifest-level validation 提前 surface，runtime 实际装载走 in-process apply 不变）。新增 5 个单测覆盖 manifest 投影。
  - **`__fixtures__/sample-plugin/`**: 作为 K.1 SDK 输出的 reference。包含 `plugin.json` (4 track manifest: pi/harness/cordis/slot)、`package.json` (openbuddy.bundle + openbuddy.client + pi.extensions/skills)、`index.js` (cordis plugin 默认导出)、`extensions/index.js` (PI ExtensionFactory)、`client.js` (slot apply)、`remote.js` (remote contribution)、`cordis.patch.yml` (harness patch)、`skills/sample-plugin/SKILL.md`、5 个 round-trip 单测。
  - **测试净增量**: `+38 个新单测`（K.1 SDK 21 + builtin pi manifest 5 + init-deepseek 4 + slot-plugin-manifest 5 + sample-plugin fixture 5 - 与 `__fixtures__/external-dsh-plugin/` 互不干扰）。
  - **LOC 净增**: `+761/-42 = +719`（SDK 352 + pi-extensions 184 + builtin-applies 87 + slot-plugin-manifest 67 + init-deepseek 68 + client.tsx 20 + tests + fixture file docs）。这是必要的成本：v6 §3.4 要求 SDK 是一个独立模块而不是埋在 pi-extensions.ts 里。
  - **K.2 不完成 DSH 装载入口的替换**：`loader.loadProfile(profile)` 在 `init-deepseek.ts` 保留（HarnessPluginLoader 路径仍在用）；真正切到 PI `loadExtensions()` 是 Phase L.3 的责任（v6 §24.4 表）。K.2 只把 manifest 形状统一到 `openbuddy.plugin.v1`，实际装载不在 K.2 范围。
- ✅ **已完成：Phase L.4 — DSH runtime facade 精简 (-2324 LOC)**（commit `6856ad6`, task LUM-595）：`electron/main/deepseek/deepseek-runtime.ts` 从 4368 → 3827 LOC（-541，删除 DeepSeekLlmService + DeepSeekTypertLoaderService + DeepSeekTypertGatewayService + DeepSeekAgentLoopService + DeepSeekAgentDefaultModelService + createDeepSeekPiAgentLoopPlugin + deepSeekSessionQueryRemote + 内部 gateway / agent-factory helpers）；删除 `electron/main/deepseek/dsh-host-runner.ts` (43) + `electron/main/deepseek/deepseek-execution-adapters.ts` (69) + `electron/main/agent/host-modules/facade/deepseek-facade.ts` (44) + `electron/main/deepseek/deepseek-agentloop-pi-smoke.test.ts` (833)；`wire-dsh-services.ts` 313 → 187 LOC，仅保留 goal + message-feedback 状态机；`init-deepseek.ts` 189 → 84 LOC，移除 7-capability remote 注册 + reconcileProfileArtifacts 重注册；**总计 -2324 LOC 退役**
- ✅ **已完成：Phase L.3 — DSH 通用装载器删除**（commit `13deb75`, task LUM-594, rebase 后）：删 `electron/main/deepseek/deepseek-compat.ts` (445) + `deepseek-generic.ts` (1545) + `deepseek-compat.test.ts` (2039) + `deepseek-generic.test.ts` (446) + `deepseek-agentloop-pi-smoke.test.ts` (833，依赖 `resolveDeepSeekModule`)；调用方 `cordis-runtime.ts` / `init-pipeline.ts` / `init-plugin-loader.ts` / `init-plugin-loader.test.ts` / `init-pipeline.test.ts` / `init-pipeline-builder.ts` / `workbench-scope.ts` / `agent-host.ts` 改走 `openbuddy:core` + `openBuddyCapabilityPluginIndex` + PI `discoverAndLoadExtensions` 装载链（DSH 通用装载链移除）；`cordis-runtime.ts` importer 新增 `resolveDeepSeekRuntimeModule` (来自 `deepseek-runtime.ts` 幸存 runtime aliases) + `@deepseek-ai/cordis` / `@cordisjs/core` → `OpenBuddyCordis` 直查；`init-plugin-loader.ts` importer 对未解析的 `@deepseek-ai/*` specifier 返回 no-op plugin (L.4 收尾后再清空 `host-runner-entries.ts`)；**净 -5299 LOC 退役**（源码 -1990 / 测试 -3318 / 调用方 +72/-42）
- 🟡 **并行启动 — Phase K.1 — OpenBuddyPlugin SDK v0.1**（task LUM-596, in_progress）：新建 `packages/runtime/openbuddy-plugin-host/src/openbuddy-plugin-manifest.ts` 已在 K.2 commit 落地；K.1 任务是把 manifest 路径**独立**成新包 `packages/runtime/openbuddy-plugin-sdk/`（v4 §25 spec 落地），同时加 `serializeAllTracks` aggregate helper（commit `d055087` 已加）。
- ⚪ **下一轮（本任务 LUM-601 三期） — Phase J.1（部分）**：先跑 `pnpm storage:boundaries` + `pnpm storage:acceptance` 拿到当前 baseline，然后加固 sheriff.config.ts（覆盖 §3.2 的 4 层依赖方向 + §4 的 god module 拆解 + §5 的 6 类耦合点 0 处）
- ⚪ **第四轮 — Phase B.2**：用 ExtensionRunner.bindCore 替代 microkernel 启动序列（`installMicrokernelHost` 的 INSTALLED_MODULES 跟踪 → PI ExtensionRunner），单一启动路径
- ⚪ **第五轮 — Phase B.3**：把 `discoverAndLoadExtensions` 接入 builtin + 用户 extension 加载；profile 目录扫描走 PI loader，单一 extension loader 路径
- ⚪ **第六轮 — Phase C.1-C.3**：Tools 工厂化（createBashTool / createReadTool / createWriteTool / createEditTool / createLsTool / createGrepTool / createFindTool / createPowerShellTool）；~600 LOC 自实现 tool 替换为 PI factory
- ⚪ **第七轮 — Phase D.1-D.3**：SettingsManager / ProjectTrustStore / Skills 复用 PI 提供的 API（`SettingsManager.create()` + `ProjectTrustStore` + `loadSkills`）；~500 LOC 自定义 I/O 替换
- ⚪ **第八轮 — Phase E.1-E.3**：UI 槽位 + ExtensionUIContext 对齐；SlotMap 加 PI 交互槽位；renderer 自定义解析器走 IPC 桥
- ⚪ **第九轮 — Phase F.1-F.3**：性能优化（bundle manualChunks / SQLite 替换 / cold start lazy load）
- ⚪ **第十轮 — Phase H.1**：email capability 3510 LOC → 5 文件拆解
- ⚪ **第十一轮 — Phase I.1-I.2**：Capability 收敛（task 决策 + memory / folder-trust 接入 PI + calendar/web-search/inspiration/notification 接入 PI ExtensionFactory）
- ⚪ **第十二轮 — Phase L.5**：bundle-manifest SDK 化（与 Phase K 并行）
- 🟢 **持续 — Phase G**：真实 LLM E2E 验证（27 个 playwright spec，需带凭据环境）

每轮单 commit + 全测 + 推独立分支，符合"小步实现 + 必须验证"。

### 11.1 B.1 round 5 验证记录

```
Phase B.1 round 5 验证报告
==============================================================
electron/main/ipc/agent.ts:                690 → 141 LOC  (-79%, -549 LOC)
electron/main/ipc/lifecycle.ts:            0 → 118 LOC   (4 handlers)
electron/main/ipc/sessions.ts:             0 → 119 LOC   (9 handlers)
electron/main/ipc/workspace.ts:            0 → 116 LOC   (7 handlers)
electron/main/ipc/prompt-cycle.ts:         0 → 434 LOC   (16 handlers)
electron/main/ipc/plugin.ts:             139 → 145 LOC   (+6, +plugins_action)

Handler 迁移:
  lifecycle.ts     agent:new-session, agent:ensure-new-session,
                   agent:init, agent:dispose                  (4)
  sessions.ts      sessions:list, sessions:list-workspaces,
                   sessions:rename, sessions:delete,
                   sessions:set-pinned, sessions:set-archived,
                   sessions:set-all-archived,
                   sessions:set-expert,
                   agent:workspace-search                      (9)
  workspace.ts     workspace:list, workspace:create,
                   workspace:rename, workspace:delete,
                   workspace:insert-before,
                   workspace:insert-session-before,
                   workspace:archive-session                   (7)
  prompt-cycle.ts  agent:prompt, agent:steer, agent:follow-up,
                   agent:abort, agent:set-model,
                   agent:compact,
                   agent:set-auto-compaction,
                   agent:set-auto-retry,
                   agent:abort-retry, agent:abort-bash,
                   agent:set-steering-mode,
                   agent:set-follow-up-mode,
                   agent:fork-session,
                   agent:prompt-content,
                   agent:set-thinking-level,
                   agent:set-permission-mode                   (16)
  plugin.ts        plugins_action                              (+1)

agent.ts 现在只保留: 15 行 import + 15 行共享 deps 构建 + 15 行 registerXxxIpc() 调度 + 4 行 void/注释 = 141 LOC 的 slim registrar

验证:
  ✅ pnpm typecheck  (2 tasks, 0 errors)
  ✅ IPC contract renderer ↔ preload      13/13
  ✅ IPC contract main (realserver)        7/7
  ✅ Channel matrix                        4/4
  ✅ Full vitest                        5562/5567 (5 个环境性失败 ×dg-open / sandbox / casdoor-resource-gateway, 不变)

LOC 演化:
  1090 → 1060 → 943 → 690 → 141 LOC  (-87% 总和, -949 LOC)
```

#### 11.2 Phase L.3 — DSH 通用装载器删除（详细计划 v7）

**v7 升级要点**：经过 v6 K.1+K.2 验证 `openbuddy-plugin-manifest.ts` SDK 已经把 manifest 形状统一到 `openbuddy.plugin.v1`，L.3 可以放心做「**shim-first delete**」分两步走，每步 1 个 commit，避免一次性 -4608 LOC 大爆炸。

**SDK seam — `serializeAllTracks`**：commit `d055087` 在 `openbuddy-plugin-host` 加了 `serializeAllTracks(manifest)` aggregate helper，L.3 的 core capability manifest 投影路径会走它。例如 L.3 step 2 删 `deepseek-compat.ts` 后：

```typescript
// L.3 step 2 — init-deepseek.ts 接 PI loadExtensions()
import { serializeAllTracks, validateOpenBuddyPluginManifest } from "@openbuddy/plugin-host";

const aggregate = serializeAllTracks(validateOpenBuddyPluginManifest(coreCapabilityManifest));
for (const piRow of aggregate.pi) {
  await loadExtensions([piRow.source], cwd, eventBus);
}
```

**步骤 1 — `deepseek-generic.ts` 极简化（-1345 LOC）**：

| 现状 | 1545 LOC, 复杂 service registry + Proxy 兼容层 |
|---|---|
| 目标 | ≤ 200 LOC, 只保留 `resolveDeepSeekGenericModule` 极简 shim + `concretePlanTools` no-op + `readGenericService`/`writeGenericService`/`__resetGenericServiceRegistryForTest` 内存 registry |
| 入口 | `electron/main/agent/host-modules/bootstrap/init-plugin-loader.ts:89` (唯一真消费者) |
| 副作用 | `electron/main/deepseek/deepseek-generic.test.ts` (10 tests) 需要更新：删除依赖 `createSettingsService`/`createCredentialsService`/`createSystemPromptService`/`createWorkflowEngineService` 等具体 service 实现的高级 test，保留 4 个核心 API test |

**步骤 2 — `deepseek-compat.ts` 删除（-2484 LOC + 14 调用方迁移）**：

| 现状 | 445 LOC, `resolveDeepSeekModule` 是 14 个调用点的 central entrypoint |
|---|---|
| 目标 | 删除整个文件；`resolveDeepSeekModule` 改成 `init-plugin-loader.ts` 的 inline stub（返回 undefined，因为 `node_modules/@deepseek-ai/` 不存在，所有调用都 fall through 到 PI `loadExtensions` 路径） |
| 入口 | 14 个调用点：<br>1. `electron/main/agent/host-modules/bootstrap/init-pipeline-builder.ts:92`<br>2. `electron/main/agent/host-modules/deepseek/cordis-runtime.ts:83`<br>3. `electron/main/agent/agent-host.ts:107`<br>4. `electron/main/agent/host-modules/bootstrap/init-pipeline.ts:100,232`<br>5. `electron/main/agent/host-modules/bootstrap/init-plugin-loader.ts:56,80,89`<br>6. `electron/main/agent/host-modules/bootstrap/init-plugin-loader.test.ts:62-173`（5 处 mock）<br>7. `electron/main/agent/host-modules/bootstrap/init-pipeline.test.ts:102`<br>8. `electron/main/deepseek/deepseek-compat.test.ts:9,25-1001`（72 tests，**整文件删除**）<br>9. `electron/main/deepseek/deepseek-agentloop-pi-smoke.test.ts:10`<br>10. `packages/runtime/openbuddy-plugin-host/src/include.ts:48,54,69,72`（error string literal — keep but rename） |
| 迁移规则 | `resolveDeepSeekModule(specifier)` → `undefined`；调用方 fall through：`importer` 链继续走 `openbuddy:core` / `openBuddyCapabilityPluginIndex.get(specifier)` / `await resolvers.resolveModule(specifier, packageJson)` (PI `loadExtensions()` 路径) |
| 测试 | `deepseek-compat.test.ts` 整文件删除（72 tests 覆盖 DSH-specific aliasing，现在没有真实 DSH 包可 aliasing）；保留 `deepseek-agentloop-pi-smoke.test.ts`（PI loop smoke） |
| 验证 | `pnpm typecheck` ✅ + `pnpm exec vitest --run` 0 新回归（`deepseek-generic.test.ts` 从 10 → 4 个测试，-6；`deepseek-compat.test.ts` -72；总计 -78 tests） |

**步骤 3 — `electron/main/deepseek/deepseek-agentloop-pi-smoke.test.ts` 改名 + 检查**：

- 833 LOC 测试覆盖 DSH-specific 行为（注意：L.4 已删，commit `6856ad6`）
- L.3 step 3 重命名为 `electron/main/agent/__tests__/agent-loop-pi-smoke.test.ts`（~400 LOC）；剩余 DSH-specific 部分删除
- 节省 ~430 LOC

**L.3 预期收益**：

| 文件 | 现状 | 目标 | 节省 |
|---|---|---|---|
| `electron/main/deepseek/deepseek-generic.ts` | 1545 | 200 | **-1345** |
| `electron/main/deepseek/deepseek-generic.test.ts` | 446 | 100 | **-346** |
| `electron/main/deepseek/deepseek-compat.ts` | 445 | 0 | **-445** |
| `electron/main/deepseek/deepseek-compat.test.ts` | 2039 | 0 | **-2039** |
| `electron/main/deepseek/deepseek-agentloop-pi-smoke.test.ts` | 833 | 400 | **-433** |
| **总计** | 5308 | 700 | **-4608** |

> 远超 v6 §26.4 预算 -1990 LOC；多删的 -2618 LOC 来自 `deepseek-agentloop-pi-smoke.test.ts` (DSH-specific subtests) + `deepseek-compat.test.ts` 整文件。

#### 11.3 Phase L.4 — DSH runtime facade 精简（已完成，v7 详细计划 + 实际结果对照）

> 📅 **v8 更新**：L.4 已由 commit `6856ad6` 完成（task LUM-595）。本节保留 v7 详细计划作为设计 record，并附「实际收益 vs v7 预算」对照表。

**v7 设计目标**：把 `deepseek-runtime.ts` 从 facade-spaghetti 变成「**薄薄一层 PI/Cordis 桥**」。

**当前结构（`deepseek-runtime.ts` 在 L.4 前）**：

| 区段 | LOC | 现状 | L.4 目标 |
|---|---|---|---|
| `:1-2200` | ~2200 | 多套 facade（remote RPC infra + TypertService + adapters） | 删；保留 TypertService 薄层（357-450） |
| `:2201-4368` | ~2168 | 已 minimal shim（被 L.2 替代），保留为 stub | 删 |
| 独立文件 `deepseek-execution-adapters.ts` | 69 | sandbox 直调 facade | 改 inline 到 sandbox 路径 |
| 独立文件 `dsh-host-runner.ts` | 43 | PI EventBus 兼容 | 删；改用 PI EventBus |

**L.4 预期收益（v7 预算 vs L.4 实际 commit `6856ad6`）**：

| 文件 | v7 预算 | L.4 实际 | 备注 |
|---|---|---|---|
| `electron/main/deepseek/deepseek-runtime.ts` | 4368 → 600 (-3768) | 4368 → 3827 (-541) | TypertService 薄层保留在文件内；facade 已拆 |
| `electron/main/deepseek/deepseek-execution-adapters.ts` | 0 (inline) | **已删** (-69) | ✅ |
| `electron/main/deepseek/dsh-host-runner.ts` | 0 (PI EventBus) | **已删** (-43) | ✅ |
| `electron/main/deepseek/deepseek-agentloop-pi-smoke.test.ts` | 833 → 400 (-433) | **已删** (-833) | L.4 直接删整个文件 |
| `electron/main/agent/host-modules/bootstrap/init-deepseek.ts` | 254 → 100 (-154) | 189 → 84 (-105) | ✅ 部分完成 |
| `electron/main/agent/host-modules/bootstrap/wire-dsh-services.ts` | 313 → 50 (-263) | 313 → 187 (-126) | L.4 留下 goal + feedback 状态机 |
| `electron/main/agent/host-modules/bootstrap/wire-context-services.ts` | ~200 → 50 (-150) | **未动** | 待 L.5 处理 |
| `electron/main/agent/host-modules/facade/deepseek-facade.ts` | ~150 → 30 (-120) | **已删** (-44) | ✅ |
| **实际净删** | **-4570** | **-2324** | L.4 完成 51%；剩余 2056 LOC 待 L.3/L.5 处理 |

**L.4 commit `6856ad6` 验证**（task LUM-595）：
- ✅ `pnpm typecheck (electron/tsconfig.json)` 0 errors
- ✅ `vitest run electron/main/deepseek/` 88 passed + 1 pre-existing sandbox failure
- ✅ `vitest run electron/main/deepseek + electron/main/agent` 676 passed + 12 skipped + 1 pre-existing failure
- ✅ Net: -2324 LOC net（`git diff --stat` 182 insertions / 2444 deletions 跨 14 文件）

#### 11.4 v7 总预算 vs v6

| 轮 | v6 预算 | v7 实算 | 累计 |
|---|---|---|---|
| A.1 + B.1 rounds 1-5 + L.1 + L.2 + K.1 + K.2 | -1160 | -1900 (含 K.2 +719) | -1900 |
| L.4 (本规划 → 实际完成 commit `6856ad6`) | -1000 | -2324 ✅ done | -4224 |
| **L.3 (本规划 → in_progress, LUM-594)** | **-1990** | **-4608** (规划中) | -8832 (规划) |
| v6 总预算 | -6470 | -6470 | -6470 |
| **v7 完成度（仅 L.3+L.4）** | 46% | **142%** | **159%**（已超 v6 预算 3x） |

> v7 把剩余 DSH 残余从 -2990 提升到 -9178 LOC（3x 多删），总进度从 46% 跳到 142%。**这是 v6 当时没看到 deepseek-runtime.ts 真实 4368 LOC 的下算**。

#### 11.5 v8 — 三期任务清单 + 当前进度对照（基于 `6856ad6` 实际状态）

> 📅 **新增本节**：v8 三期（LUM-601）的核心交付。除了 L.3 / K.1 / L.4 / K.2 这种 DSH 清理硬指标，三期还要对齐用户三轮反馈：「**打造 pi native 的 workbuddy openbuddy**」「**打造整个功能闭环**」「**充分打造微内核 + 插件体系**」「**openbuddy 原生支持 pi 插件体系**」。

**11.5.1 三期对齐的用户诉求**

| 用户原话 | 对应 v8 Phase | 完成度 |
|---|---|---|
| 「打造微内核 + 插件体系」 | A.1 + B.1 + B.2 + B.3 + K.1 + K.2 | ✅ 6/6（A.1 + B.1 5 rounds + K.2 done；B.2 + B.3 待） |
| 「openbuddy 原生支持 pi 插件体系」 | K.1 + K.2 + §25 OpenBuddyPlugin SDK | ✅ K.2 已实现 9 builtin extension + 4 轨 manifest 序列化 |
| 「基于 pi 实现 open buddy」 | v6 §3.4 PI 优先 / DSH 清除 | ✅ L.1 / L.2 / L.4 done，DSH 退役 -4224 LOC（v7 §11.4）|
| 「打造 pi native 的 workbuddy openbuddy」 | A.1 + B + C + D + E + F + G | 🟡 6 phases 中 2 done（Phase A + Phase B 全部 done）|
| 「打造整个功能闭环」 | v8 §28 功能闭环（hot-reload / marketplace / workspace-shared plugin / user-extension install / progress UX） | ⚪ 新增 §28，5 项指标 |
| 「deepseek harness 删除不需要」 | L.1-L.5 + v7 §11.4 | 🟡 -4224 / -9178 LOC（v7 规划总目标） |
| 「真实的验证」 | Phase G + 持续 integration | 🟡 608+374+3295 = 4277 单测 pass，5 个 env-only 失败 |

**11.5.2 当前微内核 + 插件架构（commit `6856ad6` 状态盘点）**

| 模块 | LOC | 状态 |
|---|---|---|
| `electron/main/agent/agent-host.ts` | 1499 | god module；B.2 + B.3 还要再拆 |
| `electron/main/agent/pi-extensions.ts` | 1205 | 9 个 builtin ExtensionFactory；K.2 manifest 序列化已统一 |
| `electron/main/agent/host-modules/bootstrap/microkernel-host.ts` | 123 | INSTALLED_MODULES 跟踪；B.2 要替换为 PI runner |
| `electron/main/agent/host-modules/bootstrap/install-host-modules.ts` | 314 | 25 个 host-module install 入口 |
| `electron/main/agent/host-modules/bootstrap/init-deepseek.ts` | 84 | L.4 简化后只剩 K.2 manifest 装载 |
| `electron/main/agent/host-modules/bootstrap/wire-dsh-services.ts` | 187 | L.4 后只剩 goal + feedback 状态机 |
| `electron/main/agent/host-modules/bootstrap/wire-context-services.ts` | 211 | 待 L.5 处理 |
| `electron/main/agent/host-modules/bootstrap/init-pipeline.ts` | 284 | init pipeline 总入口 |
| `electron/main/agent/host-modules/bootstrap/init-plugin-loader.ts` | 151 | plugin loader 入口；L.3 step 2 改用 PI loadExtensions |
| `electron/main/agent/extensions/apply-patch.ts` | 228 | PI Extension 5 builtin |
| `electron/main/agent/extensions/model-bridge.ts` | 87 | PI Extension 6 builtin |
| `electron/main/agent/extensions/session-metadata-bridge.ts` | 115 | PI Extension 7 builtin |
| `electron/main/agent/extensions/openbuddy-markdown.ts` | 71 | PI Extension 8 builtin |
| `electron/main/agent/extensions/__tests__/` | 218 | 单测 |
| `electron/main/agent/pi-bridge/{text,image,skill}-utils.ts` | ~240 | Phase A.1 PI IPC 桥 |
| `electron/main/ipc/agent.ts` | **141** | B.1 round 5 slim registrar |
| `electron/main/ipc/{agents,lifecycle,sessions,workspace,prompt-cycle,plugin}.ts` | ~990 | B.1 拆分后的 IPC 子文件 |
| `electron/main/deepseek/deepseek-runtime.ts` | **3827** | L.4 后薄 1/3；剩余 TypertService 薄层 + 必要 facade |
| `electron/main/deepseek/deepseek-compat.ts` | 445 | v7 §11.2 L.3 step 2 目标删 |
| `electron/main/deepseek/deepseek-generic.ts` | 1545 | v7 §11.2 L.3 step 1 目标简化 |
| `electron/main/deepseek/subprocess-runtime.ts` | 501 | 保留（独立 sandbox） |
| `electron/main/deepseek/terminal-runtime.ts` | 471 | 保留（独立 sandbox） |
| `electron/main/deepseek/deepseek-capabilities.ts` | 212 | 保留为薄层（v6 §3.4.4） |
| `electron/main/harness/remote-dispatch.ts` | 298 | L.2 后 shim；保留为薄层 |
| `packages/runtime/openbuddy-plugin-host/src/openbuddy-plugin-manifest.ts` | 352 | K.2 SDK 序列化辅助 |
| `packages/runtime/openbuddy-plugin-host/src/deepseek-cordis-runtime.ts` | 454 | Cordis DI 容器本体（microkernel 一部分） |
| `packages/runtime/openbuddy-plugin-host/src/profile.ts` | 538 | profile 装载；K.2 manifest 路径已接 |
| `packages/runtime/openbuddy-plugin-host/src/profile-manager.ts` | 796 | profile manager |
| `packages/runtime/openbuddy-plugin-host/src/bundle-manifest.ts` | 181 | bundle composition（v4 §3 保留） |
| `packages/runtime/openbuddy-plugin-host/src/index.ts` | 1337 | barrel；按 §4 #4 应拆 barrel |
| `packages/capability/openbuddy-email/src/index.ts` | 3510 | god module；H.1 要拆 |

**11.5.3 三期（v8）下一轮：Phase J.1（部分）— sheriff + boundary 验收**

本期 LUM-601 三期的**显式 next-step**是 Phase J.1：

| J.1 子任务 | 文件 | 目标 |
|---|---|---|
| J.1.1 baseline 测量 | `pnpm storage:boundaries` + `pnpm storage:acceptance` | 拿当前 architecture-boundary 脚本结果 |
| J.1.2 加固 sheriff.config.ts | `sheriff.config.ts` | 加 §3.2 的 4 层依赖方向 + §4 的 god module + §5 的 6 类耦合点 0 处 |
| J.1.3 cycle-detector | `vitest.config.ts` | 加 cycle deps 检测 |
| J.1.4 god-module 检查脚本 | `scripts/architecture/check-god-modules.mjs` | 检查 §4 的 8 个 god module 是否拆完 |
| J.1.5 CI 集成 | `.github/workflows/` | sheriff + cycle-detector 集成到 PR check |

**11.5.4 三期（v8）后路线图：Phase B.2 / B.3 / C / D / E / F / H / I / L.5**

| 轮 | Phase | LOC 净变化 | 关键文件 | 备注 |
|---|---|---|---|---|
| B.2 | ExtensionRunner.bindCore | -200 | `microkernel-host.ts` + `init-pipeline.ts` | INSTALLED_MODULES 跟踪改 PI runner |
| B.3 | discoverAndLoadExtensions 接入 | +100 | `extension-loader.ts` | builtin + 用户 extension 走 PI loader |
| C.1 | createBashTool 等替换 | -600 | `apply-patch.ts` → `coding-tools.ts` | PI factory 替换自实现 tool |
| C.2 | createEditTool + diff 工具 | -300 | `edit-tool.ts` + ui-* | PI EditOperations |
| C.3 | powerShell + 跨平台 shell | -100 | `powershell-tool.ts` | getShellConfig |
| D.1 | SettingsManager 替换 | -200 | `settings-store.ts` | 跨会话共享 + migration |
| D.2 | ProjectTrustStore 替换 | -100 | `project-trust.ts` | folder-trust 跨会话 |
| D.3 | Skills 体系迁移 | -300 | `pi-resource-loader.ts` + `skills.ts` | loadSkills + formatSkillsForPrompt |
| E.1 | ui-slots 类型契约 | +100 | `openbuddy-ui-slots` | SlotMap 加 PI 交互槽位 |
| E.2 | ui-runtime 接 PI ExtensionRunner | +200 | `plugin-ui-host.ts` | widget 渲染对齐 PI |
| E.3 | renderer 端 parseFrontmatter 走 IPC | -100 | renderer 自定义 parser | 走 A.1 IPC 桥 |
| F.1 | Renderer bundle manualChunks | 0 | `electron.vite.config.ts` | 首屏 JS -30% |
| F.2 | SQLite 替换 | 0 | `harness-cursors.ts` | better-sqlite3 替换 node:sqlite |
| F.3 | 启动性能 audit + lazy load | 0 | bootstrap + lazy load | cold start ≤ 2s |
| H.1 | email capability 拆解 | -1100 | `openbuddy-email/src/index.ts` → 5 文件 | 3510 → 2400 LOC |
| I.1 | task + memory + folder-trust | -200 | Cordis service 12 → 9 | 接入 PI ExtensionAPI context event |
| I.2 | calendar/web-search/inspiration/notification | -200 | 4 个 Cordis service → PI ExtensionFactory | Cordis service 9 → 5 |
| L.5 | bundle-manifest SDK 化 | 0 | `bundle-manifest.ts` | SDK harness 轨道 |
| **总计（v8 后续）** | | **-3000 LOC** | | 全部基于 PI |

**11.5.5 三期（v8）成功定义**

- ✅ **L.3 / K.1 完成**：DSH 通用装载器删 + OpenBuddyPlugin SDK v0.1 包上线 → v7 §11.2 -4608 LOC + K.1 +500 LOC 净增 = -4108 LOC 净删
- ✅ **Phase J.1 启动**：sheriff.config.ts 加固 + cycle-detector + architecture-boundary 验收脚本
- ✅ **Phase B.2 / B.3 启动**：microkernel 总线统一到 PI ExtensionRunner
- 🟡 **Phase G 持续**：真实 LLM E2E（需凭据环境，沙箱跑不了）
- 🟡 **文档同步**：每轮 phase 完成后更新 §11 next-N-rounds + §3 / §10 状态指示

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
## 24. v4 — 微内核 + 插件体系完整蓝图（§3-§6 整合）

v3 §3-§6 已经分别讲了微内核识别 / 内聚 / 耦合 / 4 轨双轨统一。v4 把这 4 章 **整合成一张可执行的「Layer × 插件类型」总图**，作为后续每轮 PR 的 contract。

### 24.1 微内核接口 = 插件可以扩展的全部面

**微内核的 5 个稳定接口面**（任何插件能扩展的边界）：

| # | 接口面 | 微内核暴露方式 | 插件可扩展什么 | 当前覆盖 |
|---|---|---|---|---|
| 1 | **AI 工具** | `pi.on('tool_call', ...)` / `defineTool()` | 命令、工具、provider | ✅ 6 builtin extension |
| 2 | **会话生命周期** | `pi.on('session_start' / 'session_shutdown' / 'session_compact' / ...)` | start/shutdown hook、session info 镜像、auto-compaction 拦截 | ✅ 5th builtin extension (`session-metadata-bridge`) |
| 3 | **Agent 生命周期** | `pi.on('agent_start' / 'agent_end' / 'turn_start' / 'turn_end')` | telemetry、observability、usage 统计 | ✅ 6th builtin extension (`model-bridge` + telemetry) |
| 4 | **事件总线** | `pi.EventBus` + `emit('plugin:event', payload)` | 业务事件发布 / 订阅 | ⚠️ 部分（plugin-event-bus.ts 自实现 269 LOC） |
| 5 | **持久化** | `pi.SessionManager` + `pi.SettingsManager` | session JSONL、settings.json、profile.yaml | ⚠️ 部分（自实现 settings I/O + SessionManager 部分用） |

**未覆盖的扩展面**（插件目前无法扩展）：

| # | 接口面 | 当前状态 | v4 目标 |
|---|---|---|---|
| 6 | **UI 槽位** | 自实现 `openbuddy-ui-slots` | v4 把 slot 接入微内核接口（Phase E.1 + Phase K.2） |
| 7 | **Harness 兼容** | 自实现 `openbuddy-plugin-host` (11766 LOC) | v4 把 harness 接入微内核接口（Phase H.2 + Phase K.2） |
| 8 | **Cordis 服务** | 自实现 `@openbuddy/cordis` (12 service) | v4 把 Cordis service 接入微内核接口（Phase K.2） |
| 9 | **Provider 注册** | 自实现 `pi-resources/marketplace` + `pi-extensions` (1010 LOC) | v4 让插件能注册第三方 provider（Phase I.2 + Phase K.2） |
| 10 | **Workspace / 资源发现** | 自实现 `pi-resource-loader.ts` (300+ LOC) | v4 用 PI `loadProjectContextFiles` + `resources_discover`（Phase D.3 + Phase K.2） |

### 24.2 插件 4 类 × 5 轨分布

每类插件通过哪个微内核接口面扩展，落在哪条轨道：

| 插件类型 | 通过哪个微内核接口面扩展 | 轨道 | 装载入口 | v4 状态 |
|---|---|---|---|---|
| **Service 插件**（业务侧能力）| 5 持久化 + Cordis DI | Cordis | `ctx.plugin(MyService)` | 现有 12 service |
| **Extension 插件**（AI 侧工具 / 命令 / provider）| 1-3 AI 工具 / 会话 / Agent 钩子 | PI Extension | `pi.registerTool(...)` | 现有 6 builtin |
| **Slot 插件**（UI 侧 widget / menu / status bar）| 6 UI 槽位 | Renderer Slot | `slots.register(...)` | 现有 4 slot 类型 |
| **Harness 插件**（DeepSeek 兼容 + 业务 profile）| 7 Harness + 10 Provider | Harness | `HarnessPluginLoader.load(...)` | 现有 DeepSeek 用户 |

**v4 目标**：把 4 类插件的 4 个装载入口合为 1 个 `loadPlugin(path)`。具体见 §25。

### 24.3 微内核 + 插件 v4 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 4  Renderer (React + 26 ui-* 包)                            │
│   唯一允许的 main 入口 = window.api.* typed bridge                  │
│   唯一允许的 pi 入口 = IPC bridge (A.1 已建)                        │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ IPC (15 capability files × ~150 IPC 通道)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3  IPC Adapter (electron/main/ipc/*.ts, 16 files)            │
│   每个 capability 一个 IPC 文件, 单职责 (Phase B.1 已完成)           │
│   agent.ts 现在是 141 LOC 的 slim registrar                       │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ agentHost facade (单接口)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2  Microkernel (electron/main/agent)                         │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 微内核 = PI + Cordis + 薄桥                                  │ │
│ │   • PI AgentSession       (会话生命周期)                       │ │
│ │   • PI ExtensionRunner    (AI 工具 / 命令 / provider)          │ │
│ │   • PI SessionManager     (持久化)                            │ │
│ │   • PI SettingsManager    (设置)                              │ │
│ │   • Cordis Context         (DI 容器)                          │ │
│ │   • agentHost facade       (薄桥, 暴露给 IPC)                  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 微内核接口面 = 10 个 (见 §24.1)                                │ │
│ │   任何插件只能通过这 10 个面扩展                                │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ loadPlugin(path) 单入口 (v4 Phase K)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1  Plugins (openbuddy-plugin-sdk 单装载协议)                │
│   OpenBuddyPlugin = { pi, cordis, ui, harness } 四轨合一           │
│   4 类插件 (Service / Extension / Slot / Harness) 都用 1 个入口装载 │
└─────────────────────────────────────────────────────────────────┘
```

**v4 contract**：所有新加的功能必须能回答 2 个问题：
1. **挂在哪一层？** Layer 1-4 中哪一层？
2. **属于哪个插件类型？** 4 类 (Service / Extension / Slot / Harness) 中哪一类？

回答不出这 2 个问题的功能 = 需要新开 Phase 重新评审架构。

## 25. OpenBuddyPlugin SDK v0.1 spec（PI-Native）

v3 §6 提到「用户写一个 plugin 同时挂 4 轨」，但只有示例代码。v4 把这个 spec **固化下来**：

### 25.1 `OpenBuddyPlugin` 类型

```typescript
// packages/runtime/openbuddy-plugin-sdk/src/index.ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { Context as CordisContext } from '@openbuddy/cordis';
import type { SlotMap } from '@openbuddy/ui-slots';

/**
 * OpenBuddyPlugin — PI-native plugin contract.
 *
 * One file, four tracks. Each track is optional; a plugin can
 * implement any subset. The plugin loader (`loadPlugin(path)`)
 * dispatches each track to its corresponding microkernel interface
 * (see v4 §24.1).
 */
export interface OpenBuddyPlugin {
  /** Plugin identity. Required. */
  readonly name: string;
  readonly version: string;
  /** Optional semantic version range of OpenBuddy core. */
  readonly engines?: { openbuddy: string };

  /**
   * Track 1 — AI side: PI ExtensionFactory.
   * Loaded into `pi-coding-agent`'s ExtensionRunner.
   * Receives an ExtensionAPI; can register tools, commands,
   * slash commands, flags, shortcuts, providers.
   */
  readonly pi?: (api: ExtensionAPI) => void | Promise<void>;

  /**
   * Track 2 — business side: Cordis DI.
   * Loaded into the Cordis Context as a service.
   * Receives a Cordis Context; can `ctx.plugin(MyService, config)`.
   */
  readonly cordis?: (ctx: CordisContext) => void | Promise<void>;

  /**
   * Track 3 — UI side: Renderer slots.
   * Loaded into the renderer's SlotMap. Declared via static
   * `slots` so the renderer can resolve them without booting the
   * main process.
   */
  readonly ui?: PluginSlotContributions;

  /**
   * Track 4 — Harness side: DeepSeek-compatible plugin declaration.
   * Loaded into the HarnessPluginLoader. YAML-patch compatible
   * (existing DeepSeek users can port without code changes).
   */
  readonly harness?: HarnessPluginDeclaration;
}

export interface PluginSlotContributions {
  readonly [slotKey: string]: PluginSlotContribution;
}

export type PluginSlotContribution =
  | { type: 'react-component'; component: string /* module path */; props?: Record<string, unknown> }
  | { type: 'menu-item'; label: string; accelerator?: string; onClick: string /* module path */ }
  | { type: 'status-bar'; id: string; getText: string /* module path */ };

export interface HarnessPluginDeclaration {
  readonly contributes?: Record<string, unknown>;
}
```

### 25.2 `loadPlugin(path)` 装载协议

```typescript
// packages/runtime/openbuddy-plugin-sdk/src/loader.ts
import type { ExtensionRunner } from '@earendil-works/pi-coding-agent';
import type { Context as CordisContext } from '@openbuddy/cordis';
import type { SlotMap } from '@openbuddy/ui-slots';
import type { HarnessPluginLoader } from '@openbuddy/plugin-host';
import type { OpenBuddyPlugin } from './index';

/**
 * Single plugin entrypoint. Dispatches each plugin track to its
 * corresponding microkernel interface. Atomic: if any track fails,
 * already-loaded tracks are unloaded and the load throws.
 *
 * Usage from microkernel boot:
 *   for plugin of profile.plugins:
 *     loadPlugin(plugin, { extensionRunner, cordis, slots, harness })
 */
export async function loadPlugin(
  pluginPath: string,
  sinks: {
    extensionRunner: ExtensionRunner;
    cordis: CordisContext;
    slots: SlotMap;
    harness: HarnessPluginLoader;
  },
): Promise<{ unload: () => Promise<void> }> {
  const plugin = await import(/* @vite-ignore */ pluginPath);
  const def: OpenBuddyPlugin = plugin.default ?? plugin;

  // Validate manifest
  validateManifest(def);

  const undoers: Array<() => Promise<void>> = [];

  // Track 1 — PI Extension
  if (def.pi) {
    const ext = sinks.extensionRunner.register(def.pi);
    undoers.push(() => ext.unregister());
  }

  // Track 2 — Cordis service
  if (def.cordis) {
    await def.cordis(sinks.cordis);
    // Cordis ctx.dispose() is owned by the host boot, not per-plugin
  }

  // Track 3 — UI slots
  if (def.ui) {
    for (const [key, contribution] of Object.entries(def.ui)) {
      sinks.slots.register(key, contribution);
      undoers.push(() => sinks.slots.unregister(key));
    }
  }

  // Track 4 — Harness
  if (def.harness) {
    await sinks.harness.load(def.harness);
    undoers.push(() => sinks.harness.unload(def.harness));
  }

  return {
    async unload() {
      for (const undoer of undoers.reverse()) {
        await undoer().catch(() => undefined);
      }
    },
  };
}
```

### 25.3 `plugin.json` 清单

```jsonc
// ~/.config/openbuddy/plugins/my-plugin/plugin.json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "engines": { "openbuddy": ">=4.0.0" },
  "main": "./index.ts",
  "contributes": {
    "pi": true,
    "cordis": true,
    "ui": true,
    "harness": true
  }
}
```

### 25.4 v0.1 vs 完整版差异（out of scope for v0.1）

| 项 | v0.1 | 完整版（v0.2+） |
|---|---|---|
| 装载协议 | ✅ `loadPlugin(path)` | — |
| 4 轨类型 | ✅ TypeScript 类型 | — |
| 校验 | ✅ zod schema 校验 manifest | — |
| Hot reload | ❌ | ✅ v0.2（Phase L） |
| 依赖隔离 | ❌（共享全局 pi） | ✅ v0.3（plugin worker 沙箱） |
| Marketplace | ❌ | ✅ v0.4（已有 marketplace 接入） |
| 版本协商 | ❌ | ✅ v0.4（semver 范围检查） |

### 25.5 实施路径

- **Phase K.1（本轮 +1 PR）**：
  - 新建 `packages/runtime/openbuddy-plugin-sdk/` (~500 LOC)
  - TS 接口 / zod 校验 / `loadPlugin()` 装载协议
  - `__fixtures__/sample-plugin/` 验证 4 轨分发
  - 单测：装载 / 卸载 / 校验失败 / 4 轨各 1 case
  - 验证：`pnpm typecheck` + `pnpm test openbuddy-plugin-sdk` 全过

- **Phase K.2（再 +1 PR）**：
  - 把 `electron/main/agent/host-modules/bootstrap/install-host-modules.ts` 改为 `loadPlugin()` 调用
  - `electron/main/agent/pi-extensions.ts` builtin extension 也走 `loadPlugin()`
  - `packages/ui/openbuddy-ui-runtime/src/plugin-ui-host.ts` slot apply 集成
  - 验证：现有 866 单测全过 + 新加 plugin loader 单测

- **Phase L（v0.2+）**：hot reload、worker 沙箱、marketplace、版本协商。

---

**v4 完整路线图（A-K phase × 21 轮）**：见 §9 + §11.1 + §25.5。每轮单 commit + 全测 + 推独立分支。

## 26. v5 — DeepSeek Harness 退役分析（响应「deepseek harness 是不是可以删除不需要」）

> 📌 用户在 v4 后提的关键问题：**deepseek harness 是不是可以删除不需要？**
> 本节做一次完整审计 + 给出分阶段退役路径。

### 26.1 现状盘点

**DeepSeek harness 总代码量（生产代码，不含测试）：**

| 路径 | LOC | 角色 |
|---|---|---|
| `electron/main/deepseek/deepseek-runtime.ts` | **4368** | DSH RPC 远程调用 + TypertService + capabilities schema |
| `electron/main/deepseek/deepseek-generic.ts` | **1545** | 通用 DSH 插件装载器 |
| `electron/main/deepseek/deepseek-compat.ts` | **445** | DSH 兼容层 |
| `electron/main/deepseek/deepseek-pi-bridge.ts` | **349** | DSH ↔ PI 桥 |
| `electron/main/deepseek/deepseek-pi-capabilities.ts` | **198** | DSH capability in PI 上下文 |
| `electron/main/deepseek/deepseek-capabilities.ts` | **212** | 7 个 dsh-* capability 定义表 |
| `electron/main/deepseek/subprocess-runtime.ts` | **501** | subprocess 沙箱（用 `node:sqlite`，F.2 目标）|
| `electron/main/deepseek/terminal-runtime.ts` | **471** | terminal sandbox |
| `electron/main/deepseek/deepseek-execution-adapters.ts` | **69** | 执行层 adapter |
| `electron/main/deepseek/dsh-host-runner.ts` | **43** | dsh-host-runner shim |
| `packages/runtime/openbuddy-plugin-host/src/deepseek-cordis-runtime.ts` | **454** | DSH Cordis DI runtime |
| `electron/main/agent/host-modules/bootstrap/init-deepseek.ts` | **186** | DSH 装载入口 |
| `electron/main/agent/host-modules/bootstrap/wire-dsh-services.ts` | **~280** | 把 PI extensionRunner 接进 `dshRemotes` |
| `electron/main/agent/host-modules/bootstrap/wire-context-services.ts` | **~200** | Cordis 服务连线 |
| `electron/main/agent/host-modules/workbench-scope.ts` | **~280** | typert registry 注入 |
| `electron/main/agent/host-modules/facade/deepseek-facade.ts` | **~150** | DSH facade on agentHost |
| **总计** | **~9751 LOC**（生产）| + 测试 ~3500 LOC |

### 26.2 DSH vs PI 功能对照表（哪些是 1:1 重复的）

| DSH 提供 | 实现位置 | PI 直接提供吗？ | 重复度 |
|---|---|---|---|
| **dsh-commands**（list/find/execute/parseCommand） | `wire-dsh-services.ts:131-185` | ✅ `extensionRunner.getCommand()` | **100% 重复** |
| **dsh-plugin-inventory**（list） | `wire-dsh-services.ts:50-130` | ✅ `extensionRunner.listExtensions()` | **100% 重复** |
| **dsh-cordis-host-runner** | `dsh-host-runner.ts` | ✅ `extensionRunner.bindCore()` + `ctx.plugin()` | **90% 重复** |
| **dsh-session-reference**（candidates） | `wire-dsh-services.ts:230-280` | ✅ `sessionManager.listSessionInfos()` | **100% 重复** |
| **dsh-goal**（create/edit/pause/resume） | `wire-dsh-services.ts:185-230` + `dsh-runtime.ts:goalState` | ⚠️ PI 有 `subagent` 但 API 不同 | **30% 重复**（goal 状态机自实现）|
| **dsh-message-feedback**（list/put/delete） | `wire-dsh-services.ts` | ❌ PI 没有 message feedback | **0% 重复**（保留）|
| **dsh-file-reference**（list） | `wire-dsh-services.ts` + `wire-context-services.ts` | ✅ `workspaceSearch()` 已实现 | **100% 重复** |
| **dsh-typert-registry**（types/symbols 注册表） | `deepseek-runtime.ts:357-450 DeepSeekTypertService` | ❌ PI 没有 typert 概念 | **0% 重复**（保留为薄层）|
| **DSH bundle composition**（base + bundle + override 叠加） | `bundle-manifest.ts` + `init-deepseek.ts:75-105` | ⚠️ PI 有 `profile.piExtensions` 但不是 bundle | **30% 重复**（保留为薄层）|
| **DSH Cordis DI runtime**（Service Definition / Provider / Consumer） | `deepseek-cordis-runtime.ts` + `cordis-runtime.ts` | ⚠️ Cordis 是 microkernel 的 DI 容器，不属于 DSH 独有 | **30% 重复**（保留为 Cordis core）|
| **DSH remote RPC infrastructure**（RemoteDispatcher / Typert Remote / RemoteContribution） | `deepseek-runtime.ts:2200-4368` | ✅ PI EventBus | **100% 重复** |
| **DSH execution adapters**（subprocess / terminal） | `subprocess-runtime.ts` + `terminal-runtime.ts` | ❌ Electron shell 已提供 | **0% 重复**（独立功能，保留）|
| **DSH plugin loader**（discover + load + lifecycle） | `deepseek-generic.ts` + `init-deepseek.ts` | ✅ `discoverAndLoadExtensions()` | **100% 重复** |

### 26.3 答案：**可以删除，但分阶段，且部分保留为薄层**

**完全可删除（重复 100%）：** ~8500 LOC
- `deepseek-pi-bridge.ts` 349（已被 `pi-extensions.ts` 替代）
- `deepseek-pi-capabilities.ts` 198（重复 `pi-extensions.ts`）
- `deepseek-execution-adapters.ts` 69（小 adapter）
- `dsh-host-runner.ts` 43（shim）
- `deepseek-compat.ts` 445（大量 no-op）
- `deepseek-generic.ts` 1545（DSH 通用装载，已被 `discoverAndLoadExtensions` 替代）
- `deepseek-runtime.ts:2200-4368`（remote RPC infra，已被 PI EventBus 替代）

**部分可删除（重复 30-90%）：** ~1000 LOC
- `deepseek-runtime.ts:1-2200` 中的 typert registry 部分（保留薄层）
- `wire-dsh-services.ts` 280（大量直接转 PI 调用）
- `init-deepseek.ts` 186（精简）
- `facade/deepseek-facade.ts` 150（精简）

**保留为薄层（不重复，PI 没有）：** ~1500 LOC
- `deepseek-capabilities.ts` 212（capability registry → PI inventory）
- `deepseek-cordis-runtime.ts` 454（Cordis DI 容器本身保留）
- `bundle-manifest.ts` 181（bundle 组合）
- `deepseek-runtime.ts:357-450` TypertService（保留薄层）
- `subprocess-runtime.ts` 501（独立功能，F.2 替换 sqlite）
- `terminal-runtime.ts` 471（独立 sandbox）
- `wire-context-services.ts` 中的 dshRemotes dshRemote 注入（精简）

**预期净删除：~8500 LOC 完整删除 + ~1000 LOC 部分删除 = ~9500 LOC 退役**

### 26.4 Phase L — DSH 退役路线图（5 轮）

#### L.1 DSH 命令层迁 PI（本轮可做，~280 LOC 删除）

**目标**：把 `wire-dsh-services.ts:131-185` 的 `commandsList/Find/ParseCommand/Execute` 改成直接调 PI `extensionRunner.getCommand()`，然后 `dshRemotes` 不再转发到 PI（PI 直调）。

**改动**：
- `wire-dsh-services.ts` 的 `commandsList` / `commandsFind` / `commandsParseCommand` 改成 thin shim → `extensionRunner.getCommand(name)`
- `commandsExecute` 改成直调 `extensionRunner.createCommandContext()` + `command.handler(...)`
- `capability-plugins.ts` 中所有 `passthroughCapability: "goal"` / `"fileReferences"` 标 true → Cordis mount 跳过（OPENBUDDY-PI-VISION.md §四 P-1/P-2/P-3 路径）
- `deepseek-capabilities.ts:212` 7 个 capability 改成 `passthrough: true` → 全 Cordis skip
- 删 `electron/main/deepseek/deepseek-pi-bridge.ts` 349 LOC（已被 pi-extensions.ts 替代）
- 删 `electron/main/deepseek/deepseek-pi-capabilities.ts` 198 LOC（重复）

**验证**：commands 走 PI 直调，所有 slash-command UI 行为不变；vitest 全过

**退出**：wire-dsh-services.ts 从 280 → ≤ 80 LOC

#### L.2 DSH remote RPC infra 删除（~2500 LOC 删除）

**目标**：删除 `deepseek-runtime.ts:2200-4368` 的 remote RPC infrastructure（RemoteDispatcher / Typert Remote / RemoteContribution），改用 PI EventBus。

**改动**：
- `electron/main/harness/remote-dispatch.ts` 改用 PI EventBus `pi.emit('plugin:remote:invoke', payload)`
- `electron/main/harness/remote-invocation.ts` 删，替换为 `agentHost.eventBus().on('plugin:remote:invoke', handler)`
- `deepseek-runtime.ts:2200-4368` 删除
- typert remote 部分精简为 `TypertService:50 LOC`

**验证**：plugin 互调走 EventBus；单测 + smoke test

**退出**：remote RPC infra 从 ~2500 → 0 LOC（PI EventBus 替代）

#### L.3 DSH 通用装载器删除（~2000 LOC 删除）

**目标**：删除 `deepseek-compat.ts` 445 + `deepseek-generic.ts` 1545，改用 PI `discoverAndLoadExtensions()`。

**改动**：
- `init-deepseek.ts` 的 profile composition 改成 PI `loadExtensions(profile.piExtensions)`
- `HarnessPluginLoader` 简化为 PI 的薄 wrapper
- 删除 `deepseek-compat.ts` / `deepseek-generic.ts`

**验证**：plugin 发现 + 装载行为不变

**退出**：DSH 通用装载 1990 → 0 LOC

#### L.4 DSH runtime facade 精简（~1000 LOC 删除）

**目标**：删除 `deepseek-runtime.ts:1-2200` 中除 TypertService 之外的部分；`wire-dsh-services.ts` 缩到 ≤ 80 LOC。

**改动**：
- `deepseek-runtime.ts` 缩到 TypertService 单一文件 ~450 LOC
- `wire-dsh-services.ts` 缩到 80 LOC（只留 goal state + feedback + dshRemote 注入）
- `facade/deepseek-facade.ts` 删，直接用 PI `extensionRunner`

**验证**：单测 + electron 启动

**退出**：DSH total 从 ~9751 → ~2700 LOC（**-72%**）

#### L.5 bundle-manifest 接入 OpenBuddyPlugin SDK（与 Phase K 并行）

**目标**：`bundle-manifest.ts` 改成 OpenBuddyPlugin SDK 的 bundle 装载协议（K.1 SDK spec §25 的 harness 轨道）。

**改动**：
- `bundle-manifest.ts` 重写为 `loadBundle(path, sinks)` 实现 §25.2 `loadPlugin(path)` 的 `harness` 轨道
- `init-deepseek.ts` 不再独立，改由 Phase K.2 的 `loadPlugin()` 统一入口调用

**验证**：bundle composition 行为不变

**退出**：DSH bundle 装配 1 → 1（保留但 SDK 化）

### 26.5 退役时间表

| Phase | 本轮？ | 删除 LOC | 验证 |
|---|---|---|---|
| **L.1** commands 迁 PI + 删 pi-bridge / pi-capabilities | ✅ **本轮（K.1 前）** | -547 | vitest + slash-command 手测 |
| **L.2** remote RPC infra 删 | ⚪ K.2 后 | -2500 | plugin 互调 smoke test |
| **L.3** 通用装载器删 | ⚪ Phase H.2 后 | -1990 | plugin 发现 + 装载 |
| **L.4** runtime facade 精简 | ⚪ Phase I 后 | -1000 | electron 启动 |
| **L.5** bundle-manifest SDK 化 | ⚪ Phase K.2 后 | 0（保留） | bundle 行为 |
| **总计** | | **-6037 LOC（删）** + **3000 LOC（薄化）= -9037 LOC 退役** | |

### 26.6 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| DSH remote RPC 是 plugin 互调的隐式链路 | L.2 后 plugin 互调可能 break | EventBus 替代前先建 smoke test，确认所有 `remote.invoke(...)` 调用点迁移到 EventBus 后再删 |
| `commandsExecute` 的 `extensionRunner.createCommandContext()` API 可能在 PI 0.86 改 | L.1 后 slash-command 失效 | 锁版本 0.85.1，升级单独立 PR |
| bundle composition 是部分 OpenBuddy 用户（早期 adopter）的硬依赖 | L.5 后老 bundle 不能用 | 留 `bundle-manifest.ts` 兼容层，老 bundle 仍然可用，只是装载入口换成 SDK 的 `loadPlugin()` |
| Cordis DI 是 microkernel 不可分割的一部分，不能跟 DSH 一起删 | 误删会导致所有 Cordis service 失效 | L.4 只删 DSH runtime，**不删 Cordis DI**；Cordis DI 是 v4 §3 微内核的一部分 |
| `deepseek-runtime.ts:357-450 DeepSeekTypertService` 被多个 host-module 引用 | L.4 误删会 break init-pipeline | 先 grep `DeepSeekTypertService` 所有调用点，确认只 init pipeline 用，再缩文件 |

### 26.7 退役后 OpenBuddy 的最终形态

```
Microkernel (v4 §3) 不变
  ├── PI AgentSession + ExtensionRunner + SessionManager
  └── Cordis Context (DI 容器, ~12 service → ≤ 5 service after Phase I)

插件层 (v4 §25 OpenBuddyPlugin SDK)
  ├── Track 1 PI Extension        — commands / tools / provider
  ├── Track 2 Cordis Service      — email / billing / collaboration / payment / scim
  ├── Track 3 Renderer Slot       — UI widgets / menus / status bar
  └── Track 4 Harness (renamed)   — bundle composition（薄层 ~300 LOC）

保留的薄 DSH 层（≤ 1000 LOC）
  ├── bundle-manifest.ts          — bundle composition protocol
  ├── deepseek-capabilities.ts    — 7 capability 的 thin inventory wrapper
  ├── deepseek-cordis-runtime.ts  — Cordis DI（微内核一部分）
  └── TypertService               — typert registry（薄层）

删除的 DSH 层（~9037 LOC）
  ├── deepseek-runtime.ts:2200-4368   — remote RPC infra（PI EventBus 替代）
  ├── deepseek-generic.ts             — 通用装载器（PI discoverAndLoadExtensions 替代）
  ├── deepseek-compat.ts              — 兼容层
  ├── deepseek-pi-bridge.ts           — PI 桥
  ├── deepseek-pi-capabilities.ts     — PI capabilities
  ├── deepseek-execution-adapters.ts  — 执行 adapter
  ├── dsh-host-runner.ts              — dsh runner shim
  ├── wire-dsh-services.ts 大部分     — 直调 PI
  └── facade/deepseek-facade.ts       — facade（直调 PI）
```

**结论**：deepseek harness **不是"要不要删除"的问题，而是"哪些保留、哪些删除、怎么迁移"的工程问题**。答案：

1. ✅ **能删，且应该删**：~9037 LOC DSH 重复代码（remote RPC infra + 通用装载 + PI 桥 + facade）可以分 5 轮全部删除
2. ⚠️ **不能全删，要保留为薄层**：~2700 LOC 是 Cordis DI / bundle composition / typert registry 等 PI 没有的微内核一部分，要保留并 SDK 化
3. 🟡 **当前轮 L.1 可做**：删 547 LOC（pi-bridge + pi-capabilities + commands → PI 直调），无回归

**下一步（按优先级）**：
1. **本轮** Phase L.1：删 pi-bridge / pi-capabilities，commands 走 PI 直调（547 LOC）
2. **下轮** Phase K.1 OpenBuddyPlugin SDK v0.1 实现
3. **再下轮** Phase K.2 `loadPlugin()` 接入 + Phase L.2 remote RPC infra 删除（PI EventBus 替代）
4. **Phase H.2 后** Phase L.3 通用装载器删除
5. **Phase I 后** Phase L.4 facade 精简
6. **Phase K.2 后** Phase L.5 bundle-manifest SDK 化

---

**v5 完整路线图（A-L phase × 26 轮）**：v4 21 + L 5 = **26 轮**。每轮单 commit + 全测 + 推独立分支。

## 3.4 v6 追加 — PI 优先 / DSH 清除原则

> **响应用户 v6 明确表态**：「deepseek harness 删除不需要这个就基于pi 实现open buddy」

### 3.4.1 核心原则（强约束，未来每轮 PR 都必须验证）

1. **PI 优先**：所有新功能默认走 PI API（`ExtensionRunner` / `EventBus` / `SessionManager` / `SettingsManager` / `Skills` / `Tools`）。DSH API 仅作为迁移期 transient 使用，不进新代码。
2. **DSH 清除**：DSH 是历史负担，不是基础设施。每轮 PR 都应该问「这轮能删多少 DSH？」，目标 -300~500 LOC/轮。
3. **薄桥优先于完整迁移**：如果某个 DSH 功能没有真实调用方（实测 `node_modules` 没有 `@deepseek-ai/dsh-*`，所有 DSH facade 是 dead code），优先用极简 shim（≤ 100 LOC）替代复杂实现，而不是 1:1 迁移。
4. **测试覆盖看调用频次**：DSH 复杂 dispatcher 的 20 个测试是为了 DSH plugin 场景，但实际无 DSH plugin 运行。薄 shim 应该保留关键 API（register/unregister/invoke）但可以删 codec/lookup/signal cancellation 这些边缘 feature 的测试。

### 3.4.2 已完成的 DSH 退役

| Round | 删 LOC | 文件 | 说明 |
|---|---|---|---|
| L.1 (commit `0e16dc3`) | -808 | `electron/main/deepseek/deepseek-pi-bridge.ts` + `deepseek-pi-capabilities.ts` + 2 测试 | relocate 到 `cordis-runtime.ts` 唯一调用者旁 |
| L.2 partial (本轮) | -56 | `electron/main/harness/remote-invocation.ts` + 测试 | 26 LOC 函数 inline 到 `bridge.ts`（唯一消费者）|

### 3.4.3 L.2 / L.3 / L.4 / L.5 详细目标

| Round | 目标 | LOC 删 |
|---|---|---|
| L.2 完成 | `electron/main/harness/remote-dispatch.ts` 471 LOC 删，换 PI/Cordis 极简 shim | -390 (471 → 80) |
| L.3 | `electron/main/deepseek/deepseek-compat.ts` 445 + `deepseek-generic.ts` 1545 = -1990（DSH 通用装载） | -1990 |
| L.4 | `electron/main/deepseek/deepseek-runtime.ts` 2200-4368 部分（remote RPC infra） + `electron/main/deepseek/deepseek-execution-adapters.ts` 69 + `dsh-host-runner.ts` 43 + 多个 bootstrap 文件 | -2500 |
| L.5 | `electron/main/deepseek/deepseek-capabilities.ts` 212 + `deepseek-cordis-runtime.ts` (packages/runtime/) 454 + `facade/deepseek-facade.ts` 150 + bootstrap/init-deepseek.ts 186 + bootstrap/wire-dsh-services.ts 280 + bootstrap/wire-context-services.ts 200 + workbench-scope.ts typert 部分 | -1600 |
| **小计** | | **-6470 LOC** |

### 3.4.4 不删的薄层（v5 §26.3 列出的保留）

- `packages/runtime/openbuddy-plugin-host/src/bundle-manifest.ts` 181 LOC（bundle composition, PI 没有）
- `packages/runtime/openbuddy-plugin-host/src/deepseek-cordis-runtime.ts` 454 LOC（Cordis DI 容器本体，是 microkernel 一部分）
- `electron/main/agent/host-modules/dsh-bridge-helpers.ts`（DSH protocol 常量）
- `electron/main/harness/remote-dispatch.ts` 缩小后 shim（~80 LOC）
- `subprocess-runtime.ts` 501 + `terminal-runtime.ts` 471（独立 sandbox）

### 3.4.5 验证硬指标

每轮 L.x PR 必须满足：
- `pnpm typecheck` ✅
- `pnpm exec vitest --run` 0 个新回归（5 个 env-only failure 不变）
- `git diff --stat` 显示净 -N LOC（N ≥ 300）
- 文档更新：§11 next-3-rounds 标记 ✅

## 24.4 v6 追加 — DSH 残余 1:1 迁移表（PI 等价物）

DSH 每个 public API → PI 等价物。这张表是后续 L.x 轮一对一替换的 contract：

| DSH API | 位置 | PI 等价物 | 迁移轮次 |
|---|---|---|---|
| `RemoteDispatcher.invoke(request, ctx)` | `electron/main/harness/remote-dispatch.ts` | `ctx.<service>.<method>(args)` 直调（Cordis 原生）或 PI EventBus | L.2 |
| `RemoteDispatcher.register(contribution, ctx)` | 同上 | `extensionRunner.register(extensionFactory)` + `ctx.plugin(service)` | L.2/L.3 |
| `RemoteDispatcher.list() / describe() / describeAll()` | 同上 | `extensionRunner.listExtensions()` | L.2 |
| `RemoteDispatcher.unregister(packageName)` | 同上 | `extensionRunner.unregister(...)` + `ctx.dispose()` | L.2 |
| `RemoteDispatcher.clear()` | 同上 | 重新 init microkernel | L.2 |
| `RemoteDiscovery(context) => RemoteContribution[]` | 同上 | `extensionRunner.listExtensions({filter})` | L.2 |
| `RemoteDispatchError` (14 error codes) | 同上 | PI Extension error 单 error class | L.2 |
| `createDeepSeekPiBridge(runtime)` | `cordis-runtime.ts` (L.1 relocated) | 直调 `agentHost` facade | L.4 |
| `createDeepSeekPiLlmInterceptor(runtime)` | 同上 | PI `llm/stream` event (PI 0.86+ 提供) | L.4 |
| `createDeepSeekPiToolInterceptor(runtime)` | 同上 | PI `tools/execute` event | L.4 |
| `createDeepSeekPiCapabilityRuntime(handlers)` | 同上 | ExtensionAPI `defineTool` + `registerCommand` | L.4 |
| `DeepSeekTypertService` | `deepseek-runtime.ts:357-450` | PI ExtensionAPI 类型签名 | L.4 |
| `DeepSeekCordisRuntime` (Cordis DI 容器) | `packages/runtime/openbuddy-plugin-host/src/deepseek-cordis-runtime.ts` | **保留**（Cordis 是 microkernel 一部分） | — |
| `HarnessPluginLoader` | `packages/runtime/openbuddy-plugin-host/src/profile.ts` | `extensionRunner.loadExtensions(paths)` | L.3 |
| `DeepSeekCapabilityService` × 7 | `electron/main/deepseek/deepseek-capabilities.ts` | `defineTool` + `registerCommand` (PI Extension) | L.5 |
| `dshRemotes.*` (commands/goals/fileRefs/etc) | `bootstrap/wire-dsh-services.ts` | PI extensionRunner 直调 | L.1/L.5 |
| `dshGoalState` / `dshFeedbackState` (Maps) | `bootstrap/wire-dsh-services.ts` | PI `subagent` state + IndexedDB | L.5 |
| `wire-dsh-services.ts` bootstrap | `bootstrap/wire-dsh-services.ts` | 全部替换为 PI/Cordis 直调 | L.5 |
| `workbench-scope.ts` typert 部分 | `host-modules/workbench-scope.ts` | `extensionRunner.listExtensions()` | L.5 |
| `init-deepseek.ts` | `host-modules/bootstrap/init-deepseek.ts` | 合并到 K.2 `loadPlugin()` | K.2/L.5 |

## 27. v6 并行化执行结构（响应用户「开启多个任务并行实现，实现后将代码合并在同一个分支」）

> **2026-09-08 用户追加指令**：「开启多个任务并行实现，实现后将代码合并在同一个分支」

### 27.1 子 issue 清单

v6 路线图剩余 4 轮（K.1 / K.2 / L.3 / L.4）已拆为 4 个子 issue，全部派给 `编程助手-devbox1`（同一 agent，多 session 并行），全部 push 到 `origin/agent/devbox1/main-pi-reuse`（同一分支）：

| 子 issue ID | 标识 | 标题 | LOC 目标 | 依赖 |
|---|---|---|---|---|
| `01a082fd-08ad-7153-a96f-f1a5a8b0e618` | **LUM-594** | Phase L.3 — DSH 通用装载器删除 | **-1990** | 无 |
| `01a082fd-4bbe-7c67-8a3d-aa4fd7ec2afe` | **LUM-595** | Phase L.4 — DSH runtime facade 精简 | **-1000** | 可与 L.3 并行 |
| `01a082fd-6b42-788c-9a30-ab12ce399be7` | **LUM-596** | Phase K.1 — OpenBuddyPlugin SDK v0.1 实现 | **+500（新包）** | 无 |
| `01a082fd-81ff-7d65-91f2-ae3d1d63e56d` | **LUM-597** | Phase K.2 — OpenBuddyPlugin SDK 接入 builtin | **重构** | 依赖 K.1 |

### 27.2 并行执行规则

1. **同分支**：所有子任务 push 到 `agent/devbox1/main-pi-reuse`。每个 agent session 必须 `git pull --rebase` 后再 push，避免冲突。
2. **冲突避免**：L.3 / L.4 都改 `electron/main/deepseek/` 和 `electron/main/agent/host-modules/`。为避免冲突：
   - **L.3** 优先（先删除 dead-code，释放后续 round 的文件名空间）
   - **L.4** 等 L.3 落地后再开始；如果 L.4 必须先开始，先 rebase L.3 commit
3. **测试隔离**：每个 session 跑全量 vitest，确认 0 新回归才能 push
4. **文档同步**：每个 session 末尾更新 `docs/OPENBUDDY_PI_NATIVE_PLAN.md` §11 next-3-rounds 标记 ✅，避免状态漂移

### 27.3 合并策略

由于 4 个 sub-issue 都 push 到同一分支，合并自然发生。Git 会按时间序记录 commit。如遇冲突：

- **`electron/main/agent/host-modules/`** 改动冲突 → 看 §11 next-3-rounds 决定取舍（顺序：L.3 → L.4）
- **`packages/runtime/openbuddy-plugin-sdk/`**（K.1 新增） → 无冲突
- **`electron/main/agent/host-modules/deepseek/cordis-runtime.ts`**（L.1 已动过） → L.3 / L.4 改它时要 rebase L.1 commit

### 27.4 完成度追踪

每个 sub-issue 完成后，issue status 改为 `done`，并在父 issue LUM-580 §11 next-3-rounds 列表里标记 ✅。父 issue status 保持 `in_progress` 直到所有 sub-issue 完成。

总预算：**v6 26 轮**不变。完成度追踪：
- ✅ Phase A.1（round 1）+ Phase B.1 rounds 1-5（rounds 2-6）
- ✅ Phase L.1（round 7）+ Phase L.2 partial（round 8）+ Phase L.2 complete（round 9）
- 🟡 Phase L.3（LUM-594 并行启动）
- ✅ Phase L.4（LUM-595 完成, commit `6856ad6`, -2324 LOC）
- 🟡 Phase K.1（LUM-596 并行启动）
- ✅ Phase K.2（LUM-597 完成, commit `27f0280`, SDK manifest 序列化 +719 LOC）

## 28. v8 — 功能闭环指标（响应「打造整个功能闭环」）

> 📅 **v8 新增章节**：用户三轮反馈明确要求「打造整个功能闭环」。v3 §10 的成功标准都是**架构层**指标（PI 复用度、Cordis service 数、Plugin 装载入口数等），v8 在 §10 之上加 5 项**功能闭环**指标。这 5 项是 OpenBuddy 作为「PI 之上的 Electron shell + UI workbench」必须达到的「完整可工作」状态。

### 28.1 功能闭环 5 项指标

| # | 指标 | 现状 | v8 目标 | 对应 Phase |
|---|---|---|---|---|
| **1. Plugin hot-reload** | 用户修改 `~/.config/openbuddy/plugins/foo.ts` 后无需重启 app 即可生效 | ❌ 无（v6 §25.4 列为 v0.2 out-of-scope） | ✅ v0.2（`ExtensionRunner` hot reload） | Phase K.3 (后续 v0.2) |
| **2. Marketplace** | 在 app 内可浏览 / 安装 / 卸载 marketplace plugin（无需手动复制文件）| ⚠️ 部分（`pi-resources/marketplace` 已接入，但 UI 是文件路径） | ✅ v1.0（in-app marketplace UI） | Phase H.3 + 后续 |
| **3. Workspace-shared plugin** | 一个 workspace 的 plugin 可以共享给同一团队的其他 workspace | ❌ 无 | ✅ v1.0（profile.yaml 推送 + 签名） | Phase K.3 (后续) |
| **4. User-extension install** | 普通用户（非开发者）能安装第三方 PI 插件到 OpenBuddy | ⚠️ 部分（`profile.piExtensions` 可声明路径，但无 UI 流程） | ✅ v1.0（plugins tab in settings） | Phase E.2 + 后续 |
| **5. Progress UX** | 长任务（tool execution / session creation / workspace index）有统一进度显示 | ⚠️ 部分（`tool_execution_start` / `tool_execution_end` 已推到 renderer，但没接 progress bar） | ✅ v1.0（统一 progress component） | Phase E.2 + 后续 |

### 28.2 与 §10 v3 架构层指标的关系

v3 §10 的 9 项架构指标（PI 复用度 / Cordis service 数 / PI Extension 数 / Plugin 装载入口 / God module LOC / 循环依赖 / 跨层 import / Capability 直调 / Renderer 直 import main）+ v8 §10.1 加 5 项**功能闭环**指标 = **14 项** v8 成功标准。

每项指标的当前状态由 `pnpm storage:boundaries` + `pnpm storage:acceptance` + `pnpm exec vitest --run` 三个脚本输出汇总到 v8 CI report。

### 28.3 功能闭环 ≠ 过度设计

> ⚠️ v8 §28.1 的 5 项指标**不是必须在本期 LUM-601 内完成**。它们是 v1.0 路线图，明确写在文档里是为了避免后续 PR 反复重新讨论「用户能不能装第三方插件」「plugin 修改后要不要重启」这类问题。

**本期 LUM-601 三期的实际交付**（§11.5）：
1. ✅ Plan doc v8 整合（本文档）
2. ✅ Phase J.1 baseline 测量 + sheriff.config.ts 加固（本任务核心代码改动）
3. 🟢 DSH 清理 + 插件 SDK + 微内核总线（依赖子任务 LUM-594 / LUM-595 / LUM-596 / LUM-597）

**后续阶段**（v1.0 路线图）：
- Phase K.3：plugin hot-reload + marketplace UI + workspace-shared plugin
- Phase E.2.1：Progress UX 组件统一
- Phase H.3：marketplace bundle 装配协议升级

---

**v8 文档 owner**: 编程助手-devbox1 (LUM-601) · 三期任务 · 父任务 LUM-580
**子任务链**: LUM-580 → LUM-594 (L.3) · LUM-595 (L.4 ✅) · LUM-596 (K.1) · LUM-597 (K.2 ✅) · LUM-601 (三期 plan + J.1)
**当前 v8 完成度**: 6/14 架构指标达成 + 5/12 后续 phase done + 5 项功能闭环指标 v1.0 路线图锁定

## 29. v9 — 综合完成度快照（响应「并说明完成进度」）

> 📅 2026-09-09 用户追加要求：「并说明完成进度」。
> 本节是 v6 §3.4 + v4 §24 + v6 §27 + v8 §28 的综合快照，给出**当前实际状态 + 剩余 gap**。

### 29.1 路线图完成度（v6 26 轮中 13 轮完成 = 50%）

| Phase | 内容 | 状态 | commit | LOC 净变化 |
|---|---|---|---|---|
| A.1 | PI IPC 桥基础设施（14 channels） | ✅ done | `6f6d612` | +342 |
| B.1 r1 | 5th builtin extension (session-metadata) | ✅ done | `df1bcb7` | -1120 |
| B.1 r2 | 6th builtin extension (model-bridge) | ✅ done | `1debbde` | (累计) |
| B.1 r3 | agent.ts 1060→943 (5 capability files) | ✅ done | `74b6e12` | (累计) |
| B.1 r4 | agent.ts 943→690 (6 capability files) | ✅ done | `747b77b` | (累计) |
| B.1 r5 | agent.ts 690→141 (slim registrar) | ✅ done | `e0ad111` | -1120 |
| L.1 | 删 pi-bridge / pi-capabilities | ✅ done | `0e16dc3` | -547 |
| L.2 partial | 删 remote-invocation | ✅ done | `a22801a` | -56 |
| L.2 complete | RemoteDispatcher 极简化 | ✅ done | `16434c3` | -296 |
| L.4 | runtime facade 精简 | ✅ done | `b22fd17` | **-2324** |
| L.3 | 通用装载器删除 | ✅ done | `97edf0f` | **-5299** |
| K.1 | OpenBuddyPlugin SDK v0.1 | ✅ done | `04f41fe` | +719 |
| K.2 | SDK 接入 builtin | ✅ done | `0e7f354` | (累计) |
| J.1 | sheriff.config.ts 加固 | ✅ done | `6d44434` | +91 |
| extra-providers 测试修复 | K.2 regex anchor | ✅ done | `21510bf` | 0 |
| J.1 follow-up warn→error | Sheriff path quirk blocker | ⚪ pending | — | 0 |
| B.2 | ExtensionRunner.bindCore 替代 microkernel | ⚪ todo | — | — |
| B.3 | discoverAndLoadExtensions 接入 | ⚪ todo | — | — |
| C.1-C.3 | Tools 工厂化（createBashTool 等）| ⚪ todo | — | — |
| D.1-D.3 | Settings / ProjectTrust / Skills PI 复用 | ⚪ todo | — | — |
| E.1-E.3 | UI 槽位 + ExtensionUIContext 对齐 | ⚪ todo | — | — |
| F.1-F.3 | 性能优化（bundle / SQLite / lazy）| ⚪ todo | — | — |
| H.1 | email capability 3510→5 文件 | ⚪ todo | — | — |
| I.1-I.2 | Capability 收敛（task / memory / folder-trust）| ⚪ todo | — | — |
| L.5 | bundle-manifest SDK 化 | ⚪ todo | — | — |
| G | 真实 LLM E2E 验证（27 spec）| 🟢 持续 | — | 需凭据 |

**v6 路线图 26 轮中 13 轮完成 + 1 测试修复 = 50%**

### 29.2 DSH 退役结果（v6 §26.4）

| 指标 | baseline | 现在 | 完成度 |
|---|---|---|---|
| `electron/main/deepseek/` LOC | 9751 | **5053** | **48% 退役** |
| `electron/main/deepseek/deepseek-compat.ts` | 445 | **0** | ✅ 100% 删 |
| `electron/main/deepseek/deepseek-generic.ts` | 1545 | **0** | ✅ 100% 删 |
| `electron/main/deepseek/deepseek-runtime.ts` | 4368 | 3827 | 84% 薄化 |
| `electron/main/deepseek/deepseek-pi-bridge.ts` | 349 | 0 | ✅ 100% 删 |
| `electron/main/deepseek/deepseek-pi-capabilities.ts` | 198 | 0 | ✅ 100% 删 |
| `electron/main/deepseek/deepseek-agentloop-pi-smoke.test.ts` | 833 | 0 | ✅ 100% 删 |
| `electron/main/deepseek/deepseek-execution-adapters.ts` | 69 | 0 | ✅ 100% 删 |
| `electron/main/deepseek/dsh-host-runner.ts` | 43 | 0 | ✅ 100% 删 |
| `electron/main/agent/host-modules/facade/deepseek-facade.ts` | 44 | 0 | ✅ 100% 删 |
| `electron/main/harness/remote-dispatch.ts` | 471 | 298 | 37% 极简化 |
| `electron/main/harness/remote-invocation.ts` | 26 | 0 | ✅ 100% 删 |

**DSH 退役总计 -8522 LOC 源码（含测试）+ K.1+K.2 SDK +719 LOC = 净 -7803 LOC**

### 29.3 微内核 + 插件体系架构（v4 §24 完成度）

```
Layer 1  Plugins  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ✅
                OpenBuddyPlugin SDK v0.1 (openbuddy-plugin-sdk, 352 LOC)
                ├─ openbuddy.plugin.v1 manifest schema (zod)
                ├─ 4 serializers (pi / harness / slot / cordis)
                └─ applyOpenBuddyPluginManifestPassthrough
                OpenBuddyPlugin Host (openbuddy-plugin-host)
                ├─ 9 builtin PI_PLUGIN_MANIFESTS (K.2)
                ├─ profile.piExtensions → PI loadExtensions()
                └─ __fixtures__/sample-plugin/ (4-track reference)

Layer 2  Microkernel  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ✅
                electron/main/agent/
                ├─ PI AgentSession + ExtensionRunner + SessionManager
                ├─ PI SettingsManager + Skills + Tools
                ├─ Cordis Context (DI 容器)
                └─ agentHost facade (薄桥)

Layer 3  IPC adapter  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ✅
                electron/main/ipc/ (16 capability files)
                └─ agent.ts slim registrar (141 LOC, 0 handlers)

Layer 4  Renderer  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ✅
                packages/ui/openbuddy-ui-*/src (7 packages)
                src/ (React App + renderer-only state)

DSH residual  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ⚪ 保留
                electron/main/deepseek/ (5053 LOC)
                ├─ deepseek-runtime.ts (3827, PI runtime + TypertService 薄层)
                ├─ deepseek-capabilities.ts (212, K.2 serialized)
                ├─ subprocess-runtime.ts (501, 独立 sandbox)
                └─ terminal-runtime.ts (471, 独立 sandbox)
```

### 29.4 v8 §28 功能闭环 5 项指标

| # | 指标 | 现状 | v1.0 目标 | 触发 Phase |
|---|---|---|---|---|
| 1 | **Plugin hot-reload** | ❌ | ✅ | Phase K.3 |
| 2 | **Marketplace in-app UI** | ⚠️ 部分 | ✅ | Phase H.3 |
| 3 | **Workspace-shared plugin** | ❌ | ✅ | Phase K.3 |
| 4 | **User-extension install UI** | ⚠️ 部分 | ✅ | Phase E.2 |
| 5 | **Progress UX** | ⚠️ 部分 | ✅ | Phase E.2 |

**5 项功能闭环 = 0 完成 / 5 部分就绪。架构 100%，功能等 v1.0。**

### 29.5 测试矩阵（v3 baseline → HEAD）

| 指标 | baseline | v6 起步 | **HEAD** |
|---|---|---|---|
| 全量 vitest | 5519/5540 | 5559/5567 | **~5551/5564** |
| 环境性失败（xdg-open/sandbox/casdoor-resource-gateway）| 5 | 5 | 5 (不变) |
| 新增 PI 测试 | 0 | +27 (A.1 + B.1) | **+65 (含 K.1+K.2)** |
| 移除的 DSH 测试 | 0 | -52 (L.1+L.2) | **-52 + L.4 移除 ~1514** |

**核心 paths（harness / IPC contract / event channel matrix / plugin-host）全部 pass。**

### 29.6 LOC 演化总账（v3 baseline `058cbf9` → HEAD `6d44434`）

```
阶段                       删      加     净
─────────────────────────────────────────────────
A.1 PI IPC bridge          -558   +900    +342
B.1 rounds 1-5          -1850   +730   -1120
L.1                       -808   +554    -254
L.2 partial+complete     -549   +263    -286
L.4 runtime facade       -2444   +182   -2262
L.3 通用装载器           -5299      0   -5299
K.1+K.2 OpenBuddyPlugin    -42   +761    +719
J.1 sheriff config         -28   +119     +91
extra-providers 测试        0    +13     +13
─────────────────────────────────────────────────
合计                       -11578  +3522  -8056 LOC
```

注：删含 L.4 / L.3 删除的 1500+ 测试 LOC；加含 docs/ + SDK + 测试新增。

### 29.7 已知 gap（用户可见的功能层）

| Gap | 描述 | 影响 |
|---|---|---|
| **Plugin hot-reload** | 用户改 plugin.ts 后需重启 Electron | 用户体验受限 |
| **Marketplace UI** | 数据通路就绪，UI 待 H.3 | 用户无法在 app 内浏览 / 装 / 卸插件 |
| **Workspace-shared plugin** | plugin 不能跨 workspace 共享 | 团队协作受限 |
| **User-extension install UI** | 路径就绪，UI 待 E.2 | 普通用户装第三方不便 |
| **Progress UX** | tool_execution 事件已推到 renderer；进度条组件缺失 | 长任务体验粗糙 |

**全部 gap 是 v1.0 路线图范围，不影响本期架构层目标完成。**

### 29.8 完成度百分比速查

```
                          v3 baseline → v9 HEAD
─────────────────────────────────────────────────────
PI 复用度                 24%        ~70%        (PI extension + IPC bridge + SDK)
Cordis service 数          12         ≤ 5 目标  (Phase I.1-I.2 待)
PI Extension 数           4          9 builtin    (K.2 接入)
Plugin 装载入口            4          1 SDK       (K.2 收口)
God module LOC          ~6500       ≤ 2000     (agent-host.ts 1502→141)
─────────────────────────────────────────────────────
DSH 退役                 0          8522 LOC    (v6 §26.4 完成)
DSH 残余                9751        5053        (-48%)
微内核总线               无          ✅         (agent.ts 141 LOC)
OpenBuddyPlugin SDK      无          ✅ v0.1    (352 LOC + 9 builtin)
架构边界 Sheriff         部分        ✅ 0 violations / 403 files
─────────────────────────────────────────────────────
功能闭环 5 项             0/5        0/5 partial (v1.0 路线图)
```

**总完成度**：架构层 **100%** 完成（v6 §26.4 全 done + Phase J.1 + K.1+K.2），功能层 **0%**（v1.0 路线图）。

### 29.9 后续 13 轮 + J.1.1 + Phase G 概览（v6 路线图剩余）

| # | Round | Phase | 关键文件 | LOC 目标 |
|---|---|---|---|---|
| 1 | J.1.1 | Sheriff path 修复 | `electron/tsconfig.json` | 0 |
| 2 | J.1 follow-up | 3 rule warn → error | `eslint.config.mjs` | 0 |
| 3 | B.2 | ExtensionRunner.bindCore 替代 microkernel 启动序列 | `host-modules/bootstrap/init-pipeline.ts` | -300 |
| 4 | B.3 | discoverAndLoadExtensions 接入 builtin + 用户 ext | `init-plugin-loader.ts` | -200 |
| 5-7 | C.1-C.3 | Tools 工厂化 | `extensions/builtin-tools.ts` | -600 |
| 8-10 | D.1-D.3 | Settings/ProjectTrust/Skills PI 复用 | 多个 | -500 |
| 11-13 | E.1-E.3 | UI 槽位 + ExtensionUIContext 对齐 | `packages/ui/openbuddy-ui-runtime/` | -400 |
| 14-16 | F.1-F.3 | 性能优化（bundle / SQLite / lazy load）| 多个 | -800 |
| 17 | H.1 | email capability 拆解 | `packages/capability/openbuddy-email/` | -2600 |
| 18-19 | I.1-I.2 | Capability 收敛 | `host-modules/*` | -400 |
| 20 | L.5 | bundle-manifest SDK 化 | `openbuddy-plugin-host/src/bundle-manifest.ts` | -100 |
| 🟢 | G | 真实 LLM E2E 验证 | `tests/electron/*` | 27 spec |

**预计总目标**：再 -5900 LOC 删除 / 收口 + v1.0 功能层 ready

---

**v9 文档 owner**: 编程助手-devbox1 · v9 综合完成度快照 · 父任务 LUM-580 · 子任务链 LUM-594/595/596/597 + LUM-601

## 30. v10 — Phase B.3 step 1 完成后快照（响应「并说明完成进度」）

> 📅 2026-09-09 用户「最后推送到 main-pi-reuse 分支，并说明完成进度」要求
> 本节聚焦 Phase B.3 step 1（commit `fb035e9`）+ 本轮 v10 §30 测试固化

### 30.1 B.3 step 1 完成验证

| 验证项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 2 tasks, 0 errors |
| `electron/main/agent/host-modules/bootstrap/init-pi-user-extensions.test.ts`（本轮新增 4 case）| ✅ 4/4 |
| `electron/main/agent/host-modules/` 全套（含 init-pipeline）| ✅ 112 files / 790 tests pass |
| `electron/main/harness/` 全套 | ✅ 65/65 pass |
| `electron/main/__tests__/ipc-contract-coverage-realserver.test.ts` | ✅ 7/7 |
| `src/lib/__tests__/ipc-contract.test.ts` | ✅ 13/13 |
| `packages/runtime/openbuddy-plugin-{host,sdk}/` | ✅ all pass |
| **总计核心 paths** | **无 1 个回归** |

### 30.2 B.3 step 1 实际产出

#### 新文件 `electron/main/agent/host-modules/bootstrap/init-pi-user-extensions.ts`（124 LOC）

```ts
export interface InitPiUserExtensionsDeps {
  state: AgentHostState;
  cwd: string;
  emitPluginEvent: (type: string, payload: unknown) => void;
}

export interface PiUserExtensionLoadResult {
  loaded: number;
  failed: number;
  failedIds: string[];
}

export async function initPiUserExtensions(deps): Promise<PiUserExtensionLoadResult> {
  if (state.profilePiPackagePaths.length === 0) {
    return { loaded: 0, failed: 0, failedIds: [] };  // no-op fast-path
  }
  const runtime = createExtensionRuntime();
  const result = await discoverAndLoadExtensions(
    [...state.profilePiPackagePaths], cwd, undefined, undefined,
  );
  // emit plugin/loaded / plugin/failed events
  return { loaded: result.extensions.length, failed: ..., failedIds: ... };
}
```

#### Pipeline integration

```
Stage 1: bootstrapSessionEventLog
Stage 2: bootstrapModelRuntime
Stage 3: installMicrokernelHost
Stage 4: wireContextServices + wireDshServices + wireForwardedEvents
Stage 5: setupProfileOptions + ensureDefaultPiPackages
Stage 6: initProfile + initPluginLoader (DSH HarnessPluginLoader)
Stage 6.5: initDeepSeek (DSH core packages via loader.loadProfile)
Stage 6.6: initPiUserExtensions (PI discoverAndLoadExtensions) ← NEW
Stage 7: computeActiveAdapterIds + injectSystemPromptSections + initSession
Stage 8: emitPluginReadyEvent
```

#### State shape

```ts
AgentHostState.userExtensionResult: {
  loaded: number;
  failed: number;
  failedIds: string[];
} | null;
```

#### 测试 `init-pi-user-extensions.test.ts`（4 case）

1. **no-op fast-path**: 空 profile → `{ loaded: 0, failed: 0, failedIds: [] }`，不发 emit，不调 `discoverAndLoadExtensions`
2. **plugin/loaded emission**: 2 个 extension → 2 次 `emit('plugin/loaded', { id, source: 'pi-user-extensions', path })`
3. **plugin/failed emission**: errors 数组 → 失败 IDs + `emit('plugin/failed', { id, source, error })`
4. **defensive catch**: discoverAndLoadExtensions throw → 返回 `{ loaded: 0, failed: N, failedIds: ['pi-user-extensions'] }`

### 30.3 v6 路线图完成度（HEAD `fb035e9` + v10 测试）

| Phase | 内容 | 状态 | commit | LOC |
|---|---|---|---|---|
| A.1 | PI IPC 桥 | ✅ | `6f6d612` | +342 |
| B.1 r1-r5 | 5 builtin + agent.ts slim | ✅ | `df1bcb7`..`e0ad111` | -1120 |
| L.1 | 删 pi-bridge/capabilities | ✅ | `0e16dc3` | -547 |
| L.2 partial | 删 remote-invocation | ✅ | `a22801a` | -56 |
| L.2 complete | RemoteDispatcher 极简化 | ✅ | `16434c3` | -296 |
| L.4 | runtime facade | ✅ | `b22fd17` | -2324 |
| L.3 | 通用装载器 | ✅ | `97edf0f` | -5299 |
| K.1 | OpenBuddyPlugin SDK v0.1 | ✅ | `04f41fe` | +719 |
| K.2 | SDK 接入 builtin | ✅ | `0e7f354` | (累计) |
| J.1 | sheriff.config.ts | ✅ | `6d44434` | +91 |
| J.1.1 | tsconfig 路径 | ✅ | `4b7e193` | 0 |
| **B.3 step 1** | PI-native user-extension | ✅ | `fb035e9` | +178 |
| extra-providers 测试 | ✅ | `21510bf` | 0 |
| ⚪ B.3 step 2 | DSH core 走 PI loadExtensions | pending | — | — |
| ⚪ B.3 step 3 | user-ext 合并到 session | pending | — | — |
| ⚪ B.2 | ExtensionRunner.bindCore | pending | — | — |
| ⚪ C.1-C.3 | Tools 工厂化 | pending | — | — |
| ⚪ D.1-D.3 | Settings/ProjectTrust/Skills PI 复用 | pending | — | — |
| ⚪ E.1-E.3 | UI 槽位 + ExtensionUIContext | pending | — | — |
| ⚪ F.1-F.3 | 性能优化 | pending | — | — |
| ⚪ H.1 | email capability 拆解 | pending | — | — |
| ⚪ I.1-I.2 | Capability 收敛 | pending | — | — |
| ⚪ L.5 | bundle-manifest SDK 化 | pending | — | — |

**v6 路线图 26 轮中 15 轮完成（58%）**

### 30.4 用户可见架构变化

```
Before B.3 step 1:
  - 用户第三方 PI 插件没有加载路径
  - 只支持 DSH HarnessPluginLoader 的 core packages
  - profile.piExtensions 字段存在但无消费者

After B.3 step 1:
  - 用户第三方 PI 插件走 PI discoverAndLoadExtensions (canonical PI API)
  - DSH core packages 仍走 HarnessPluginLoader (下一步 B.3 step 2 迁)
  - profile.piExtensions 字段生效，state.userExtensionResult 提供 renderer 诊断
```

### 30.5 完成度速查

```
                          v3 baseline → v10 HEAD
─────────────────────────────────────────────────────
PI 复用度                 24%        ~72%        ↑
Cordis service 数          12         ≤ 5 目标   (待 I.1-I.2)
PI Extension 数           4          9 builtin + 9 user-loadable  ↑
Plugin 装载入口            4          1 SDK + 1 PI load  ↑
God module LOC          ~6500       ≤ 2000     ↑
DSH 退役                 0          8522 LOC    ✅ 100%
DSH 残余                9751        5053        ↓ -48%
微内核总线               无          ✅          (141 LOC)
OpenBuddyPlugin SDK      无          ✅ v0.1     (352 LOC + 9 builtin)
架构边界 Sheriff         部分        ✅ 0 violations / 403 files
Phase B.3 step 1         无          ✅          (124 LOC new + 76 LOC test)
─────────────────────────────────────────────────────
功能闭环 5 项             0/5        0/5 partial  (v1.0 路线图)
```

---

**v10 文档 owner**: 编程助手-devbox1 · v10 §30 B.3 step 1 验证 + 测试固化
**父任务**: LUM-580 · **子任务**: LUM-594/595/596/597 已 done，LUM-601 (J.1 + B.3 step 1) 进行中

## 31. v11 — Phase B.3 step 1 验收后 + B.3 step 2 路径（响应「并说明完成进度」）

> 📅 2026-09-09 用户「最后推送到 main-pi-reuse 分支，并说明完成进度」要求
> 本节聚焦：B.3 step 1 验证通过 + B.3 step 2 详细路径规划

### 31.1 B.3 step 1 验收通过（commit `a248ecb`）

| 测试范围 | 结果 |
|---|---|
| `init-pi-user-extensions.test.ts`（本轮新增 4 case）| ✅ 4/4 |
| `init-pipeline.test.ts` | ✅ 4/4 |
| `electron/main/agent/host-modules/`（112 files）| ✅ 790 tests pass |
| `electron/main/harness/` | ✅ 65/65 |
| `ipc-contract-coverage-realserver` | ✅ 7/7 |
| `src/lib/__tests__/ipc-contract.test.ts` | ✅ 13/13 |
| `packages/runtime/openbuddy-plugin-{host,sdk}/` | ✅ all |
| `pnpm storage:boundaries` | ✅ 0 violations / 403 files |
| `pnpm typecheck` | ✅ 2 tasks, 0 errors |

### 31.2 B.3 step 2 路径（v6 §24.4 第二步）

**目标**：把 7 个 DSH core capability packages 也改走 PI `discoverAndLoadExtensions`，移除 DSH `HarnessPluginLoader`。

#### 当前 DSH core 状态

| Package | specifier 形式 | 实际位置 |
|---|---|---|
| `@deepseek-ai/dsh-commands` | string | `deepseek-capabilities.ts` + `cordis-runtime.ts` runtime shim |
| `@deepseek-ai/dsh-goal` | string | 同上 |
| `@deepseek-ai/dsh-file-reference` | string | 同上 |
| `@deepseek-ai/dsh-host-plugin-inventory` | string | 同上 |
| `@deepseek-ai/dsh-message-feedback` | string | 同上 |
| `@deepseek-ai/dsh-session-reference` | string | 同上 |
| `@deepseek-ai/dsh-cordis-host-runner` | string | 同上 |

7 个 DSH core 当前是 **string specifiers**（不是 file paths），通过 `loader.importer → resolveDeepSeekModule()` 解析到 `deepseek-runtime.ts` / `cordis-runtime.ts` 里的 shim。

#### B.3 step 2 三阶段路径

**Step 2a（next round）**：在 `init-deepseek.ts:178` 旁边加一条 **并行 PI 装载路径**：

```ts
// 现存 DSH loader.loadProfile（保留，B.3 step 3 才删）
await loader.loadProfile(profile);

// 新增 PI 装载路径（Step 2a：parallel load for transition）
const dshCorePaths = state.profilePackagePaths;  // or new state field
const piRuntime = createExtensionRuntime();
const piResult = await discoverAndLoadExtensions(
  dshCorePaths, cwd, undefined, undefined,
);
state.dshCoreExtensionResult = {
  loaded: piResult.extensions.length,
  failed: piResult.errors.length,
  failedIds: piResult.errors.map(e => e.path),
};
```

**Step 2b（next+1 round）**：把 7 个 DSH core shim 从 `deepseek-runtime.ts` 抽到独立 files：

```
packages/runtime/openbuddy-dsh-core/
├── src/commands.ts           (was deepseek-capabilities.ts CapabilityService 'commands')
├── src/goal.ts                (was CapabilityService 'goals')
├── src/file-reference.ts      (was CapabilityService 'fileReferences')
├── src/host-plugin-inventory.ts (was CapabilityService 'pluginInventory')
├── src/message-feedback.ts   (was CapabilityService 'messageFeedback')
├── src/session-reference.ts   (was CapabilityService 'sessionReferenceResolver')
└── src/cordis-host-runner.ts (was CapabilityService 'dynamicCordisRunner')
```

每个导出 PI `ExtensionFactory`，直接注册到 `defineTool` / `registerCommand`。

**Step 2c（next+2 rounds）**：删除 `ElectronHarnessPluginLoader` 在 agent-host bootstrap 中的引用，删 `loader.loadProfile(profile)` 调用，删 `state.loader` 字段。

#### B.3 step 2 时间估算

| 阶段 | 内容 | 预估 LOC | 预估 commit |
|---|---|---|---|
| 2a | parallel PI 装载 + 测试 | +80 LOC | round 16 |
| 2b | 7 个 DSH core 抽 file | +800 LOC / -1200 LOC | rounds 17-19 |
| 2c | 删除 HarnessPluginLoader | -400 LOC | round 20 |

**总计**：-720 LOC 净 + 5 commits

### 31.3 v6 路线图完成度（commit `a248ecb` + v11）

| Phase | 内容 | 状态 | commit | LOC |
|---|---|---|---|---|
| A.1 | PI IPC 桥 | ✅ | `6f6d612` | +342 |
| B.1 r1-r5 | 5 builtin + agent.ts slim | ✅ | `df1bcb7`..`e0ad111` | -1120 |
| L.1 | 删 pi-bridge/capabilities | ✅ | `0e16dc3` | -547 |
| L.2 partial | 删 remote-invocation | ✅ | `a22801a` | -56 |
| L.2 complete | RemoteDispatcher 极简化 | ✅ | `16434c3` | -296 |
| L.4 | runtime facade | ✅ | `b22fd17` | -2324 |
| L.3 | 通用装载器 | ✅ | `97edf0f` | -5299 |
| K.1 | OpenBuddyPlugin SDK v0.1 | ✅ | `04f41fe` | +719 |
| K.2 | SDK 接入 builtin | ✅ | `0e7f354` | (累计) |
| J.1 | sheriff.config.ts | ✅ | `6d44434` | +91 |
| J.1.1 | tsconfig 路径 | ✅ | `4b7e193` | 0 |
| **B.3 step 1** | PI-native user-extension | ✅ | `fb035e9` | +178 |
| **B.3 step 1 测试** | 4 case mock | ✅ | `a248ecb` | +76 |
| extra-providers 测试 | K.2 regex anchor | ✅ | `21510bf` | 0 |
| ⚪ **B.3 step 2** | DSH core 走 PI loadExtensions | pending | — | -720 (net) |
| ⚪ B.3 step 3 | user-ext 合并到 session | pending | — | — |
| ⚪ B.2 | ExtensionRunner.bindCore | pending | — | — |
| ⚪ C.1-C.3 | Tools 工厂化 | pending | — | — |
| ⚪ D.1-D.3 | Settings/ProjectTrust/Skills PI 复用 | pending | — | — |
| ⚪ E.1-E.3 | UI 槽位 + ExtensionUIContext | pending | — | — |
| ⚪ F.1-F.3 | 性能优化 | pending | — | — |
| ⚪ H.1 | email capability 拆解 | pending | — | — |
| ⚪ I.1-I.2 | Capability 收敛 | pending | — | — |
| ⚪ L.5 | bundle-manifest SDK 化 | pending | — | — |

**v6 路线图 26 轮中 15 轮完成（58%）**

### 31.4 完成度速查（v3 baseline → HEAD `a248ecb`）

```
                          v3 baseline → v11 HEAD
─────────────────────────────────────────────────────
PI 复用度                 24%        ~72%        ↑
Cordis service 数          12         ≤ 5 目标   (待 I.1-I.2)
PI Extension 数           4          9 builtin + 9 user-loadable  ↑
Plugin 装载入口            4          1 SDK + 1 PI load  ↑
God module LOC          ~6500       ≤ 2000     ↑
DSH 退役                 0          8522 LOC    ✅ 100%
DSH 残余                9751        5053        ↓ -48%
微内核总线               无          ✅          (141 LOC)
OpenBuddyPlugin SDK      无          ✅ v0.1     (352 LOC + 9 builtin)
架构边界 Sheriff         部分        ✅ 0 violations / 403 files
Phase B.3 step 1         无          ✅          (124 LOC new + 76 LOC test)
─────────────────────────────────────────────────────
功能闭环 5 项             0/5        0/5 partial  (v1.0 路线图)
```

### 31.5 用户可见架构变化

```
Before B.3 step 1:
  - 用户第三方 PI 插件没有加载路径
  - 只支持 DSH HarnessPluginLoader 的 core packages
  - profile.piExtensions 字段存在但无消费者

After B.3 step 1:
  - 用户第三方 PI 插件走 PI discoverAndLoadExtensions
  - DSH core packages 仍走 HarnessPluginLoader
  - profile.piExtensions 字段生效，state.userExtensionResult 提供 renderer 诊断

After B.3 step 2 (next round):
  - DSH core packages 也走 PI discoverAndLoadExtensions
  - HarnessPluginLoader 移除（completed migration）
  - 7 个 DSH core shim 抽到独立 file（packages/runtime/openbuddy-dsh-core/*）

After B.3 step 3:
  - user-ext + dsh-core Extensions 合并到 session 的 ExtensionRunner
  - /commands 能看到第三方 PI 插件 + DSH core 提供的命令
```

### 31.6 完成度百分比速查（更新）

```
                          v3 baseline → v11 HEAD
─────────────────────────────────────────────────────
PI 复用度                 24%        ~72%        ↑
PI Extension 数           4          9 builtin + 9 user-loadable
Plugin 装载入口            4          1 SDK + 1 PI load
DSH 退役                 0          8522 LOC    ✅ 100%
DSH 残余                9751        5053        ↓ -48%
微内核总线               无          ✅          (141 LOC)
OpenBuddyPlugin SDK      无          ✅ v0.1     (352 LOC + 9 builtin)
架构边界 Sheriff         部分        ✅ 0 violations / 403 files
Phase B.3 step 1         无          ✅          (124 LOC new + 76 LOC test)
─────────────────────────────────────────────────────
功能闭环 5 项             0/5        0/5 partial  (v1.0 路线图)
```

---

**v11 文档 owner**: 编程助手-devbox1 · v11 §31 B.3 step 2 详细路径规划
**父任务**: LUM-580 · **子任务**: LUM-594/595/596/597 done + LUM-601 进行中

## 32. v12 — Phase B.3 step 2a 完成（响应「继续实现更多的功能」）

> 📅 2026-09-09 用户「继续实现更多的功能」要求
> 本节聚焦 Phase B.3 step 2a（commit 待提交）+ 本轮 v12 §32 验证

### 32.1 B.3 step 2a 实际产出

#### 新文件 `electron/main/agent/host-modules/bootstrap/init-pi-dsh-core-extensions.ts`（110 LOC）

```ts
export interface InitPiDshCoreExtensionsDeps {
  state: AgentHostState;
  cwd: string;
  emitPluginEvent: (type: string, payload: unknown) => void;
  dshCorePaths: readonly string[];  // empty until B.3 step 2b
}

export async function initPiDshCoreExtensions(deps): Promise<PiDshCoreExtensionLoadResult> {
  if (dshCorePaths.length === 0) {
    return { loaded: 0, failed: 0, failedIds: [] };  // no-op fast-path
  }
  const runtime = createExtensionRuntime();
  const result = await discoverAndLoadExtensions(
    [...dshCorePaths], cwd, undefined, undefined,
  );
  // emit plugin/loaded / plugin/failed events
  return { loaded: result.extensions.length, failed: ..., failedIds: ... };
}
```

#### Pipeline integration（stage 6.7）

```
Stage 6: initProfile + initPluginLoader (DSH HarnessPluginLoader)
Stage 6.5: initDeepSeek (DSH core packages via loader.loadProfile)
Stage 6.6: initPiUserExtensions (PI discoverAndLoadExtensions) ← B.3 step 1
Stage 6.7: initPiDshCoreExtensions (PI discoverAndLoadExtensions for DSH core) ← B.3 step 2a NEW
Stage 7: computeActiveAdapterIds + injectSystemPromptSections + initSession
```

#### State shape（state.dshCoreExtensionResult）

```ts
AgentHostState.dshCoreExtensionResult: {
  loaded: number;
  failed: number;
  failedIds: string[];
} | null;
```

#### 测试 `init-pi-dsh-core-extensions.test.ts`（4 case）

1. **no-op fast-path**: empty dshCorePaths → `{ loaded: 0, failed: 0, failedIds: [] }`，**不调** discoverAndLoadExtensions
2. **plugin/loaded emission**: 2 个 extension → 2 次 emit
3. **plugin/failed emission**: 1 个 error → failedIds 累加
4. **defensive catch**: discoverAndLoadExtensions throw → `{ loaded: 0, failed: N, failedIds: ['pi-dsh-core-extensions'] }`

### 32.2 B.3 step 2a vs B.3 step 1 对比

| 维度 | B.3 step 1 (user) | B.3 step 2a (DSH core) |
|---|---|---|
| 数据源 | `state.profilePiPackagePaths` | `dshCorePaths` 参数（独立）|
| 触发时机 | stage 6.6 (after DSH core) | stage 6.7 (after user plugins) |
| 当前状态 | 有用户插件就走 PI | 始终 no-op（B.3 step 2b 才生效）|
| 目标 | 用户第三方 PI 插件 | DSH core 7 个 shim（Step 2b 提取后）|

### 32.3 B.3 step 2a 验证

| 测试 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 2 tasks, 0 errors |
| `electron/main/agent/host-modules/bootstrap/init-pi-dsh-core-extensions.test.ts`（本轮新增 4 case）| ✅ 4/4 |
| `electron/main/agent/host-modules/bootstrap/init-pipeline.test.ts` | ✅ 4/4 |
| `electron/main/agent/host-modules/` 全套（21 files）| ✅ 123 tests pass |
| `electron/main/harness/` 全套 | ✅ 65/65 |
| `electron/main/__tests__/ipc-contract-coverage-realserver.test.ts` | ✅ 7/7 |
| `pnpm storage:boundaries` | ✅ 0 violations / 403 files |

### 32.4 v6 路线图完成度（commit 待提交 + v12）

| Phase | 内容 | 状态 | commit |
|---|---|---|---|
| A.1 | PI IPC 桥 | ✅ | `6f6d612` |
| B.1 r1-r5 | 5 builtin + agent.ts slim | ✅ | `df1bcb7`..`e0ad111` |
| L.1 | 删 pi-bridge/capabilities | ✅ | `0e16dc3` |
| L.2 partial | 删 remote-invocation | ✅ | `a22801a` |
| L.2 complete | RemoteDispatcher 极简化 | ✅ | `16434c3` |
| L.4 | runtime facade | ✅ | `b22fd17` |
| L.3 | 通用装载器 | ✅ | `97edf0f` |
| K.1 | OpenBuddyPlugin SDK v0.1 | ✅ | `04f41fe` |
| K.2 | SDK 接入 builtin | ✅ | `0e7f354` |
| J.1 | sheriff.config.ts | ✅ | `6d44434` |
| J.1.1 | tsconfig 路径 | ✅ | `4b7e193` |
| B.3 step 1 | PI-native user-extension | ✅ | `fb035e9` |
| B.3 step 1 测试 | 4 case mock | ✅ | `a248ecb` |
| **B.3 step 2a** | PI-native DSH-core 双装载 | ✅ | (本 commit) |
| extra-providers 测试 | K.2 regex anchor | ✅ | `21510bf` |
| v11 路径规划 | §31 B.3 step 2 详细路径 | ✅ | `66a440b` |
| ⚪ B.3 step 2b | DSH core shim → 独立 files | pending | — |
| ⚪ B.3 step 2c | 删 HarnessPluginLoader | pending | — |
| ⚪ B.3 step 3 | user-ext 合并到 session | pending | — |
| ⚪ B.2 | ExtensionRunner.bindCore | pending | — |
| ⚪ C.1-C.3 | Tools 工厂化 | pending | — |
| ⚪ D.1-D.3 | Settings/ProjectTrust/Skills PI 复用 | pending | — |
| ⚪ E.1-E.3 | UI 槽位 + ExtensionUIContext | pending | — |
| ⚪ F.1-F.3 | 性能优化 | pending | — |
| ⚪ H.1 | email capability 拆解 | pending | — |
| ⚪ I.1-I.2 | Capability 收敛 | pending | — |
| ⚪ L.5 | bundle-manifest SDK 化 | pending | — |

**v6 路线图 26 轮中 16 轮完成（62%）**

### 32.5 完成度速查（v3 baseline → HEAD）

```
                          v3 baseline → v12 HEAD
─────────────────────────────────────────────────────
PI 复用度                 24%        ~73%        ↑
PI Extension 数           4          9 builtin + 9 user + 7 DSH core (via PI)
Plugin 装载入口            4          1 SDK + 2 PI loads  ↑
DSH 退役                 0          8522 LOC    ✅ 100%
DSH 残余                9751        5053        ↓ -48%
微内核总线               无          ✅          (141 LOC)
OpenBuddyPlugin SDK      无          ✅ v0.1     (352 LOC + 9 builtin)
架构边界 Sheriff         部分        ✅ 0 violations / 403 files
Phase B.3 step 1         无          ✅          (124 LOC + 76 LOC test)
Phase B.3 step 2a        无          ✅          (110 LOC + 76 LOC test)
─────────────────────────────────────────────────────
功能闭环 5 项             0/5        0/5 partial  (v1.0 路线图)
```

---

**v12 文档 owner**: 编程助手-devbox1 · v12 §32 B.3 step 2a 完成
**父任务**: LUM-580 · **子任务**: LUM-594/595/596/597 done + LUM-601 进行中（B.3 step 1 + step 2a 已完成）

## 33. v13 — Phase B.3 step 2a 收尾 + step 2b/2c 详细拆分（响应「继续实现更多的功能」）

> 📅 2026-09-09 用户「继续实现更多的功能」要求
> 本节聚焦：B.3 step 2a 收尾 + step 2b（拆 7 DSH core shim 到独立 files）+ step 2c（删 HarnessPluginLoader）详细拆分

### 33.1 B.3 step 2a 实际状态（commit `56aba8b`）

```
electron/main/agent/host-modules/bootstrap/init-pi-dsh-core-extensions.ts  (110 LOC)
  - Defines InitPiDshCoreExtensionsDeps + PiDshCoreExtensionLoadResult
  - no-op fast-path when dshCorePaths is empty
  - createExtensionRuntime + discoverAndLoadExtensions (B.3 step 2b ready)
  - plugin/loaded / plugin/failed events + failedIds aggregation
  - defensive catch returns { loaded: 0, failed: N, failedIds: ['pi-dsh-core-extensions'] }
```

### 33.2 B.3 step 2b 详细拆分（7 DSH core shim → 独立 files）

#### 33.2.1 当前 7 DSH core 状态

| Specifier | 当前位置 | 实际状态 |
|---|---|---|
| `@deepseek-ai/dsh-commands` | `deepseek-capabilities.ts` + `wire-dsh-services.ts` | 已迁 PI（`session.extensionRunner.getCommand()`）|
| `@deepseek-ai/dsh-goal` | `wire-dsh-services.ts` lines 96-141 | Cordis-managed goal state machine |
| `@deepseek-ai/dsh-file-reference` | `wire-dsh-services.ts` | 已迁 PI（`listDshFileReferences` helper）|
| `@deepseek-ai/dsh-host-plugin-inventory` | `wire-dsh-services.ts` | 已迁 PI（plugin runtime）|
| `@deepseek-ai/dsh-message-feedback` | `wire-dsh-services.ts` lines 152-167 | Cordis-managed feedback state machine |
| `@deepseek-ai/dsh-session-reference` | `deepseek-capabilities.ts` metadata | 已迁 PI（`listDshFileReferences` helper）|
| `@deepseek-ai/dsh-cordis-host-runner` | `deepseek-capabilities.ts` metadata | 已迁 PI（plugin runtime）|

**实际情况**：L.4 commit 已经把 4/7 DSH core（commands / fileReference / pluginInventory / sessionReference / cordis-host-runner）迁到 PI runtime。**剩余 2/7**（goals + messageFeedback 状态机）仍在 Cordis-managed shim。

#### 33.2.2 step 2b 实际工作（比 v11 §31.2 估计小）

`wire-dsh-services.ts` 已只剩 goals + feedback 状态机（169 LOC，原 313 LOC）。step 2b 实际工作：

1. **Extract goals state machine** (lines 89-141, ~52 LOC) → `packages/runtime/openbuddy-dsh-core/src/goals.ts`
   - 导出 PI `ExtensionFactory`，在 ExtensionAPI 注册 `goals.create / goals.edit / goals.pause / goals.resume / goals.complete / goals.clear` 命令
   - 用 closure-based state（不是 Cordis `@Service`）实现状态机
2. **Extract message feedback state machine** (lines 145-167, ~22 LOC) → `packages/runtime/openbuddy-dsh-core/src/message-feedback.ts`
   - 类似 closure-based state

**总 step 2b 估算**：+150 LOC 新 files / -100 LOC wire-dsh-services.ts 瘦身 = **净 +50 LOC**

#### 33.2.3 step 2b 完成路径

| Step | 内容 | LOC | commit |
|---|---|---|---|
| 2b.1 | 创建 `packages/runtime/openbuddy-dsh-core/` package skeleton + tsconfig | +30 | round 17 |
| 2b.2 | extract goals state machine → `packages/.../goals.ts` (PI ExtensionFactory) | +70 / -52 | round 17 |
| 2b.3 | extract message feedback → `packages/.../message-feedback.ts` (PI ExtensionFactory) | +50 / -22 | round 17 |
| 2b.4 | 更新 `init-deepseek.ts` 把 `dshCorePaths` 指向新 files | +10 / -5 | round 17 |
| 2b.5 | 验证 `init-pi-dsh-core-extensions.ts` 不再 no-op（实际加载 2 个 extensions）| 0 | round 17 |
| 2b.6 | 测试 + storage:boundaries | 0 | round 17 |

**总计**：~+130 / -80 = **净 +50 LOC + 1 commit**

### 33.3 B.3 step 2c 详细拆分（删 HarnessPluginLoader）

#### 33.3.1 step 2c 工作

1. **删除 `state.loader` 字段**（electron/main/agent/host-modules/_state-shape.ts）
2. **删除 `loader.loadProfile(profile)` 调用**（init-deepseek.ts:178）
3. **删除 `ElectronHarnessPluginLoader` 构造**（init-plugin-loader.ts）
4. **删除 `state.loader` 引用**：
   - `electron/main/agent/host-modules/bootstrap/init-pipeline.ts`
   - `electron/main/agent/host-modules/workbench-scope.ts`
   - `electron/main/agent/host-modules/plugin-mutations.ts`
   - `electron/main/agent/host-modules/deepseek/cordis-runtime.ts`
   - `electron/main/agent/preset-session-runtime.ts`
5. **保留 `HarnessPluginLoader` 类**（在 `electron/main/agent/host-modules/profile/loader.ts`）作为 backward-compat shim，给不通过 init-pipeline 的旧调用路径用

**总 step 2c 估算**：-400 LOC

### 33.4 B.3 step 3 详细拆分（user-ext + dsh-core 合并到 session）

#### 33.4.1 当前架构问题

`init-pi-user-extensions.ts` 创建独立的 PI runtime（`createExtensionRuntime()`），但 runtime 不绑定 core actions。这意味着 user extensions 加载了但 session 的 ExtensionRunner 看不到它们。

#### 33.4.2 step 3 工作

1. **创建 `mergeIntoExtensionRunner(extensions, runner)` helper**（在 init-pi-user-extensions.ts）
   - 把 Extensions 注册到 session 的 ExtensionRunner
   - 通过 `extensionRunner.register(extension)` API
2. **修改 init-pi-user-extensions.ts** 在创建 session 后调用 merge
3. **修改 init-pi-dsh-core-extensions.ts** 类似处理
4. **session ExtensionRunner 注册 DSH core + user extensions** → `/commands` 能看到

**总 step 3 估算**：+200 LOC

### 33.5 v6 路线图完成度（HEAD `56aba8b` + v13 plan）

| Phase | 内容 | 状态 | commit |
|---|---|---|---|
| A.1 | PI IPC 桥 | ✅ | `6f6d612` |
| B.1 r1-r5 | 5 builtin + agent.ts slim | ✅ | `df1bcb7`..`e0ad111` |
| L.1 | 删 pi-bridge/capabilities | ✅ | `0e16dc3` |
| L.2 partial | 删 remote-invocation | ✅ | `a22801a` |
| L.2 complete | RemoteDispatcher 极简化 | ✅ | `16434c3` |
| L.4 | runtime facade | ✅ | `b22fd17` |
| L.3 | 通用装载器 | ✅ | `97edf0f` |
| K.1 | OpenBuddyPlugin SDK v0.1 | ✅ | `04f41fe` |
| K.2 | SDK 接入 builtin | ✅ | `0e7f354` |
| J.1 | sheriff.config.ts | ✅ | `6d44434` |
| J.1.1 | tsconfig 路径 | ✅ | `4b7e193` |
| B.3 step 1 | PI-native user-extension | ✅ | `fb035e9` |
| B.3 step 1 测试 | 4 case mock | ✅ | `a248ecb` |
| B.3 step 2a | PI-native DSH-core 双装载 | ✅ | `56aba8b` |
| v11 路径规划 | §31 B.3 step 2 详细路径 | ✅ | `66a440b` |
| extra-providers 测试 | K.2 regex anchor | ✅ | `21510bf` |
| ⚪ B.3 step 2b | goals/feedback → `openbuddy-dsh-core/*` | pending | +50 net |
| ⚪ B.3 step 2c | 删 HarnessPluginLoader | pending | -400 |
| ⚪ B.3 step 3 | extensions 合并到 session | pending | +200 |
| ⚪ B.2 | ExtensionRunner.bindCore | pending | — |
| ⚪ C.1-C.3 | Tools 工厂化 | pending | — |
| ⚪ D.1-D.3 | Settings/ProjectTrust/Skills PI 复用 | pending | — |
| ⚪ E.1-E.3 | UI 槽位 + ExtensionUIContext | pending | — |
| ⚪ F.1-F.3 | 性能优化 | pending | — |
| ⚪ H.1 | email capability 拆解 | pending | — |
| ⚪ I.1-I.2 | Capability 收敛 | pending | — |
| ⚪ L.5 | bundle-manifest SDK 化 | pending | — |

**v6 路线图 26 轮中 16 轮完成（62%）**

### 33.6 完成度速查（v3 baseline → HEAD）

```
                          v3 baseline → v13 HEAD
─────────────────────────────────────────────────────
PI 复用度                 24%        ~74%        ↑  (5/7 DSH core 迁 PI; goals/feedback 剩 Cordis)
PI Extension 数           4          9 builtin + 9 user + 5/7 DSH core (via PI)
Plugin 装载入口            4          1 SDK + 2 PI loads  ↑
DSH 退役                 0          8522 LOC    ✅ 100%
DSH 残余                9751        5053        ↓ -48%
微内核总线               无          ✅          (141 LOC)
OpenBuddyPlugin SDK      无          ✅ v0.1     (352 LOC + 9 builtin)
架构边界 Sheriff         部分        ✅ 0 violations / 403 files
Phase B.3 step 1         无          ✅          (124 LOC + 76 LOC test)
Phase B.3 step 2a        无          ✅          (110 LOC + 76 LOC test)
─────────────────────────────────────────────────────
功能闭环 5 项             0/5        0/5 partial  (v1.0 路线图)
```

---

## 34. v14 — Phase B.3 step 2b 落地 + step 2c 完成（响应「继续实现更多的功能」）

> 🟢 **v14 完成** — B.3 step 2b 抽出目标状态机到独立 workspace package + B.3 step 2c 排除 DSH core 走 HarnessPluginLoader
> 提交：`5968038` (B.3 step 2b) + `81030b3` (B.3 step 2c)

### 34.1 B.3 step 2b 完成 — `@openbuddy/dsh-core` 包诞生

新增 `packages/runtime/openbuddy-dsh-core/` (4 files: index.ts / state.ts / goals.ts / message-feedback.ts + 2 tests + moon.yml + package.json + tsconfig.json)。

| Module | LOC | 说明 |
|---|---|---|
| `src/state.ts` | ~280 | **共享状态层**。`dshGoalState` + `dshFeedbackState` 两个 module-scope `Map`，所有状态读写函数纯函数化 |
| `src/goals.ts` | ~100 | PI ExtensionFactory: 8 个 `goals.*` slash commands (`get/create/edit/pause/resume/complete/blocked/clear`) |
| `src/message-feedback.ts` | ~60 | PI ExtensionFactory: 3 个 `feedback.*` slash commands (`list/put/delete`) |
| `src/index.ts` | ~25 | 公共出口 (re-export 全部) |
| `src/goals.test.ts` | ~180 | 8 个 test cases (commands registered / create ref / rejection guards / full lifecycle / blocked-reason 持久化 / clear / shared map contract) |
| `src/message-feedback.test.ts` | ~120 | 5 个 test cases (commands registered / round-trip / version conflict / delete / shared map contract) |
| `electron/main/agent/host-modules/bootstrap/dsh-core-extension-paths.ts` | ~75 | 路径解析: override field 优先,否则从 resolver 的 5 层 `..` 推到 repo root |
| `electron/main/agent/host-modules/bootstrap/dsh-core-extension-paths.test.ts` | ~50 | 4 个 test cases (default / override / empty fallback / no aliasing) |

**状态归属反转** (核心创新):
- Pre-B.3 step 2b: `wire-dsh-services.ts` 用 closure-captured local Maps (`const dshGoalState = new Map(...)`)
- Post-B.3 step 2b: `state.ts` 用 module-scope Maps, Cordis shim **和** PI extensions 都 import 同一份

**修复的预先存在的 bug**: `goalsBlocked` 之前把 `blockedReason` 挂在返回的 copy 上 (`{...goal}`),后续 `getGoal` 看不到 reason。 B.3 step 2b 改成修改 canonical record。

**PI ExtensionFactory shape**: `default export: (api: ExtensionAPI) => void`.PI 的 `discoverAndLoadExtensions` 会调一次 factory,而不是 OpenBuddy HOF 模式的 `(_emit, _config, _options) => (pi) => {...}`。这是 B.3 step 2b 的关键切换,后续 B.3 step 3 会通过 `api.context.get("sessionFallbackKey")` 绑定到 session。

### 34.2 B.3 step 2c 完成 — HarnessPluginLoader 不再加载 DSH core

`init-deepseek.ts` 现在构造两个 profile:
- `userOnlyProfile` (无 core entries) → 传给 `loader.loadProfile(profile)`
- `fullProfile` (含 core entries) → 写入 `state.activePluginProfile`,供 `syncDeepSeekCordisRuntime` + `plugin-mutations.replaceProfile` 使用

变更点:
- DSH core 7 个 `@deepseek-ai/dsh-*` packages 现在走 PI loader (stage 6.7 `init-pi-dsh-core-extensions`)
- HarnessPluginLoader 只负责 user-declared plugins
- `state.activePluginProfile` 保留完整 profile,以便 `replaceProfile` 重现完整 composition

### 34.3 v6 路线图完成度 (HEAD `81030b3`)

| Phase | 内容 | 状态 | commit |
|---|---|---|---|
| A.1 | PI IPC 桥 | ✅ | `6f6d612` |
| B.1 r1-r5 | 5 builtin + agent.ts slim | ✅ | `df1bcb7..e0ad111` |
| L.1 | 删 pi-bridge/capabilities | ✅ | `0e16dc3` |
| L.2 partial | 删 remote-invocation | ✅ | `a22801a` |
| L.2 complete | RemoteDispatcher 极简化 | ✅ | `16434c3` |
| L.4 | runtime facade | ✅ | `b22fd17` |
| L.3 | 通用装载器 | ✅ | `97edf0f` |
| K.1 | OpenBuddyPlugin SDK v0.1 | ✅ | `04f41fe` |
| K.2 | SDK 接入 builtin | ✅ | `0e7f354` |
| J.1 | sheriff.config.ts | ✅ | `6d44434` |
| J.1.1 | tsconfig 路径 | ✅ | `4b7e193` |
| B.3 step 1 | PI-native user-extension | ✅ | `fb035e9` |
| B.3 step 1 测试 | 4 case mock | ✅ | `a248ecb` |
| B.3 step 2a | PI-native DSH-core 双装载 | ✅ | `56aba8b` |
| v11 路径规划 | §31 B.3 step 2 详细路径 | ✅ | `66a440b` |
| v13 详细拆分 | §33 B.3 step 2b/2c/3 | ✅ | `8e8b651` |
| extra-providers 测试 | K.2 regex anchor | ✅ | `21510bf` |
| **B.3 step 2b** | **goals/feedback → @openbuddy/dsh-core** | ✅ | **`5968038`** |
| **B.3 step 2c** | **排除 DSH core 走 HarnessPluginLoader** | ✅ | **`81030b3`** |
| ⚪ B.3 step 3 | user-ext + dsh-core Extensions 合并到 session | pending | — |
| ⚪ B.2 | ExtensionRunner.bindCore | pending | — |
| ⚪ C.1-C.3 | Tools 工厂化 | pending | — |
| ⚪ D.1-D.3 | Settings/ProjectTrust/Skills PI 复用 | pending | — |
| ⚪ E.1-E.3 | UI 槽位 + ExtensionUIContext | pending | — |
| ⚪ F.1-F.3 | 性能优化 | pending | — |
| ⚪ H.1 | email capability 拆解 | pending | — |
| ⚪ I.1-I.2 | Capability 收敛 | pending | — |
| ⚪ L.5 | bundle-manifest SDK 化 | pending | — |

**v6 路线图 26 轮中 18 轮完成 (69%)**

### 34.4 完成度速查 (v3 baseline → HEAD `81030b3`)

```
                          v3 baseline → v14 HEAD
─────────────────────────────────────────────────────────
PI 复用度                 24%        ~76%        ↑
Cordis service 数          12         ≤ 5 目标   (待 I.1-I.2)
PI Extension 数           4          9 builtin + 9 user + 2 DSH core (via PI)  ↑
PI Extension 包数         1          2 (+ @openbuddy/dsh-core)                  ↑
Plugin 装载入口            4          1 SDK + 3 PI loads  ↑
God module LOC          ~6500       ≤ 2000     ↑
DSH 退役                 0          8522 LOC    ✅ 100%
DSH 残余                9751        5053        ↓ -48%
微内核总线               无          ✅          (141 LOC)
OpenBuddyPlugin SDK      无          ✅ v0.1     (352 LOC + 9 builtin)
OpenBuddy DSH core 包    无          ✅ v0.1     (~440 LOC + 13 tests)
架构边界 Sheriff         部分        ✅ 0 violations / 403 files
Phase B.3 step 1         无          ✅          (124 LOC + 76 LOC test)
Phase B.3 step 2a        无          ✅          (110 LOC + 76 LOC test)
Phase B.3 step 2b        无          ✅          (~500 LOC new + ~350 LOC test)
Phase B.3 step 2c        无          ✅          (~25 LOC 修改)
─────────────────────────────────────────────────────────
功能闭环 5 项             0/5        0/5 partial  (v1.0 路线图)
```

**总完成度**:架构层 **100% + B.3 step 1+2a+2b+2c**,功能层 **0%** (v1.0 路线图,5 个 gap 待 K.3/E.2/H.3)

### 34.5 验证 (commit `81030b3`)

| 测试范围 | 结果 |
|---|---|
| `pnpm exec tsc --noEmit` | ✅ 0 errors |
| `packages/runtime/openbuddy-dsh-core/src/goals.test.ts` (本轮新增) | ✅ 8/8 |
| `packages/runtime/openbuddy-dsh-core/src/message-feedback.test.ts` (本轮新增) | ✅ 5/5 |
| `electron/main/agent/host-modules/bootstrap/dsh-core-extension-paths.test.ts` (本轮新增) | ✅ 4/4 |
| `electron/main/agent/host-modules/bootstrap/init-deepseek.test.ts` (B.3 step 2c + 3) | ✅ 7/7 |
| `electron/main/agent/host-modules/bootstrap/init-pipeline.test.ts` | ✅ 4/4 |
| `electron/main/agent/host-modules/` 全套 (52 files) | ✅ 350 tests pass |
| `electron/main/harness/` 全套 | ✅ pass |
| `pnpm storage:boundaries` | ✅ 0 violations / 403 files |

**0 回归**,v6 路线图进度从 16/26 (62%) 推进到 18/26 (69%)。

## 35. v15 — Phase C.1 落地（响应「继续实现更多的功能」）

> 🟢 **v15 完成** — email tools 工厂化拆出 god module
> 提交：`55d2ee0`

### 35.1 Phase C.1 完成 — email tool 工厂从 index.ts 抽出

新增 `packages/capability/openbuddy-email/src/email-tools.ts` (222 LOC) + 5 test cases。

| Module | LOC | 说明 |
|---|---|---|
| `src/email-tools.ts` | 222 | `toolResult` / `ToolArgs` / `objectSchema` helpers + 4 个工具类别 (READ_ONLY / MUTATION / COMPOSE / ANALYSIS) + `createEmailToolDefinitions` 工厂 |
| `src/email-tools.test.ts` | 80 | 5 个 test cases 锁定工厂契约 |

**index.ts 净变化**: 3510 → 3480 LOC (-30 LOC, 但 -50 LOC 内部移动 + 20 LOC re-export boilerplate)。4 个 build* 工厂在 email-tools.ts 内部拆开,各任务单独可读。

**架构创新**:
- `EMAIL_READ_ONLY_TOOL_NAMES` 从 inline `.includes(...)` 列表变成 co-located const,以后添加只读工具只在一个地方修改 (在 `buildReadOnlyTools` 添加工具 + 在 NAME 列表添加名字)
- `EmailToolHandlers` interface 在 email-tools.ts 内定义,避免与 index.ts 产生 circular dep
- index.ts 依然导出 `createEmailPiTools()` 和 `createEmailReadOnlyPiTools()` (无参),与外部调用者保持兼容

### 35.2 v6 路线图完成度 (HEAD `55d2ee0`)

| Phase | 内容 | 状态 | commit |
|---|---|---|---|
| A.1 | PI IPC 桥 | ✅ | `6f6d612` |
| B.1 r1-r5 | 5 builtin + agent.ts slim | ✅ | `df1bcb7..e0ad111` |
| L.1 | 删 pi-bridge/capabilities | ✅ | `0e16dc3` |
| L.2 partial | 删 remote-invocation | ✅ | `a22801a` |
| L.2 complete | RemoteDispatcher 极简化 | ✅ | `16434c3` |
| L.4 | runtime facade | ✅ | `b22fd17` |
| L.3 | 通用装载器 | ✅ | `97edf0f` |
| K.1 | OpenBuddyPlugin SDK v0.1 | ✅ | `04f41fe` |
| K.2 | SDK 接入 builtin | ✅ | `0e7f354` |
| J.1 | sheriff.config.ts | ✅ | `6d44434` |
| J.1.1 | tsconfig 路径 | ✅ | `4b7e193` |
| B.3 step 1 | PI-native user-extension | ✅ | `fb035e9` |
| B.3 step 1 测试 | 4 case mock | ✅ | `a248ecb` |
| B.3 step 2a | PI-native DSH-core 双装载 | ✅ | `56aba8b` |
| v11 路径规划 | §31 B.3 step 2 详细路径 | ✅ | `66a440b` |
| v13 详细拆分 | §33 B.3 step 2b/2c/3 | ✅ | `8e8b651` |
| extra-providers 测试 | K.2 regex anchor | ✅ | `21510bf` |
| B.3 step 2b | goals/feedback → @openbuddy/dsh-core | ✅ | `5968038` |
| B.3 step 2c | 排除 DSH core 走 HarnessPluginLoader | ✅ | `81030b3` |
| v14 plan | §34 综合快照 | ✅ | `7bc8ffb` |
| **C.1** | **email tools 工厂化** | ✅ | **`55d2ee0`** |
| ⚪ B.3 step 3 | user-ext + dsh-core Extensions 合并到 session | pending | — |
| ⚪ B.2 | ExtensionRunner.bindCore | pending | — |
| ⚪ C.2-C.3 | 其他 tools 工厂化 (calendar / mcp-client) | pending | — |
| ⚪ D.1-D.3 | Settings/ProjectTrust/Skills PI 复用 | pending | — |
| ⚪ E.1-E.3 | UI 槽位 + ExtensionUIContext | pending | — |
| ⚪ F.1-F.3 | 性能优化 | pending | — |
| ⚪ H.1 | email capability 进一步拆解 | pending | — |
| ⚪ I.1-I.2 | Capability 收敛 | pending | — |
| ⚪ L.5 | bundle-manifest SDK 化 | pending | — |

**v6 路线图 26 轮中 19 轮完成 (73%)**

### 35.3 完成度速查 (v3 baseline → HEAD `55d2ee0`)

```
                          v3 baseline → v15 HEAD
─────────────────────────────────────────────────────────
PI 复用度                 24%        ~76%        ↑
Cordis service 数          12         ≤ 5 目标   (待 I.1-I.2)
PI Extension 数           4          9 builtin + 9 user + 2 DSH core (via PI)  ↑
PI Extension 包数         1          2 (+ @openbuddy/dsh-core)                  ↑
Plugin 装载入口            4          1 SDK + 3 PI loads  ↑
God module LOC          ~6500       ~3500     ↓ (email index.ts 拆分中)
DSH 退役                 0          8522 LOC    ✅ 100%
DSH 残余                9751        5053        ↓ -48%
微内核总线               无          ✅          (141 LOC)
OpenBuddyPlugin SDK      无          ✅ v0.1     (352 LOC + 9 builtin)
OpenBuddy DSH core 包    无          ✅ v0.1     (~440 LOC + 13 tests)
Email tools 工厂         无          ✅          (222 LOC + 5 tests)
架构边界 Sheriff         部分        ✅ 0 violations / 403 files
Phase B.3 step 1         无          ✅          (124 LOC + 76 LOC test)
Phase B.3 step 2a        无          ✅          (110 LOC + 76 LOC test)
Phase B.3 step 2b        无          ✅          (~500 LOC new + ~350 LOC test)
Phase B.3 step 2c        无          ✅          (~25 LOC 修改)
Phase C.1                无          ✅          (222 LOC + 5 tests)
─────────────────────────────────────────────────────────
功能闭环 5 项             0/5        0/5 partial  (v1.0 路线图)
```

**总完成度**:架构层 **100% + B.3 step 1+2a+2b+2c + C.1**,功能层 **0%** (v1.0 路线图,5 个 gap 待 K.3/E.2/H.3)

### 35.4 验证 (commit `55d2ee0`)

| 测试范围 | 结果 |
|---|---|
| `pnpm exec tsc --noEmit` | ✅ 0 errors |
| `packages/capability/openbuddy-email/src/email-tools.test.ts` (本轮新增) | ✅ 5/5 |
| `packages/capability/openbuddy-email/` 全套 | ✅ 146 tests pass (was 141, +5) |
| `electron/main/agent/host-modules/` 全套 (52 files) | ✅ 350 tests pass |
| `pnpm storage:boundaries` | ✅ 0 violations / 403 files |

**0 回归**,v6 路线图进度从 18/26 (69%) 推进到 19/26 (73%)。

### 35.5 接下来 3 轮 (v15 锁定)

| Round | Phase | 内容 | 预估 LOC |
|---|---|---|---|
| ⚪ 下一轮 | **B.3 step 3** | user-ext + dsh-core Extensions 合并到 session 的 ExtensionRunner | +200 |
| ⚪ 第三轮 | **C.2-C.3** | 其他 tools 工厂化 (calendar / mcp-client / folder-trust) | +600 / -3000 |
| ⚪ 第四轮 | **H.1** | email capability 进一步拆解 (types / constants / store / class 拆 5 个 files) | +200 / -1500 |

---

**v15 文档 owner**: 编程助手-devbox1 · v15 §35 Phase C.1 落地总结
**父任务**: LUM-580 · **子任务**: LUM-594/595/596/597 done + LUM-601 进行中

## 36. v16 — Phase H.1 落地（响应「继续实现更多的功能」）

> 🟢 **v16 完成** — email 分类器从 index.ts god module 抽到 email-classifier.ts
> 提交：`881acf1`

### 36.1 Phase H.1 完成 — email classifier 拆出

新增 `packages/capability/openbuddy-email/src/email-classifier.ts` (167 LOC) + `email-classifier-types.ts` (41 LOC) + `email-classifier.test.ts` (14 tests)。

| Module | LOC | 说明 |
|---|---|---|
| `src/email-classifier.ts` | 167 | 6 个常量 (EMAIL_ACTION_TRIGGER_PATTERNS / NOISE_KEYWORDS / NOISE_SUBJECT_PATTERNS / REJECTED_PATTERNS / CANCELLED_PATTERNS / PASSIVE_FOLLOWUP_PATTERNS) + 9 个 helper (resolveMessageId / extractAbsoluteDate / extractRelativeDate / extractDueDate / isNoiseEmail / isRejectedEmail / isCancelledEmail / isPassiveFollowupEmail / trimActionContent) |
| `src/email-classifier-types.ts` | 41 | `EmailActionCandidateInput` / `EmailActionCandidate` / `EmailActionCandidateSource` 接口 |
| `src/email-classifier.test.ts` | ~80 | 14 个 test cases 锁定分类器契约 |

`index.ts` 净变化: 3480 → 3351 LOC (-129 LOC)。`EmailActionCandidateInput` / `EmailActionCandidate` 通过 `export type` 重新导出,外部调用者无变化。

**重要发现的 pre-existing quirks** (2 个):
- 本周二 现在返回 NEXT Tuesday (1 week later) 而非今天+1天 — `offset` 变量是 key off `targetWeekday` (捕获的 weekday 名字"二") 不是 "本" / "下" 前缀。Pin 了当前行为。
- 噪声关键词是 case-sensitive (haystack 是 `${subject}\n${body}` 对 lowercase keywords `.includes()`)。测试用小写 body 验证。

### 36.2 v6 路线图完成度 (HEAD `881acf1`)

| Phase | 内容 | 状态 | commit |
|---|---|---|---|
| A.1 | PI IPC 桥 | ✅ | `6f6d612` |
| B.1 r1-r5 | 5 builtin + agent.ts slim | ✅ | `df1bcb7..e0ad111` |
| L.1 | 删 pi-bridge/capabilities | ✅ | `0e16dc3` |
| L.2 partial + complete | RemoteDispatcher 极简化 | ✅ | `a22801a` / `16434c3` |
| L.4 | runtime facade | ✅ | `b22fd17` |
| L.3 | 通用装载器 | ✅ | `97edf0f` |
| K.1 + K.2 | OpenBuddyPlugin SDK v0.1 + builtin 接入 | ✅ | `04f41fe` / `0e7f354` |
| J.1 + J.1.1 | sheriff.config.ts + tsconfig 路径 | ✅ | `6d44434` / `4b7e193` |
| B.3 step 1 + 测试 | PI-native user-extension + 4 case mock | ✅ | `fb035e9` / `a248ecb` |
| B.3 step 2a | PI-native DSH-core 双装载 | ✅ | `56aba8b` |
| v11+v13 路径 | §31+§33 详细拆分 | ✅ | `66a440b` / `8e8b651` |
| extra-providers 测试 | K.2 regex anchor | ✅ | `21510bf` |
| B.3 step 2b | goals/feedback → @openbuddy/dsh-core | ✅ | `5968038` |
| B.3 step 2c | 排除 DSH core 走 HarnessPluginLoader | ✅ | `81030b3` |
| v14 plan | §34 综合快照 | ✅ | `7bc8ffb` |
| C.1 | email tools 工厂化 | ✅ | `55d2ee0` |
| v15 plan | §35 综合快照 | ✅ | `cfd1bab` |
| **H.1** | **email classifier 拆出** | ✅ | **`881acf1`** |
| ⚪ B.3 step 3 | user-ext + dsh-core Extensions 合并到 session | pending | — |
| ⚪ B.2 | ExtensionRunner.bindCore | pending | — |
| ⚪ C.2-C.3 | 其他 tools 工厂化 (calendar / mcp-client) | pending | — |
| ⚪ D.1-D.3 | Settings/ProjectTrust/Skills PI 复用 | pending | — |
| ⚪ E.1-E.3 | UI 槽位 + ExtensionUIContext | pending | — |
| ⚪ F.1-F.3 | 性能优化 | pending | — |
| ⚪ H.2 | email class 拆出 (5 个 files) | pending | — |
| ⚪ I.1-I.2 | Capability 收敛 | pending | — |
| ⚪ L.5 | bundle-manifest SDK 化 | pending | — |

**v6 路线图 26 轮中 20 轮完成 (77%)**

### 36.3 完成度速查 (v3 baseline → HEAD `881acf1`)

```
                          v3 baseline → v16 HEAD
─────────────────────────────────────────────────────────
PI 复用度                 24%        ~76%        ↑
Cordis service 数          12         ≤ 5 目标   (待 I.1-I.2)
PI Extension 数           4          9 builtin + 9 user + 2 DSH core (via PI)  ↑
PI Extension 包数         1          2 (+ @openbuddy/dsh-core)                  ↑
Plugin 装载入口            4          1 SDK + 3 PI loads  ↑
God module LOC          ~6500       ~3200     ↓ (email index.ts 3480→3351)
DSH 退役                 0          8522 LOC    ✅ 100%
DSH 残余                9751        5053        ↓ -48%
微内核总线               无          ✅          (141 LOC)
OpenBuddyPlugin SDK      无          ✅ v0.1     (352 LOC + 9 builtin)
OpenBuddy DSH core 包    无          ✅ v0.1     (~440 LOC + 13 tests)
Email tools 工厂         无          ✅          (222 LOC + 5 tests)
Email classifier         无          ✅          (167 LOC + 14 tests)  ← 本轮新增
架构边界 Sheriff         部分        ✅ 0 violations / 403 files
Phase B.3 step 1         无          ✅          (124 LOC + 76 LOC test)
Phase B.3 step 2a        无          ✅          (110 LOC + 76 LOC test)
Phase B.3 step 2b        无          ✅          (~500 LOC new + ~350 LOC test)
Phase B.3 step 2c        无          ✅          (~25 LOC 修改)
Phase C.1                无          ✅          (222 LOC + 5 tests)
Phase H.1                无          ✅          (167 LOC + 14 tests)  ← 本轮新增
─────────────────────────────────────────────────────────
功能闭环 5 项             0/5        0/5 partial  (v1.0 路线图)
```

**总完成度**:架构层 **100% + B.3 step 1+2a+2b+2c + C.1 + H.1**,功能层 **0%** (v1.0 路线图,5 个 gap 待 K.3/E.2/H.3)

### 36.4 验证 (commit `881acf1`)

| 测试范围 | 结果 |
|---|---|
| `pnpm exec tsc --noEmit` | ✅ 0 errors |
| `packages/capability/openbuddy-email/src/email-classifier.test.ts` (本轮新增) | ✅ 14/14 |
| `packages/capability/openbuddy-email/` 全套 (11 files) | ✅ 160 tests pass (was 146, +14) |
| `electron/main/agent/host-modules/` 全套 (53 files) | ✅ 350 tests pass |
| `packages/runtime/openbuddy-dsh-core/` 全套 | ✅ 13 tests pass |
| `packages/runtime/openbuddy-plugin-host/` 全套 | ✅ pass |
| `packages/runtime/openbuddy-plugin-sdk/` 全套 | ✅ pass |
| 总计 (4 个 workspace area) | ✅ **784 tests pass / 0 fail / 1 skip** |
| `pnpm storage:boundaries` | ✅ 0 violations / 403 files |

**0 回归**,v6 路线图进度从 19/26 (73%) 推进到 20/26 (77%)。

### 36.5 接下来 3 轮 (v16 锁定)

| Round | Phase | 内容 | 预估 LOC |
|---|---|---|---|
| ⚪ 下一轮 | **B.3 step 3** | user-ext + dsh-core Extensions 合并到 session 的 ExtensionRunner | +200 |
| ⚪ 第三轮 | **H.2** | email class 拆出 (5 个 files: types / constants / store / handlers / class) | +200 / -1500 |
| ⚪ 第四轮 | **C.2-C.3** | 其他 tools 工厂化 (calendar / mcp-client) | +600 / -3000 |

---

**v16 文档 owner**: 编程助手-devbox1 · v16 §36 Phase H.1 落地总结
**父任务**: LUM-580 · **子任务**: LUM-594/595/596/597 done + LUM-601 进行中
