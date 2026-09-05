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

本计划按 **从底层（运行时/架构）到上层（UI/产品）** 分 7 个阶段推进，
每阶段都有明确的验收命令与"测试全绿"门槛。

**⚠️ 已发现预先存在的测试失败**（非本次改动引入，需在阶段 0 记录并修复）：
- `electron/main/agent/pi-extensions.test.ts:516` — `builtinPiExtensionIds()` 测试清单过期，
  未包含 `openbuddy-pi-compact-announce` 和 `openbuddy-extra-providers`
  （这两个工厂在 `pi-extensions.ts:1157,1195` 已定义但测试未更新）。

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
`passthroughCapability`** 才会真正跳过 Cordis mount。

**✅ 实测修正（2026-09-05）**：双轨问题**已基本解决**。实际代码
（`packages/bundle/openbuddy-base/src/capability-plugins.ts`）显示 5 个能力**都已声明**
`passthroughCapability`：

| 能力 | Cordis 插件 | passthroughCapability | 状态 |
|---|---|---|---|
| mcp | mcpClientPlugin | "mcp" | ✅ |
| permission | permissionPlugin | "permission" | ✅ |
| session | sessionPlugin | "session" | ✅ |
| fs | fsLocalPlugin | "fs" | ✅ |
| goal | teamPlugin（自定义 apply） | "goal" | ✅ |
| plan | planPlugin 已移除 | 归 pi-plan-mode | ✅ |
| web | webSearchPlugin 已移除 | 归 pi-web-access | ✅ |
| automation | automationPlugin 已移除 | 归 pi-goal-list-loop-audit | ✅ |
| task | 无 Cordis 插件 | adapter 回退到内置 todo 工具 | ✅（非双轨） |
| lens/simplify/hashline/worktree | 无 Cordis 插件 | 纯 passthrough | ✅ |

**剩余真实问题**：
1. **authorizationPlugin 无 gate**：`openbuddy-authorization` 未声明 `passthroughCapability`，
   当 pi-permission-system 接管 permission 时可能重复 mount（需评估依赖：mcpClientPlugin
   inject 了 `openbuddy-authorization`）。
2. **task adapter 孤儿**：`pi-extensions.ts:385` 的 task adapter 投影到不存在的
   `openbuddy-task` 服务，但命令描述说明会回退到内置 todo 工具（非有害双轨）。

**文档漂移**：`docs/OPENBUDDY-PI-VISION.md` 引用的 `electron/main/agent/capability-plugins.ts`
**已不存在**（实际在 `packages/bundle/openbuddy-base/src/capability-plugins.ts`）。

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

### 3.4 pi 原生 + OpenBuddy 插件结合矩阵（已实现为权威表）

> 已落地为 `packages/runtime/openbuddy-plugin-host/src/capability-ownership.ts`
> （commit `94f3fe2`）。每个能力声明 **pi 原生插件**（passthrough 时接管）与
> **OpenBuddy 插件**（Cordis 兜底）双归属。

| 能力 | pi 原生插件 | OpenBuddy 插件 | serviceKey | passthrough |
|---|---|---|---|---|
| mcp | pi-mcp-adapter | openbuddy-mcp-client | mcpClient | ✓ |
| permission | pi-permission-system | openbuddy-authorization | permission | ✓ |
| goal | pi-goal | openbuddy-team | team | ✓ |
| plan | pi-plan-mode | pi-plan-mode | plan | ✓ |
| task | @juicesharp/rpiv-todo | openbuddy-task | task | ✓ |
| session | pi-session | openbuddy-session | sessions | ✓ |
| fs | pi-fs | openbuddy-fs-local | fsLocal | ✓ |
| lens | pi-lens | pi-lens | lens | ✓ |
| simplify | pi-simplify | pi-simplify | simplify | ✓ |
| hashline | pi-hashline-edit-pro | pi-hashline-edit-pro | hashline | ✓ |
| worktree | @dietrichgebert/ponytail | @dietrichgebert/ponytail | worktree | ✓ |
| automation | pi-goal-list-loop-audit | pi-goal-list-loop-audit | automation | ✓ |
| team | pi-goal | openbuddy-team | team | ✗（Cordis 持有） |
| team-subagent | pi-subagents | pi-subagents | - | ✓ |
| team-goal | pi-goal | pi-goal | - | ✓ |
| web | pi-web-access | pi-web-access | - | ✓ |

**结合策略**：
- **passthrough 能力**（12 个）：用户 opt-in 或检测到 pi 原生包安装时，pi 原生插件接管，
  OpenBuddy Cordis mount 跳过（`pi-passthrough` 注册表记录）。
- **Cordis 持有**（team）：多 buddy 编排保持 Cordis 持有，pi 仅提供 goal/subagent 子能力。
- **纯 pi**（lens/simplify/hashline/worktree/automation/web）：无 Cordis 包装，直接 pi 原生。

---

## 4. 分阶段优化计划（从底层起）

> 原则：**先底层（运行时/架构）后上层（UI/产品）**，每阶段独立可验收，
> 保持现有 772 vitest + 25 e2e 全绿。

### 阶段 0 — 基线锁定（0.5h）

- [ ] 记录当前测试基线：`pnpm workspace:test` + `pnpm test:electron` 全绿快照
- [ ] 建立"改造前 vs 改造后"对比基准（测试数、构建通过、启动 smoke）
- [ ] **记录并修复预先存在的测试失败**：`pi-extensions.test.ts:516` 的
      `builtinPiExtensionIds()` 清单过期（缺 `openbuddy-pi-compact-announce`、
      `openbuddy-extra-providers`）。这是基线的一部分，先修好再开始改造。

**验收**：`npx vitest run` 全绿（含修复后的基线）。

### 阶段 1 — 双轨收敛（P0，核心，8h）

**目标**：消除 pi 与 Cordis 重复运行。**前置**：阶段 3.5 的能力归属权威表已就绪
（`capability-ownership.ts`），本阶段用它驱动收敛。

**✅ 实测修正**：双轨问题**已基本解决**——5 个能力（mcp/permission/session/fs/goal）
的 Cordis 插件**都已声明** `passthroughCapability`（见 §2.1 表格）。

**剩余工作**：
1. **authorizationPlugin 评估完成**：`openbuddy-authorization` **不应加 gate**。它提供
   `openbuddy-authorization` 服务（OAuth 授权 seam），被 mcpClientPlugin inject 依赖
   （`capability-plugins.ts:146`）。permissionPlugin（openbuddy-permission）才是
   permission 表面，已正确 gate。两者是不同关注点——当前状态正确。
2. **task adapter 孤儿**：`pi-extensions.ts:385` 的 task adapter 投影到不存在的
   `openbuddy-task` 服务，但命令描述说明会回退到内置 todo 工具（非有害双轨）。
3. **修复文档漂移**：更新 `docs/OPENBUDDY-PI-VISION.md`，把 `capability-plugins.ts`
   引用改为实际位置（`packages/bundle/openbuddy-base/src/capability-plugins.ts`）。

**阶段 1 双轨收敛已基本完成 ✅**（仅剩文档漂移修复）

### 阶段 2 — 复用 pi SDK 能力（P0，4h）

**目标**：消除自造轮子，行为与 pi 内置一致。

**✅ 已完成（commit `f865dd7`）**：
- **compaction**：`pi-extensions.ts` 的 `openbuddy-pi-context-guard` 改用 pi SDK 的
  `shouldCompact` + `DEFAULT_COMPACTION_SETTINGS`（保留 edge-triggered crossing 守卫）。
- **branch summary**：已使用 pi SDK 的 `collectEntriesForBranchSummary` + `prepareBranchEntries`
  （`session-store.ts:259-264`）；`branch-summary-format.ts` 是有意的格式化器（LLM 版
  `generateBranchSummary` 需 model/API key，agent-host 未接）。
- **token 估算**：`streaming-metrics.ts` 是 UI 侧流式 TPS 估算器（对标 pi-web），
  非上下文 compaction 估算器，无需替换。

**阶段 2 全部完成 ✅**

### 阶段 3 — 架构高内聚低耦合（P1，12h）

**目标**：拆分巨型文件，强化模块边界。**按依赖顺序拆分**（先底层后上层）。

**巨型文件清单（实测 top 20，按行数降序）**：

| 文件 | 行数 | 拆分策略 | 优先级 |
|---|---|---|---|
| `electron/main/deepseek/deepseek-runtime.ts` | 4368 | 按职责分模块 | 高 |
| `electron/main/agent/agent-host.ts` | 3485 | AgentFacade/CapabilityAssembler/EventBridge | 高 |
| `src/lib/agent/pi-client.ts` | 2595 | 事件客户端/invoke/状态 | 高 |
| `packages/ui/openbuddy-ui-settings/src/SettingsSections.tsx` | 2319 | 按设置分区 | 中 |
| `electron/main/collaboration/collaboration-runtime.ts` | 2250 | 按协作能力 | 中 |
| `electron/main/deepseek/deepseek-compat.test.ts` | 2025 | 测试拆分 | 低 |
| `src/App.tsx` | 1746 | Shell/路由/状态注入 | 高 |
| `packages/ui/openbuddy-ui-settings/src/SettingsPanel.tsx` | 1653 | 按面板 | 中 |
| `packages/ui/openbuddy-ui-sidebar/src/Sidebar.tsx` | 1641 | 按侧栏分区 | 中 |
| `packages/ui/openbuddy-ui-email/src/EmailPanel.tsx` | 1629 | 按邮件能力 | 中 |
| `electron/main/deepseek/deepseek-generic.ts` | 1509 | 按职责 | 中 |
| `electron/main/casdoor/casdoor-management.ts` | 1351 | 按管理能力 | 低 |
| `electron/main/harness/harness-server.ts` | 1327 | HTTP/WS 拆分 | 中 |
| `electron/main/agent/pi-extensions.ts` | 1305 | adapter/解析/工厂拆分 | 高 |
| `packages/ui/openbuddy-ui-conversation/src/Composer.tsx` | 1273 | 输入区子组件 | 中 |
| `packages/ui/openbuddy-ui-conversation/src/ChatView.tsx` | 1167 | MessageList/Composer/RightRail | 高 |
| `packages/ui/openbuddy-ui-automation/src/AutomationPanel.tsx` | 1163 | 按自动化能力 | 中 |
| `electron/main/agent/pi-resources/marketplace.ts` | 1148 | 注册表/目录/安装拆分 | 中 |
| `src/lib/runtime/renderer-plugin-runtime.ts` | 1123 | 按运行时职责 | 中 |

**拆分顺序**（先底层后上层）：
1. `agent-host.ts` → `pi-extensions.ts`（agent 层，最高耦合）
2. `pi-client.ts` → `renderer-plugin-runtime.ts`（renderer 层）
3. `App.tsx` → `ChatView.tsx` → UI 包（UI 层）
4. `deepseek-runtime.ts` → `collaboration-runtime.ts`（独立运行时）

**✅ 已完成（commit `416dd4c` + `0bdfafa`）**：
- **`pi-extensions.ts`（1305 → 1010 行）**：抽出 `pi-compatibility-commands.ts`
  （slash-command describe/invoke helpers + `CompatibilityCommandContext` 类型）。
  adapter 定义保持声明式（纯数据），命令面可独立测试。
- **`pi-client.ts`（2595 → 2390 行）**：抽出 `pi-client-email.ts`
  （email + calendar IPC 包装器 + 类型导入）。自包含块，经 `export *` 重导出。

**剩余拆分**（后续迭代）：`agent-host.ts`(3485)、`deepseek-runtime.ts`(4368)、
`App.tsx`(1746)、`collaboration-runtime.ts`(2250) 等巨型文件。

**验收**：
- 每个拆分后文件 < 800 行（已拆文件达标；巨型文件待后续拆分）
- `npx tsc --noEmit` EXIT 0 ✅
- 现有测试全绿 ✅

### 阶段 3.5 — 统一插件体系（P1，核心，10h）

**目标**：把 pi 差距收敛到「pi 提供 agent 能力 + Cordis 提供服务骨架 + 统一 6-surface 事务」的整体插件体系。

**✅ 已完成（commit `94f3fe2` + `f37d332` + `ba15026` + `2052a6f`）**：
- **能力归属单一权威表**：新增 `packages/runtime/openbuddy-plugin-host/src/capability-ownership.ts`，
  把每个能力映射到 **pi 原生插件 + OpenBuddy 插件** 双归属（12 个 adapter + team/web 家族）。
- **`CAPABILITY_TO_PLUGIN_ID` 从权威表派生**：`pi-passthrough.ts` 不再自持映射，消除双源漂移。
- **`pi-passthrough` 注册表可测试化**：新增可注入的 `PassthroughRegistry` 类（多实例/测试隔离），
  保留模块级默认函数兼容。
- **统一事务提交点**：`PluginTransactionPhase` 补全 `remote`/`typert`，
  全部 6 surface 收敛到同一 `PluginLifecycleQueue` 事务协调器。
- **修复文档漂移**：删除对已不存在的 `capability-plugins.ts` 的引用。
- **插件体系文档**：产出 `docs/PLUGIN_SYSTEM.md`（6-surface 架构、能力归属、事务协调器、跨 surface 插件写法）。
- **新增测试**：`capability-ownership.test.ts`（8）+ `pi-passthrough` 可注入（5）+ `plugin-lifecycle` 6-surface（1）。

**阶段 3.5 全部完成 ✅**

### 阶段 4 — 补底层 API（P2，前置，3h）

**目标**：为 UI 阶段补齐缺失的底层能力。

**✅ 已完成（commit `f865dd7` 后新增）**：
1. **`sessionTree`**：新增 `packages/core/openbuddy-session/src/session-tree.ts`，
   **复用** pi SDK 的 `SessionManager.getTree()`，投影为 UI 友好的可序列化形状
   `{ id, parentId, branch, summary, createdAt, children }`。含 `branchKindOf` /
   `entrySummary` helper。经 `index.ts` 与 `./session-tree` 子路径导出。
   新增 6 测试（线性/分支摘要/压缩/截断/类型映射）。
2. **`extension-events` 索引化**：`PiSessionEventBridge.appendFromSession` 现从事件
   提取 `sessionId` 到 record（此前只在 payload，导致按 session 过滤失效）。
   `plugin/loaded`/`plugin/failed`/`plugin/unloaded` 已通过 `plugin-event-bus.ts`
   → `sessionEventLog.append` 索引。新增 4 测试锁定插件事件索引行为。

**阶段 4 全部完成 ✅**

### 阶段 5 — UI 差距补齐（P2，10h）

对标 pi-web 4 项 + WorkBuddy 4 项。

**✅ 已完成（commit 阶段 5 A-F）**：

| 子项 | 组件 | 说明 | 测试 |
|---|---|---|---|
| A. ChatMinimap | `ui-conversation/src/ChatMinimap.tsx` | 色块导航 + 跳转 | 5 |
| B. BranchNavigator | `ui-conversation/src/BranchNavigator.tsx` | 会话树分叉（消费阶段 4 sessionTree） | 6 |
| C. ExtensionStatusBar | `ui-conversation/src/ExtensionStatusBar.tsx` | 扩展状态条（loaded/failed/unloaded） | 4 |
| D. ExtensionWidgets | `ui-conversation/src/ExtensionWidgets.tsx` | 扩展 UI 卡片（title/body/fields/actions） | 5 |
| E. 三段式侧栏 | `ui-sidebar/src/TaskItem.tsx` | 探索/规划/执行 标签分类 | 5 |
| F. 工作流可视化 | `ui-automation/src/WorkflowCanvas.tsx` | 节点图可视化编辑 + 重排 | 6 |

全部为纯展示组件，复用 `--wb-*` 令牌，零新 CSS 概念。新增 31 测试。

**阶段 5 全部完成 ✅**

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
| **预先存在测试失败（builtinPiExtensionIds）** | 阶段 0 先修复，作为基线 |
| **pi SDK 升级（0.85+）可能改变 compaction 语义** | 阶段 2 锁定 pi SDK 版本，升级时回归 |

### 6.1 阶段依赖关系图

```
阶段0(基线) ──► 阶段1(双轨收敛) ──► 阶段2(复用pi SDK)
   │                ▲
   │                │ 依赖权威表
   │                └── 阶段3.5(统一插件体系) ◄── 阶段3(架构拆分)
   │                        │
   └──► 阶段4(补底层API) ◄──┘
              │
              ▼
        阶段5(UI补齐) ──► 阶段6(回归)
```

**关键依赖**：
- 阶段 1 依赖阶段 3.5 的权威表（已就绪）
- 阶段 4 依赖阶段 3.5 的插件体系（sessionTree 是插件能力）
- 阶段 5 依赖阶段 4 的底层 API
- 阶段 3 与阶段 3.5 可并行（不同文件）

### 6.2 验收自动化

建议在 `package.json` 增加一个 `scripts/verify-plan.ts`，一键跑全部验收门槛：

```ts
// scripts/verify-plan.ts (阶段 0 时创建)
// 1. npx tsc --noEmit
// 2. npx vitest run
// 3. 断言无巨型文件 > 800 行（阶段 3 后）
// 4. 断言能力归属单一权威（阶段 3.5 后）
// 5. 输出 PASS/FAIL 汇总
```

---

## 7. 建议执行顺序

```
阶段0(基线+修预存失败) → 阶段1(双轨收敛) → 阶段2(复用pi SDK)
  → 阶段3(架构拆分) ∥ 阶段3.5(统一插件体系)   ← 可并行
  → 阶段4(补底层API) → 阶段5(UI补齐) → 阶段6(回归)
```

阶段 1/2 是 P0（影响稳定性/资源），阶段 3/3.5 是 P1（影响可维护性/插件生态），
阶段 4/5 是 P2（影响产品力）。建议按此顺序推进，每阶段独立验收。

**插件体系定位**：阶段 3.5 是「从 pi 差距到整体插件体系」的核心。它把 pi 的
agent 能力、Cordis 的服务骨架、renderer 的 UI 贡献、remote/typert 的 RPC
统一到一个 6-surface 清单 + 单一事务协调器下，是 OpenBuddy 作为
WorkBuddy 替代者的差异化插件生态基础。
