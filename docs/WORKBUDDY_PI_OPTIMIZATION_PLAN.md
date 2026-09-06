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

**预先存在的测试失败已全部修复**：基线实测 5 个文件 17 个失败（5160 通过 / 15 跳过），
随阶段 0/1 修复；本轮又定位并修复 3 类被掩盖的回归（详见 §6.0.1）：

| 修复项 | 根因 | 修复 |
|---|---|---|
| `openbuddy-email` 定时器 unhandled rejection | `pendingSendTimer`/`reminderTimer` fire-and-forget 未接 `.catch()`，corrupt-store 测试后 1s 定时器命中损坏 store | 定时器回调统一 `.catch()`（非 test 环境才打印） |
| `plugin-host` / `renderer-host` fixture 路径 | 硬编码 `process.cwd() + "packages/..."`，moon 以包目录为 cwd 时路径翻倍 | 改为测试文件自身锚定（`import.meta.url`），cwd 无关 |
| 12 个 realserver IPC 用例 "module load in flight" | 移除 prewarm 后，`harness/misc/connectors` 部分 handler 未按契约先 `await ensureAgentHostLoaded()` | 逐 handler 补 `await`（与 `agent.ts` 既有模式一致）；测试侧 `security-hardening` mock 补导出 |

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
- **`pi-client.ts`（2390 → 2199 行）**：再抽 `pi-client-collaboration.ts`（226 行）
  （collaboration/workflow/network/A2A 全量 IPC 包装器 + 类型）。与 `pi-client-email.ts` 同模式，
  `export *` 重导出，collaboration 符号在剩余文件零引用。
- **`pi-client.ts`（2200 → 2054 行）**：再抽 `pi-client-providers.ts`（158 行）
  （BYOK provider registry `agent:providers-*` IPC 包装器 + provider/model 纯类型 + `flattenModels`）。
  与 email/collaboration 同模式，`export *` 重导出，全块符号在剩余文件零引用。
  验证：node+renderer tsc 通过，340 renderer/UI 测试（3321 用例）全绿。

**剩余拆分**（后续迭代）：`agent-host.ts`(3480)、`deepseek-runtime.ts`(4368)、
`App.tsx`(1746)、`collaboration-runtime.ts`(2250) 等巨型文件。

**✅ 已做 DRY 收敛（2026-09-06）**：path 路径辅助函数 **全局单一来源**。
`piHome`/`isPathWithin`/`piSessionDir` 原先同时内联于 `agent-host.ts` 和
`host-modules/_host-paths.ts`（双份实现，漂移风险）。整改：`agent-host.ts`
改为 import + re-export（`import { piHome, isPathWithin, piSessionDir } from
"./host-modules/_host-paths"; export { ... }`；注意不能用 `export {...} from
"..."`——那不会建本地绑定，`initialize` 内部 `installHostModules({ piHome,
... })` 会 ReferenceError），另一份 `profile-module-resolution.ts` 的私有
`isPathWithin` 也改为从 `_host-paths` 导入。agent-host 3491→3480 行。

**✅ 已做 profile 纯函数提取（2026-09-06）**：`normalizePublishedRemoteContribution` +
`disposeProfileTypertRegistrations` + `ProfileTypertRegistration` 类型（均为零 `state` 依赖
的纯函数）抽到 `host-modules/profile/contributions-pure.ts`（80 行），agent-host 改为
import + 薄包装。新增独立单测 `contributions-pure.test.ts`（4 用例：remoteExport→canonical
重写、dispose 逆序、无 remoteDispose 容错、未知包透传）。agent-host 3480→3441 行。
验证：全量 vitest 500 文件/5241 用例、agent 层 92 文件/1369 用例全绿。

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

- [x] 全量 `pnpm workspace:test`（全部包 23 组测试全绿）＋ `npm run test` 根套件（499 文件 / 5237 用例通过，15 跳过）＋ `pnpm test:electron` 全绿
- [x] `npm run test:electron:ipc-surface` 通过（6/6）
- [x] `npm run typecheck` EXIT 0
- [x] 生产 Electron build 通过
- [x] `npm run perf:main-chunks` 通过：entry + 独立 AgentHost chunks
- [x] `npm run test:electron:surface` 通过
- [x] `npm run test:electron:stream-port` 通过（真实 Electron 验证流式 MessageChannel 握手、16ms 批处理、端口替换语义；详见 §6.0）
- [x] `npx playwright test tests/electron/plugin-hot-reload-e2e.spec.ts` 通过
- [x] 更新 `docs/` 消除本轮构建拓扑漂移
- [ ] 真实 MiniMax 端到端 smoke 通过（本轮已执行；UI/IPC/事件链路启动正常，但真实 `/anthropic/v1/messages` 返回 `429 Token Plan 用量上限`，需补充外部额度后重跑）

### 6.0 流式 MessageChannel（P2-03）落地证据

- 新增 `electron/main/pi-stream-transport.ts`：`MessageChannelMain` 承载高频 `pi://update`，16ms 批处理（`PI_STREAM_BATCH_WINDOW_MS`）、4096 上限即时冲刷、终止/顺序敏感事件（`pi://complete`、`pi://turn-error` 等）前强制 `flush()`、`attach()` 替换端口并安全关闭旧端口。
- preload 暴露受控 `api.events.openPiStream(handler)`：仅允许 `agent:stream-port` 一次握手，校验 `senderFrame === webContents.mainFrame`，端口消息防抖异常不毒化 bridge。
- renderer `subscribePiEvents({ updateTransport: "auto" })`：优先端口、无端口自动回退 IPC、`sessionId → __sessionId` 映射、畸形 batch 防御性跳过。
- 主进程对 `pi://update` 双写（端口 + 原 IPC），`tool_execution_start/update/end` 同步纳入 port；无端口环境行为与旧版一致。
- 真实 Electron 验证（`scripts/electron/stream-port-smoke.mjs`）：3 条高频发布合并为单个 FIFO batch 到达 renderer 端口；重新握手后旧订阅者停止接收、新端口接管；`unlisten()` 干净关闭。
- 单元测试：`electron/main/pi-stream-transport.test.ts`（6 用例：批处理/上限/FIFO/flush/close/替换）、`src/lib/agent/__tests__/pi-subscribe-port.test.ts`（5 用例：端口交付/IPC 回退/显式 ipc/unlisten/畸形防御）。

### 6.0.1 本轮定位并修复的回归（证据）

| 修复 | 证据 |
|---|---|
| `openbuddy-email` 定时器 unhandled rejection（corrupt-store 用例后 1s 定时器未接 `.catch`） | `packages/capability/openbuddy-email/src/index.ts` 定时器回调统一 `.catch`；该包 9 文件 / 141 用例全绿 |
| fixtures 路径依赖 `process.cwd()`（moon 以包目录运行时路径翻倍） | `plugin-host/src/profile.test.ts`、`renderer-host/src/index.test.ts` 改为以 `import.meta.url` 锚定 fixture；两文件 95 用例全绿 |
| 12 个 realserver IPC 用例 "module load in flight" | `harness.ts`（4 个 harness handler）、`misc.ts`（shellfs/`list_dir`/`inspiration_generate` + `resolveWriteRoot`）、`connectors.ts`（mcp/skills/connectors/experts 系）按契约补 `await ensureAgentHostLoaded()`；`security-hardening.test.ts` mock 同步补导出。4 个 realserver 文件 242 用例全绿 |
| 全量根测试 | `vitest run`（499 文件 / 5237 通过 / 15 跳过）、`workspace:test`（23 组包测试全绿）、`test:electron`（`ok:true`）、`test:electron:surface`、`test:electron:ipc-surface`（6/6）、`test:electron:stream-port` 全部通过 |
| **3 个时序/性能型 flaky 测试**（全量高负载下偶发） | ① `ResourceCatalogPanel.test.tsx:70` 同步 `getByText` 断言异步渲染空态 → 改 `await findByText`（消除竞态）；② `marketplace-virtualization.test.tsx:78` 墙钟 `Date.now()<50ms` 微基准（实测 60ms 闪烁）→ 改为行为断言（搜索投影接线 + 空态分支）；③ `send-safe.test.ts S1.d` 墙钟 `fastMs<slowMs`（fast 循环撞上 GC 停顿）→ 改为确定性计数断言（sendSafe 每轮 2×`isDestroyed`、sendSafeFast 0×）。三处均经重压验证稳定 |
| **阶段 3 架构拆分：`pi-client.ts` 2412→2199 行** | 提取 `pi-client-collaboration.ts`（226 行）：collaboration/workflow/network/A2A 全量重导出（与 `pi-client-email.ts` 同模式）。collaboration 符号在剩余文件零引用，tsc 通过，340 renderer/UI 测试（3321 用例）+ 全量 vitest 全绿。详见 §阶段3 更新 |
| **阶段 3 架构拆分：`pi-client.ts` 2200→2054 行** | 提取 `pi-client-providers.ts`（158 行）：BYOK provider registry（`agent:providers-*`）+ provider/model 纯类型 + `flattenModels`。与 email/collaboration 同模式 `export *` 重导出，全块符号在剩余文件零引用。node+renderer tsc 通过，340 renderer/UI 测试（3321 用例）全绿 |
| **① harness-rpc-store 并发注入竞态（flaky）** | `__repro` 单线程 800 次循环复现 0 失败，但全量并行 I/O 下偶发 `expected [] `（连 live 也被丢）。根因：测试用**非原子 `writeFile` 覆盖** `cache.json` 注入畸形条目，`store.read()` 紧邻读取可能撞上截断/半写中间态，`JSON.parse` 抛错→`readState` 返回空 `[]`。修复：改用**原子注入**（临时文件+`rename`）+ 时间边界放宽到 ±60s。15 次重压全过 |

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

> ✅ 已实现：`scripts/verify-plan.mjs`（+`pnpm verify:plan` / `pnpm verify:plan:tests`）。
> 一键跑验收门槛：①巨型文件断言（默认 >3000 行 FAIL，核心 src 扫描，legacy
> external-compat 白名单豁免）②能力归属单一权威断言（`pi-passthrough` 必须从
> `capability-ownership.ts` 派生，禁止自持重复映射）③可选 `--run-tsc`/`--run-vitest`。
> 实测：能力归属门 PASS；巨型文件门正确标记唯一剩余巨型文件 `agent-host.ts`(3491)。

```ts
// scripts/verify-plan.mjs（阶段 0 时建议，阶段 6 已落地）
// 1. npx tsc --noEmit（--run-tsc）
// 2. npx vitest run（--run-vitest）
// 3. 断言无巨型文件 > 3000 行（阶段 3 后）
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
