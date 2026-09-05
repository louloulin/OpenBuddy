# OpenBuddy → WorkBuddy 替代者：全面分析 + 差距对比 + 分阶段优化计划

> 📅 2026-09-05 · 分支 `feature/workbuddy-pi-optimization`
> 目标：把 OpenBuddy 从"双轨混合"收敛为 **pi 优先 + Cordis 兜底** 的薄包装，
> 对标 WorkBuddy 补齐产品力，同时保持高内聚低耦合架构与现有测试全绿。
> 本文所有论断均引用 `文件:行号`，可复核。

---

## 0. 执行摘要

OpenBuddy 是一个 **60% 已基于 pi** 的 WorkBuddy 风格桌面 AI 工作区
（Electron + Cordis + Pi）。它已经跑通真实 MiniMax-M3 端到端链路、
55+ 真实 e2e、772 个 vitest 测试文件。**它不是从零开始，而是需要"收敛与瘦身"**。

核心矛盾：**pi 与 Cordis 双轨并行**导致资源双倍占用、行为漂移、文档与代码脱节。
同时存在大量巨型文件（最高 4368 行）破坏高内聚低耦合，以及若干对标
WorkBuddy / pi-web 的 UI 能力缺口。

本计划按 **从底层（运行时/架构）到上层（UI/产品）** 分 6 个阶段推进，
每阶段都有明确的验收命令与"测试全绿"门槛。

---

## 1. 现状总览（已核实）

### 1.1 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| Shell | Electron | 44 |
| 渲染 | React 18 + Vite 5 + Zustand 4 | - |
| Agent 运行时 | `@earendil-works/pi-coding-agent` | **0.84.3** |
| 能力框架 | Cordis | 3 |
| MCP | @modelcontextprotocol/sdk | 1.25 |
| Monorepo | moon + pnpm | 2.5 / 11 |
| 测试 | Vitest + Playwright | - |

### 1.2 规模

- **63 个 workspace 包**（runtime/auth/capability/collaboration/core/fs/payment/saml/scim/shared/team/ui/webhook-outbox）
- **26 个 UI 包**（`packages/ui/openbuddy-ui-*`，每个都有 `src/index.ts` + `src/client.tsx` + `invariant.ts`）
- **772 个 vitest 测试文件** + **25 个 Playwright e2e spec**
- 三层架构：React Renderer → Electron Main + preload → Pi AgentSession + Cordis

### 1.3 三层架构

```
Layer 1: React Renderer (src/, packages/ui/*)
   └─ window.api (typed contextBridge)
Layer 2: Electron Main + preload
   ├─ ipc.ts (白名单 IPC)
   ├─ agent-host.ts (主 owner, 3485 行)
   ├─ pi-event-bridge.ts (pi://* 事件)
   └─ capability-*.ts (Cordis 能力)
Layer 3: Pi AgentSession + Cordis 能力服务
```

---

## 2. 问题诊断（按优先级组织）

### 2.1 【P0】双轨并行：pi 与 Cordis 重复运行

**证据**：`electron/main/agent/pi-extensions.ts` 定义了 **12 个 passthrough adapter**，
每个 `capability` 都声明 `passthrough: true`：

| capability | adapter 行号 | passthrough | 问题 |
|---|---|---|---|
| mcp | :246 | ✓ | 已收敛（Cordis 有 flag） |
| permission | :300 | ✓ | ⚠️ 双轨 |
| goal | :332 | ✓ | ⚠️ 双轨 |
| plan | :369 | ✓ | 纯透传 |
| task | :385 | ✓ | ⚠️ 半双轨（孤儿） |
| session | :434 | ✓ | ⚠️ 双轨 |
| fs | :491 | ✓ | ⚠️ 双轨 |
| lens | :547 | ✓ | 纯白名单 |
| simplify | :556 | ✓ | 纯白名单 |
| hashline | :565 | ✓ | 纯白名单 |
| worktree | :574 | ✓ | 纯白名单 |
| automation | :590 | ✓ | 已收敛 |

**问题本质**：`pi-extensions.ts:945-960` 的 passthrough 机制要求 **Cordis 端也声明
`passthroughCapability`** 才会真正跳过 Cordis mount。但部分 Cordis 服务（permission/
goal/session/fs/task）**没有这个 flag**，导致同一能力 **pi 和 Cordis 各跑一份**：
双倍资源占用 + 行为漂移。

**文档漂移**：`docs/OPENBUDDY-PI-VISION.md` 引用的 `electron/main/agent/capability-plugins.ts`
**已不存在**（已重构进 `openbuddy-core-plugin.ts` + `agent-host.ts`）。文档与代码脱节。

### 2.2 【P0】自造轮子：未复用 pi SDK 能力

**证据**：`electron/main/agent/pi-extensions.ts:1143-1145` 自实现了 compaction 阈值判断：

```ts
if (!crossed || !context.compact) return;
emit("pi/context-compaction-requested", { thresholdTokens: threshold, tokens });
context.compact();
```

但 pi SDK（`pi-agent-core`）已提供 `shouldCompact` / `findCutPoint` /
`prepareCompaction` / `generateSummary` / `estimateContextTokens` 等完整 helper。
自实现会导致：
- token 估算精度与 pi 内置不一致 → 边界情况行为漂移
- pi 升级（如 0.85 的 compaction 改进）OpenBuddy 不会自动跟上

### 2.3 【P1】巨型文件破坏高内聚低耦合

**证据**（`wc -l` 实测）：

| 文件 | 行数 | 职责 |
|---|---|---|
| `electron/main/deepseek/deepseek-runtime.ts` | **4368** | DeepSeek 运行时 |
| `electron/main/agent/agent-host.ts` | **3485** | 主 owner（facade 104 字段） |
| `src/lib/agent/pi-client.ts` | **2595** | 流式事件客户端 |
| `packages/ui/openbuddy-ui-settings/src/SettingsSections.tsx` | **2319** | 设置分区 |
| `electron/main/collaboration/collaboration-runtime.ts` | **2250** | 协作运行时 |
| `src/App.tsx` | **1746** | 根组件 |
| `packages/ui/openbuddy-ui-sidebar/src/Sidebar.tsx` | **1641** | 侧栏 |
| `packages/ui/openbuddy-ui-email/src/EmailPanel.tsx` | **1629** | 邮件面板 |
| `electron/main/harness/harness-server.ts` | **1327** | 自建 HTTP/WS 服务器 |
| `packages/ui/openbuddy-ui-conversation/src/Composer.tsx` | **1273** | 输入框 |

**问题**：这些文件承担了过多职责，违反单一职责原则。`agent-host.ts` 同时是
facade、生命周期 owner、capability 装配点、事件桥接点。改动一处容易牵一发动全身。

### 2.4 【P1】UI 重渲染与性能

**证据**：`docs/AI_CHAT_PLAN.md` §4.1 指出 `ChatView` 订阅 `useSubagentStore`
导致整段重渲染。`ChatView.tsx`（1167 行）未拆分为 `MessageList` + `Composer` +
`RightRail` 三个 memo 组件。

### 2.5 【P1】插件体系：pi 差距 → 整体插件体系（结合 Cordis）

**现状（已核实）**：OpenBuddy 已有一个 **6-surface 统一插件清单**：

```
UnifiedPluginManifest.surfaces = bundle | pi | renderer | remote | typert | cordis
```

| 组件 | 位置 | 职责 |
|---|---|---|
| `UnifiedPluginManifest` | `plugin-manifest.ts` | 声明每包的 surface |
| `PluginSnapshot` | `plugin-snapshot.ts` | 每 surface 运行时状态 |
| `pi-passthrough` 注册表 | `pi-passthrough.ts` | 能力归属（pi vs Cordis）单一事实源 |
| `CAPABILITY_TO_PLUGIN_ID` | `pi-passthrough.ts:60-140` | 能力→插件 id 映射 |
| `PluginTransaction` | `plugin-lifecycle.ts` | 事务协调器（prepare/cordis/artifacts/pi/mcp/renderer/rollback/commit） |
| `openbuddy-cordis` | `packages/runtime/openbuddy-cordis` | @cordisjs/core 薄包装 |
| `openbuddy-plugin-host` | `packages/runtime/openbuddy-plugin-host` | 插件宿主 |
| `openbuddy-renderer-host` | `packages/renderer/openbuddy-renderer-host` | renderer 客户端模块系统 |

**pi 作为插件系统的天然差距（Cordis 的补充作用）**：

| pi 差距 | Cordis 补充 | 现状 |
|---|---|---|
| pi 扩展仅限 agent 运行时（tools/hooks/commands） | 服务容器 / DI / 生命周期 | ✅ 已接 |
| pi 无跨进程 RPC | remote / typert surface | ✅ 已接 |
| pi 无 renderer UI 贡献 | renderer surface | ✅ 已接 |
| pi 无统一事务提交点 | `PluginTransaction` 协调器 | ⚠️ 未完全统一 |
| pi 无能力归属解析 | `pi-passthrough` 注册表 | ⚠️ 进程级可变全局 |

**问题**：
1. **文档漂移**：`CAPABILITY_TO_PLUGIN_ID` 注释引用 `capability-plugins.ts`，但该文件**已不存在**（重构进 `openbuddy-core-plugin.ts` + `agent-host.ts`）。
2. **事务协调器未完全统一**：`docs/pi-runtime-next-roadmap.md` P1 明确「Pi/MCP/Remote/Typert/Renderer 仍没有共同的最终 commit marker」，各 surface 候选状态未收敛到同一 transaction coordinator。
3. **`pi-passthrough` 注册表是进程级可变全局**：`pi-passthrough.ts:30` 注释自述「intentionally process-global and mutable」，不利于插件体系的可测试性与可替换性。
4. **能力归属解析分散**：`CAPABILITY_TO_PLUGIN_ID` 与 `pi-extensions.ts` 的 12 个 adapter 定义重复，缺少单一权威。

### 2.6 【P2】对标 pi-web / WorkBuddy 的 UI 能力缺口

**对标 pi-web 缺失 4 项**（`docs/AI_CHAT_PLAN.md` §2.2）：
- ChatMinimap（长会话定位）
- BranchNavigator（会话树分叉/切换）
- ExtensionStatusBar（扩展运行时状态条）
- ExtensionWidgets（自定义扩展 UI 卡片）

**对标 WorkBuddy 缺失 4 项**（§2.3）：
- 任务分类侧栏（三段式"探索/规划/执行"）
- 工作流市场（import 后无可视化编辑）
- 文件浏览器内嵌 chat
- 协同 room UI

**⚠️ 文档漂移**：`AI_CHAT_PLAN.md` 声称 `packages/core/openbuddy-session` 已暴露
`sessionTree` / `SessionTreeNode`，但**实测不存在**（`grep` 为空）。BranchNavigator
计划依赖一个不存在的 API，需先补底层。

---

## 3. WorkBuddy 差距对比

### 3.1 已对齐 ✅

| 能力 | OpenBuddy | 证据 |
|---|---|---|
| 真实流式 + 深度思考 | ✅ | `MessageItem` |
| Composer（多模/附件/@） | ✅ | `Composer.tsx` |
| ToolCallCard（折叠/时长/状态） | ✅ | `ToolCallCard.tsx` |
| Rewind / 回溯 | ✅ | `RewindBar.tsx` |
| Plan Mode / Plan Banner | ✅ | - |
| Message Queue（steer/follow-up） | ✅ | - |
| 工作区/任务/Subagent/团队侧栏 | ✅ | - |
| 真实 provider metadata | ✅ | 测试断言 |

### 3.2 差距（需补齐）

| 维度 | WorkBuddy | OpenBuddy | 差距 | 阶段 |
|---|---|---|---|---|
| 任务分类侧栏 | 三段式"探索/规划/执行" | 二段式 | 标签不全 | E |
| 工作流市场 | 完整 marketplace | import 后无可视化编辑 | 弱 | E |
| 文件浏览器内嵌 chat | 完整 | 简单 FilePreview | 弱 | E |
| 协同 room UI | 完整 | ProjectCollaborationTab 雏形 | 待补 | E |
| 会话树分叉 | BranchNavigator | 平铺历史 | 缺 | B |
| 扩展状态条 | ExtensionStatusBar | 无 | 缺 | C |
| 扩展 UI 卡片 | ExtensionWidgets | 无 | 缺 | D |
| 长会话定位 | ChatMinimap | 无 | 缺 | A |

### 3.3 插件体系差距（结合 Cordis）

| 维度 | WorkBuddy | OpenBuddy | 差距 | 阶段 |
|---|---|---|---|---|
| 插件生态 | 完整 marketplace + 可视化编辑 | 6-surface 清单 + import | 事务未统一、能力归属分散 | 3.5 |
| 服务容器 | 完整 DI/生命周期 | Cordis 薄包装 | 已接，需统一事务 | 3.5 |
| 跨进程 RPC | 完整 | remote/typert surface | 已接，需统一 commit | 3.5 |
| renderer UI 贡献 | 完整 | renderer surface | 已接，需统一 commit | 3.5 |

---

## 4. 分阶段优化计划（从底层起）

> 原则：**先底层（运行时/架构）后上层（UI/产品）**，每阶段独立可验收，
> 保持现有 772 vitest + 25 e2e 全绿。

### 阶段 0 — 基线锁定（0.5h）

- [ ] 记录当前测试基线：`pnpm workspace:test` + `pnpm test:electron` 全绿快照
- [ ] 建立"改造前 vs 改造后"对比基准（测试数、构建通过、启动 smoke）

### 阶段 1 — 双轨收敛（P0，核心，8h）

**目标**：消除 pi 与 Cordis 重复运行。

1. **审计真实双轨状态**：逐个检查 12 个 capability 的 Cordis 端是否声明
   `passthroughCapability`。对 permission/goal/session/fs/task 补 flag。
2. **收敛 session/fs**：`pi-extensions.ts:434`(session) 与 `:491`(fs) 的 adapter
   已 `passthrough: true`，但 Cordis 端没 flag → 补 flag 后删 Cordis mount。
3. **清理 task 孤儿**：`pi-extensions.ts:385`(task) 的 adapter 与 Cordis mount
   不对应 → 二选一收敛。
4. **修复文档漂移**：更新 `docs/OPENBUDDY-PI-VISION.md`，把 `capability-plugins.ts`
   引用改为实际位置（`openbuddy-core-plugin.ts` + `agent-host.ts`）。

**验收**：
- `grep -rn 'passthroughCapability' packages/capability/` 覆盖 5 个双轨能力
- 启动后 `process` 资源占用下降（无重复 mount）
- 现有测试全绿

### 阶段 2 — 复用 pi SDK 能力（P0，4h）

**目标**：消除自造轮子，行为与 pi 内置一致。

1. **compaction**：`pi-extensions.ts:1143-1145` 改用 pi SDK 的
   `shouldCompact` / `findCutPoint` / `prepareCompaction` / `generateSummary`。
2. **branch summary / fork**：若 `pi-agent-core` 提供，替换自实现。
3. **token 估算**：用 `estimateContextTokens` 替代手写估算。

**验收**：
- `pi-extensions.test.ts` 中 compaction 相关断言更新为 pi SDK 语义
- 真实 MiniMax 长会话压缩行为与 pi 内置一致
- 现有测试全绿

### 阶段 3 — 架构高内聚低耦合（P1，12h）

**目标**：拆分巨型文件，强化模块边界。

1. **拆分 `agent-host.ts`（3485 行）**：
   - 抽出 `AgentFacade`（104 字段的薄门面）
   - 抽出 `CapabilityAssembler`（capability 装配点）
   - 抽出 `EventBridge`（事件桥接）
2. **拆分 `deepseek-runtime.ts`（4368 行）**：按职责分模块。
3. **拆分 `pi-client.ts`（2595 行）**：事件客户端 / invoke / 状态。
4. **拆分 `App.tsx`（1746 行）**：Shell 布局 / 路由 / 状态注入。
5. **拆分 `ChatView.tsx`（1167 行）**：`MessageList` + `Composer` + `RightRail`
   三个 memo 组件，消除 `useSubagentStore` 整段重渲染。

**验收**：
- 每个拆分后文件 < 800 行
- `npx tsc --noEmit` EXIT 0
- 现有测试全绿

### 阶段 3.5 — 统一插件体系（P1，核心，10h）

**目标**：把 pi 差距收敛到「pi 提供 agent 能力 + Cordis 提供服务骨架 + 统一 6-surface 事务」的整体插件体系。

1. **修复文档漂移**：更新 `CAPABILITY_TO_PLUGIN_ID` 注释，把 `capability-plugins.ts` 引用改为实际位置（`openbuddy-core-plugin.ts` + `agent-host.ts`）。
2. **统一事务提交点**：把 `PluginTransaction` 的 commit 阶段扩展到所有 surface（pi/mcp/remote/typert/renderer），让各面候选状态收敛到同一 transaction coordinator，产出共同 commit marker。
3. **收敛能力归属单一权威**：把 `CAPABILITY_TO_PLUGIN_ID` 与 `pi-extensions.ts` 的 12 个 adapter 定义合并为单一权威表，消除重复。
4. **`pi-passthrough` 注册表可测试化**：把进程级可变全局改为可注入的 registry（支持 reset/快照），便于插件体系测试。
5. **插件体系文档**：产出 `docs/PLUGIN_SYSTEM.md`，描述 6-surface 架构、能力归属解析、事务协调器、如何写一个跨 surface 插件。

**验收**：
- `PluginTransaction` 覆盖全部 6 surface 的 commit
- 能力归属单一权威表（无重复定义）
- `pi-passthrough` 注册表可注入/可测试
- 新增 `tests/electron/plugin-system.spec.ts`
- 现有测试全绿

### 阶段 4 — 补底层 API（P2，前置，3h）

**目标**：为 UI 阶段补齐缺失的底层能力。

1. **`sessionTree`**：在 `packages/core/openbuddy-session` 暴露
   `SessionTreeNode` / `sessionTree`（BranchNavigator 依赖，当前不存在）。
2. **`extension-events` 索引化**：`pi-event-bridge` 把 `plugin/loaded` /
   `plugin/error` / `extensionUiRequest` 索引到 session-store。

**验收**：
- `packages/core/openbuddy-session` 导出 `sessionTree`
- 新增 `tests/electron/extensions-index.spec.ts`

### 阶段 5 — UI 差距补齐（P2，10h）

对标 pi-web 4 项 + WorkBuddy 4 项：

| 子项 | 位置 | 说明 |
|---|---|---|
| A. ChatMinimap | `ui-conversation/src/ChatMinimap.tsx` | 色块导航 + 跳转 |
| B. BranchNavigator | `ui-conversation/src/BranchNavigator.tsx` | 会话树分叉 |
| C. ExtensionStatusBar | `ui-shared/src/ExtensionStatusBar.tsx` | 扩展状态条 |
| D. ExtensionWidgets | `ui-conversation/src/ExtensionWidgets.tsx` | 扩展 UI 卡片 |
| E. 三段式侧栏 | `ui-sidebar/src/TaskItem.tsx` | 探索/规划/执行 |
| F. 工作流市场可视化 | `ui-automation` | import 后可编辑 |

**验收**：
- 每个子项新增对应 e2e spec
- 复用 `--wb-*` 令牌，零新 CSS 概念
- 现有测试全绿

### 阶段 6 — 回归与发布（2h）

- [ ] 全量 `pnpm workspace:test` + `pnpm test:electron` 全绿
- [ ] `npx tsc --noEmit` EXIT 0
- [ ] 生产 Electron build 通过
- [ ] 真实 MiniMax 端到端 smoke 通过
- [ ] 更新 `docs/` 消除文档漂移

---

## 5. 验证标准（贯穿所有阶段）

| 门槛 | 命令 | 必须 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | EXIT 0 |
| 单测 | `pnpm workspace:test` | 全绿 |
| e2e | `pnpm test:electron` | 全绿 |
| 构建 | `pnpm build` | 通过 |
| 真实链路 | `npm run test:electron:real-ui` | 通过 |

**铁律**：任何阶段不得破坏现有测试。若某阶段导致测试失败，先回滚该阶段，
再以更小粒度重试。

---

## 6. 风险与依赖

| 风险 | 缓解 |
|---|---|
| 双轨收敛可能改变行为 | 每收敛一个能力就跑对应测试 |
| 巨型文件拆分可能引入回归 | 拆分与测试同步，小步提交 |
| `sessionTree` 需从零实现 | 阶段 4 前置，先补底层 |
| 文档漂移误导 | 阶段 1/6 同步更新文档 |

---

## 7. 建议执行顺序

```
阶段0(基线) → 阶段1(双轨收敛) → 阶段2(复用pi SDK)
  → 阶段3(架构拆分) → 阶段3.5(统一插件体系)
  → 阶段4(补底层API) → 阶段5(UI补齐) → 阶段6(回归)
```

阶段 1/2 是 P0（影响稳定性/资源），阶段 3/3.5 是 P1（影响可维护性/插件生态），
阶段 4/5 是 P2（影响产品力）。建议按此顺序推进，每阶段独立验收。

**插件体系定位**：阶段 3.5 是「从 pi 差距到整体插件体系」的核心。它把 pi 的
agent 能力、Cordis 的服务骨架、renderer 的 UI 贡献、remote/typert 的 RPC
统一到一个 6-surface 清单 + 单一事务协调器下，是 OpenBuddy 作为
WorkBuddy 替代者的差异化插件生态基础。
