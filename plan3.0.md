# OpenBuddy Phase 7 完善计划（Plan 3.0）

> 版本：plan3.0 · 日期：2026-09-10 · 适用仓库：`louloulin/OpenBuddy`
> 父文档：`plan4.md`（v6/v7/v8 执行总纲） + `docs/OPENBUDDY_PI_NATIVE_PLAN.md`
> 任务：`LUM-691`（openbuddy 7期完善）
> 上游基线：`@earendil-works/pi-coding-agent` 0.85.1 + pi-agent-core + pi-ai
> 参考实现：pi.dev 5,592 packages 生态 + ExtensionFactory / ExtensionAPI / discoverAndLoadExtensions / ResourceLoader / SettingsManager / ProjectTrustStore / skills / prompts / themes

本计划聚焦 **Phase 7 真实验证 + 功能/性能/产品力收口**，不再展开新的 L/K 阶段。所有路径都是「在现有架构内补齐闭环」，不做大范围迁移；每条改动都能用 `pnpm verify:plan` / `pnpm test` 在本轮内跑通验证。

---

## 1. 当前基线快照（2026-09-10 main `5451ee2`）

### 1.1 已完成（plan4.md / v8 §11）

- **Phase L.1 / L.2 / L.3 / L.4**：DSH 退役 -9178 LOC；DSH remote RPC infra / 通用装载器 / runtime facade 全部精简为薄层。
- **Phase K.1 / K.2**：OpenBuddyPlugin SDK 上线（`packages/runtime/openbuddy-plugin-host/src/openbuddy-plugin-manifest.ts`，352 LOC + 21 单测）。10 个 builtin PI extension 已声明为 `BUILTIN_PI_PLUGIN_MANIFESTS`，manifest 形状统一到 `openbuddy.plugin.v1`。
- **Phase B.1 round 5**：`electron/main/ipc/agent.ts` 1090 → 141 LOC（-87%），拆为 lifecycle / sessions / workspace / prompt-cycle / plugin 五个 capability 子文件。
- **Phase A.1**：PI IPC 桥基础设施。
- **perf(pi)**：bounded event payload / bounded event queue / generation fence / namespace canonicalization / E4 benchmark 证据。
- **ci(release)**：cross-platform artifact contract、credential-free platform preflight、provider E3 fixture gate。
- **fix(electron)**：white-screen on first paint 修复两轮。

### 1.2 已有 10 个 builtin PI ExtensionFactory（plan4 §11.5 + §10.1）

| ID | 用途 | API 覆盖 |
|---|---|---|
| `openbuddy-apply-patch` | worktree patch 工具 | `pi.exec` / `pi.sendUserMessage` |
| `openbuddy-pi-observability` | 全事件转发 | `pi.on(*)` |
| `openbuddy-pi-context-status` | context panel | `pi.on("context" / "turn_end" / "session_compact")` |
| `openbuddy-pi-context-guard` | shouldCompact 阈值触发 | `DEFAULT_COMPACTION_SETTINGS.shouldCompact` |
| `openbuddy-pi-telemetry-bridge` | 转发 span 事件 | `pi.on(*)` |
| `openbuddy-pi-compact-announce` | 注入 follow-up 摘要 | `pi.sendUserMessage` |
| `openbuddy-extra-providers` | Ollama / corporate proxy / Orcarouter | `pi.registerProvider` |
| `openbuddy-pi-session-metadata` | session 镜像 | `pi.on("session_start")` + JSON 镜像 |
| `openbuddy-pi-model-bridge` | model_select / set_model | `pi.on("model_select")` |
| `openbuddy-pi-calendar` | 4 个 calendar tools | `pi.registerTool` × 4 |

### 1.3 pi.dev 能力 vs OpenBuddy 现状对照

来自 [pi.dev](https://pi.dev) 与 [@earendil-works/pi-coding-agent SDK](https://github.com/badlogic/pi-mono/blob/HEAD/packages/coding-agent/docs/sdk.md)：

| PI 能力 | pi.dev 现状 | OpenBuddy 复用度 | 备注 |
|---|---|---|---|
| `createAgentSession` / `AgentSession.prompt/steer/followUp/abort` | 完整 | ✅ 完整 | agent-host.ts 唯一构造点 |
| `EventBus` (subscribe + 全 16 子事件) | 完整 | ✅ 完整 | `pi-event-bridge.ts` 已映射 |
| `discoverAndLoadExtensions` | 完整 | ✅ Phase B.3 step 1（用户扩展） | `init-pi-user-extensions.ts` |
| `loadExtensions` | 完整 | ✅ builtin 走 `extensions:` 参数 | builtin factory 直入 |
| `ExtensionAPI.registerTool` | 完整 | ✅ apply-patch / calendar | 10 个 builtin 中 2 个用 |
| `ExtensionAPI.registerCommand` | 完整 | ✅ compatibility adapters | 9 个 compatibility command |
| `ExtensionAPI.registerShortcut` | 完整 | ⚠️ 未用 | 无键盘快捷键扩展 |
| `ExtensionAPI.registerProvider` | 完整 | ✅ extra-providers | Ollama / Orcarouter |
| `ExtensionAPI.registerMessageRenderer` | 完整 | ⚠️ 未用 | TUI 自渲染，OpenBuddy 是 React |
| `ExtensionAPI.appendEntry` | 完整 | ✅ session-metadata-bridge | session 元数据持久化 |
| `ExtensionAPI.sendUserMessage` / `sendMessage` | 完整 | ✅ compact-announce | 注入 follow-up |
| `ctx.ui.confirm/select/input/editor/notify/status/widget` | 完整 | ✅ ConfirmDialog (#33) + notify | workbuddy UI 投影 |
| `DefaultResourceLoader` | 完整 | ✅ profile.piExtensions | init-pipeline 已用 |
| `DefaultPackageManager` | 完整 | ✅ pi-package-installed / pi-marketplace-cache | marketplace 模块 |
| `SettingsManager` | 完整 | ⚠️ 部分 | 未迁移到 PI SettingsManager |
| `ProjectTrustStore` | 完整 | ⚠️ 自定义 | folder-trust 自实现 |
| `loadSkills / loadSkillsFromDir / formatSkillsForPrompt` | 完整 | ⚠️ 自定义 | skills 自实现 |
| `ModelRegistry / ModelRuntime` | 完整 | ✅ provider registry | model-bridge 已接入 |
| `AuthStorage` | 完整 | ✅ provider registry | model-bridge 已接入 |
| `SessionManager / SessionManager.create` | 完整 | ✅ 完全 | JSONL 会话树直用 |
| `compaction` | 完整 | ✅ 完全 | context-guard / compact-announce |
| 5,592 packages 生态 | 完整 | ⚠️ 仅 marketplace UI 入口 | 可装第三方未做 UX 引导 |
| `pi.dev` package metadata (JSON manifest: `extensions` / `skills` / `prompts`) | 完整 | ✅ marketplace.ts 已聚合 | 已 fetch + aggregate |

### 1.4 真实未解决差距（Phase 7 收口目标）

| 维度 | 差距 | 风险 | 优先级 |
|---|---|---|---|
| **架构门** | sheriff `warn` 未升 `error`；J.1 follow-up 阻塞在 3 个 ui tsconfig 路径别名 false-positive | 后续 PR 静默回退 | **P0** |
| **PI 集成可见性** | renderer 没有「PI 原生库存」聚合视图（builtin + user + marketplace + skills） | 用户感知不到 PI-native 程度 | **P0** |
| **CI 门可执行性** | `pnpm verify:plan` 不跑 storage:boundaries；storage:boundaries 不进 storage:acceptance | 边界破裂无门禁 | **P1** |
| **PI.dev 第三方安装 UX** | `pi install npm:xxx` 可用但无引导；marketplace UI 缺「PI-native」标签 | 用户不知道能不能装 | **P1** |
| **Skills / Prompts / Themes** | PI 提供 `loadSkills / formatSkillsForPrompt` 但 OpenBuddy 自实现 | 双维护风险 | **P2** |
| **SettingsManager 复用** | PI SettingsManager 已存在，OpenBuddy settings 仍自定义 | 配置双写 | **P2** |
| **ProjectTrustStore 复用** | PI 提供；folder-trust 自实现 | 重复实现 | **P2** |

---

## 2. Phase 7 路线（7 轮，5 P0/P1 + 2 P2）

每轮独立 PR；每轮 `pnpm verify:plan` + `pnpm typecheck` + targeted vitest 必须绿。

### Phase 7.1 — 架构门收口（J.1 partial，1 轮）

**目标**：让边界违反真的能在 CI 失败。

- 新增 `scripts/architecture/check-pi-architecture-boundaries.mjs`：在 `check-agent-host-boundaries.mjs` 基础上扩展，扫描 4 类：
  1. `agent-host.ts` 反向被 `host-modules/**` import（已有）
  2. UI 包（`packages/ui/openbuddy-ui-*/src/**`）直接 import `electron/main/**` 或 `packages/runtime/openbuddy-plugin-host/src/**`（新增）
  3. `packages/runtime/openbuddy-plugin-host/**` import `electron/main/**`（新增）
  4. `packages/runtime/openbuddy-plugin-sdk/**` import `electron/main/**` 或 `packages/ui/**`（新增）
- 把脚本挂到 `package.json` 的 `verify:pi-architecture`。
- 把脚本合并进 `pnpm verify:plan` 的「静态门」步骤（在 `run-architecture-acceptance` 之后）。
- README / plan4 §12 增加 CI gate 一行：「新 PR 必须 0 boundary violation」。

**退出标准**：`pnpm verify:plan` 通过；新增脚本独立可跑且报告 0 violations；3 个 ui tsconfig baseUrl 假阳性规避（脚本读 `.ts` 源码不读 tsconfig path alias，规避 sheriff 0.19.6 的 3 个 false-positive）。

### Phase 7.2 — PI 原生库存聚合（E.2 partial，1 轮）

**目标**：renderer 一次拿到「PI-native 全量清单」。

- 在 `electron/main/agent/host-modules/plugin-mutations.ts` 新增 `listPiNativeInventory()`：
  - `builtinExtensions` = `BUILTIN_PI_PLUGIN_MANIFESTS.map(...)`（10 个）
  - `userExtensions` = `state.piExtensionStatuses` 过滤 source 来自 `~/.pi/agent/` 或 `.pi/extensions/`（来自 discoverAndLoadExtensions 路径）
  - `marketplacePackages` = `listPlugins(state.cwd)`（marketplace.ts 已实现）
  - `skills` = `state.profileOptions` 里的 PI skill 路径（`listPiPluginResourcePaths`）
  - `agents` = `listPiPluginAgentFiles(state.cwd)`
  - `providers` = `providerCatalog().providers`（已在 listPluginInventory）
- 新增 IPC handler `agent:pi-native-inventory` in `electron/main/ipc/plugin.ts`。
- renderer preload 包 (`packages/ui/openbuddy-ui-*/src/lib/`) 不动；通过 `window.api.agent.invoke('agent:pi-native-inventory')` 走 typed bridge。
- 单测：在 `electron/main/agent/host-modules/__tests__/plugin-mutations-pi-inventory.test.ts` 覆盖 builtin 10 个 + user 过滤 + 空 marketplace fallback。

**退出标准**：单测 ≥ 4 个全过；typecheck 0 error；`pnpm verify:plan` 通过。

### Phase 7.3 — storage:boundaries 进 storage:acceptance（1 轮）

**目标**：把现有的边界脚本纳入 acceptance matrix。

- 在 `scripts/storage/run-architecture-acceptance.mjs` 的 `checks` 数组里加 `"storage-boundaries"`。
- 让 `pnpm storage:acceptance` 自动 spawn `node scripts/storage/check-architecture-boundaries.mjs`。
- 把 `verify:plan` 默认也跑 storage:acceptance（已跑，验证顺序：package-boundary → storage-boundaries → acceptance-matrix）。

**退出标准**：acceptance JSON `ok: true`；新加 check 名称出现在 output；旧 check 不退化。

### Phase 7.4 — PI.dev 第三方安装 UX（E.2.1 partial，1 轮）

**目标**：用户能在 renderer 直接看到「这是 PI 官方包，可 `pi install`」。

- 在 `packages/runtime/openbuddy-plugin-host/src/pi-dev-package-metadata.ts`（新增）导出 `PI_DEV_PACKAGE_INSTALL_HINT`：
  - 类型 `{ package: string; installCommand: string; docsUrl: string }`
  - 至少 6 个常见类别的 hint：`agent_team` / `memory` / `code_review` / `sandbox` / `workflow` / `ui_workflow`
- 在 `electron/main/agent/pi-resources/marketplace.ts` 的 `listPlugins()` 结果里加 `piDevHint` 字段（从 package.json `pi.extensions / pi.skills / pi.prompts` 派生）。
- 单测覆盖 6 个类别的 hint 派生。

**退出标准**：单测 ≥ 6 个；typecheck 0 error。

### Phase 7.5 — Skills / Prompts PI 复用评估（P2，1 轮）

**目标**：评估迁移路径，不改代码。

- 在 `docs/OPENBUDDY_PI_NATIVE_PLAN.md` 新增 §29.1「Skills / Prompts / Themes 复用评估」：
  - 当前 OpenBuddy skills 数（`find packages -path '*skill*' -name '*.ts' | wc -l`）
  - PI `loadSkills / loadSkillsFromDir / formatSkillsForPrompt` 的契约
  - 迁移成本（LOC）+ 风险（frontmatter 兼容性）+ 推荐（保留兼容 facade，逐步迁移）
- 不写代码。

**退出标准**：文档章节合并到 PR；plan4 §12 follow-up 列表新增一条。

### Phase 7.6 — SettingsManager / ProjectTrustStore 复用评估（P2，1 轮）

**目标**：评估迁移路径，不改代码。

- 在 `docs/OPENBUDDY_PI_NATIVE_PLAN.md` 新增 §29.2「SettingsManager / ProjectTrustStore 复用评估」：
  - 当前 OpenBuddy settings / folder-trust 入口 + LOC
  - PI SettingsManager.create() / ProjectTrustStore 契约
  - 迁移成本 + 风险（settings 持久化路径可能冲突）+ 推荐
- 不写代码。

**退出标准**：文档章节合并到 PR；plan4 §12 follow-up 列表新增一条。

### Phase 7.7 — 真实验证 + plan 更新（持续）

- deterministic contract suite：`pnpm verify:plan` 全绿 + `pnpm typecheck` 全绿 + targeted vitest 全绿。
- 真实 Electron smoke：因环境无 LLM 凭据，跳过（按 plan4 §11.2 规则，只报证据不阻塞本地 contract gate）。
- 更新本文件（plan3.0.md）的「完成进度」小节。

---

## 3. 验证矩阵（每 PR 必须跑）

```bash
pnpm verify:agent-host-boundaries   # 已有
pnpm verify:pi-architecture          # 7.1 新增
pnpm storage:boundaries              # 已有
pnpm storage:acceptance              # 7.3 加 storage-boundaries
pnpm verify:plan                     # 7.1 / 7.3 自动跑上述
pnpm typecheck                       # 全 workspace
pnpm exec vitest run                 # 全量
```

v1 验收门槛沿用 plan4 §11.3：
- TypeScript：affected projects 0 error
- Architecture：0 反向层 import（agent-host / ipc / ui）
- Plugin：list / reload / inventory / enable / disable 全覆盖

---

## 4. 第一批执行顺序（建议给后续实现 agent）

1. **7.1 架构门收口**：先做，因为 7.2 / 7.4 写的新代码必须立刻被新门挡住。
2. **7.2 PI 库存聚合**：让用户能看见 PI-native 程度，配合 7.4 UX 一起落地。
3. **7.3 storage:boundaries 进 acceptance**：CI 门补全。
4. **7.4 PI.dev 第三方安装 UX**：与 7.2 renderer 共享前端展示。
5. **7.5 + 7.6 评估**：纯文档，可与 7.1-7.4 并行。
6. **7.7 真实验证**：所有 P0/P1 完成后跑 verify:plan 一次拿到 contract gate 证据。

每轮独立 PR；不跨阶段顺手迁移。

---

## 5. 完成进度（实滚）

| 阶段 | 状态 | commit | 验证证据 |
|---|---|---|---|
| 7.1 架构门收口 | ✅ done | LUM-691 round 1 | `pnpm verify:pi-architecture` 通过；扫描 810 个文件 / 4 个规则 / 0 violation；接入 `pnpm verify:plan` |
| 7.2 PI 库存聚合 | ✅ done | LUM-691 round 1 | `pnpm exec vitest run electron/main/agent/host-modules/__tests__/plugin-pi-native-inventory.test.ts` 4/4 pass；typecheck 0 error；新增 IPC `agent:pi-native-inventory` |
| 7.3 storage:boundaries 进 acceptance | ⏳ 待开始 | — | — |
| 7.4 PI.dev 第三方安装 UX | ⏳ 待开始 | — | — |
| 7.5 Skills/Prompts 评估 | ⏳ 待开始 | — | — |
| 7.6 SettingsManager 评估 | ⏳ 待开始 | — | — |
| 7.7 真实验证 | 🟡 partial | LUM-691 round 1 | typecheck 绿；boundary 脚本绿；4 个新单测绿；43 个相关现有单测绿；缺 electron smoke / 真实 LLM（按 plan4 §11.2 规则只报证据不阻塞） |

**整体进度**：2 / 7（约 28%）。

### 5.1 本轮（LUM-691 round 1）交付清单

**新增**：
- `plan3.0.md`：Phase 7 实施路线（focused on architecture gate + visibility）
- `scripts/architecture/check-pi-architecture-boundaries.mjs`：CI 门，扫描 4 类反向 import
- `electron/main/agent/host-modules/plugin-pi-native-inventory.ts`：PI 原生库存聚合器
- `electron/main/agent/host-modules/__tests__/plugin-pi-native-inventory.test.ts`：4 个单测

**修改**：
- `package.json`：新增 `verify:pi-architecture`；`verify:plan` 默认串联新脚本
- `electron/main/agent/host-modules/facade/plugin-lifecycle-facade.ts`：wire `listPiNativeInventory`
- `electron/main/agent/host-modules/bootstrap/build-agent-host-facade.ts`：facade 类型加 `listPiNativeInventory`
- `electron/main/agent/agent-host.ts`：re-export `listPiNativeInventory` from facade
- `electron/main/ipc/plugin.ts`：新增 `agent:pi-native-inventory` handler

**验证证据**：
- `pnpm exec vitest run electron/main/agent/host-modules/__tests__/plugin-pi-native-inventory.test.ts` → 4 / 4
- `pnpm exec vitest run electron/main/agent/host-modules/__tests__/task-service.test.ts electron/main/agent/pi-extensions.test.ts electron/main/agent/host-modules/bootstrap/init-pi-user-extensions.test.ts` → 54 / 54（11 + 39 + 4）
- `pnpm typecheck` → 0 error（2 tasks）
- `pnpm storage:boundaries` → 0 violation（426 文件扫描）
- `pnpm storage:acceptance` → ok（7 checks）
- `node scripts/architecture/check-agent-host-boundaries.mjs` → 0 violation
- `node scripts/architecture/check-pi-architecture-boundaries.mjs` → 0 violation（810 文件扫描 / 4 规则）

**未验证及原因**：
- `pnpm test:electron:real-ui` / 真实 LLM E2E：环境无 LLM 凭据 + 无 GUI，按 plan4 §11.2「不阻塞本地 contract gate」规则跳过；本地 deterministic contract 全绿。
- `pnpm test:closed-loop` / `pnpm test:electron:ipc-surface` 等 electron smoke：同 plan4 §11.2，需要真实 Electron runtime + 网络；不在本 round 范围。

### 5.2 后续计划（follow-up 队列）

按优先级：

1. **7.3 storage:boundaries 进 acceptance**：把 `node scripts/storage/check-architecture-boundaries.mjs` 串入 `run-architecture-acceptance.mjs`，CI 多一道防线。
2. **7.4 PI.dev 第三方安装 UX**：renderer 给 marketplace 包加 `piDevHint` 字段（从 `package.json` 派生 `pi.install` 命令），让用户知道能 `pi install npm:xxx`。
3. **7.5 / 7.6 评估**：纯文档，写到 `docs/OPENBUDDY_PI_NATIVE_PLAN.md` §29.1 / §29.2，不改代码。
4. **plan4.md follow-ups**：J.1（sheriff warn → error 3 个 ui tsconfig false-positive）需要 tsconfig baseUrl 迁移到 root-relative，是更大工程，留给后续 agent。
5. **PI-native gap closer**：`pi.registerShortcut()`、`pi.registerMessageRenderer()`、SettingsManager / ProjectTrustStore / Skills 全量复用 PI 0.85.1 API（plan4 §1.2 标注「⚠️ 未用 / 自定义」）。

### 5.3 PI-native 度量（对比 round 0 / round 1）

| 维度 | round 0 (commit `5451ee2`) | round 1 (LUM-691 round 1) |
|---|---|---|
| 架构门 | sheriff warn + 1 个 boundary 脚本 | sheriff warn + 2 个 boundary 脚本（host + pi-architecture） |
| PI 库存可见性 | renderer 必须调 4 个 IPC（plugin-list / plugin-inventory / tools-list / marketplace）才能拼齐 | renderer 1 个 IPC（agent:pi-native-inventory）拿到 builtin + user + marketplace + skills + agents |
| 微内核 LOC | agent-host.ts 1526 LOC | agent-host.ts ~1526 LOC（仅 facade re-export +5） |
| 测试覆盖 | 43（已存在相关） | 47（+4 新） |
| TypeScript | 0 error | 0 error |

---

## 6. 与 plan4.md / OPENBUDDY_PI_NATIVE_PLAN.md 的关系

- `plan4.md`：v6/v7/v8 执行总纲，涵盖 7 个大 phase（A→L）。本计划（plan3.0）是 plan4 的「Phase 7 真实验证 + 收口」拆分。
- `docs/OPENBUDDY_PI_NATIVE_PLAN.md`：历史 v1-v8 路线文档。本计划的所有新评估章节（§29.1 / §29.2）合并到该文档。
- `plan2.0.md`：旧版计划，保留为参考。
- 本文件（`plan3.0.md`）：Phase 7 专属；完成 7.7 后归档到 `docs/plans/phase-7-completion.md`。

不与 plan4 冲突：所有 7.x 改动都不进入 agent-host 微内核或 DSH 退役路径，只在「边界门 + 库存可见性 + UX 引导」三个维度补齐。