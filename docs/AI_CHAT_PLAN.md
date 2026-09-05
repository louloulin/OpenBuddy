# OpenBuddy AI Chat 对标 pi-web 与 MiniMax 实战改造计划

> 📅 2026-09-05 · 真实 MiniMax-M3 端到端验证 · 状态：进行中

## 1. 真实基线（已验证）

跑了真实 Electron + 真实 MiniMax-M3 模型的端到端 e2e，截图全留存 `docs/screenshots/`：

| Spec | 通过 | 用时 | 验证内容 |
|---|---|---|---|
| `chat-ui-minimax-real.spec.ts` | 6/6 | 54.7s | 单 token / 多行 / 深度思考不泄漏 / follow-up / stop / current-model |
| `minimax-real-roundtrip.spec.ts` | 4/4 | 46.1s | agent:prompt/follow-up/abort/current-model 真实 IPC 链 |
| `chat-ui-streaming.spec.ts` | 7/7 | ~50s | composer-driven 流式 / 隐藏窗口 / reload / 多回合 |
| `chat-flow-echo.spec.ts` | 5/5 | ~25s | echo upstream 下流式 / abort / steer / baseUrl 校验 |
| `chat-flow.spec.ts` | 2/2 | ~10s | 冷启动 Composer 禁用 + 设置面板引导 |
| `session-history-load.spec.ts` | 2/2 | 21.0s | 持久化对话 + 新会话空 transcript |
| `agent-workbench-core / extended` | 30+/30+ | ~3min | agent / mcp / harness / skills / tools IPC 全绿 |
| `bridge-recovery / poisoning` | 4/4 | ~15s | IPC 错误不污染 bridge |

合计 **55+ 真实 e2e 测试通过**，0 失败。

## 2. OpenBuddy vs pi-web：AI Chat 功能差距分析

### 2.1 已经对齐 ✅

| 能力 | openbuddy | pi-web |
|---|---|---|
| 真实流式 + 深度思考 | ✅ 合并在 `MessageItem` | ✅ `MessageView` |
| Composer（多模、附件、@ 引用） | ✅ `Composer.tsx` (1273 行) | ✅ `ChatInput.tsx` (2522 行) |
| ToolCallCard（折叠 + 时长 + 状态） | ✅ `ToolCallCard.tsx` (529 行) | ✅ 类似 |
| Rewind / 回溯 | ✅ `RewindBar.tsx` | ✅ |
| QuestionInlineCard | ✅ | ✅ |
| PermissionInlineCard | ✅ | ✅ |
| SidePanel（文件变化 / 工具详情） | ✅ `ToolSidePanel.tsx` (754 行) | ✅ |
| VirtualizedMessageList | ✅ | ✅ |
| Plan Mode / Plan Banner | ✅ | ✅ |
| Message Queue（steer / follow-up） | ✅ | ✅ |
| 工作区/任务/Subagent/团队侧栏 | ✅ | 类似 |
| Real provider metadata（provider/api/model） | ✅ 测试断言 | — |

### 2.2 OpenBuddy 还缺的（对标 pi-web 的关键 4 项）

| 缺失 | pi-web 实现 | 影响 |
|---|---|---|
| **ChatMinimap**（右侧/底部导航 + 跳到指定消息） | `components/ChatMinimap.tsx` | 长会话定位困难 |
| **BranchNavigator**（会话树分叉/切换） | `components/BranchNavigator.tsx` | Pi 的核心能力，openbuddy 只有平铺历史 |
| **ExtensionStatusBar**（扩展运行时状态条） | `components/ExtensionStatusBar.tsx` | 用户看不到 MCP / hook / skill 实时状态 |
| **ExtensionWidgets**（自定义扩展 UI 卡片） | `components/ExtensionWidgets.tsx` | Pi 扩展生态无法在 openbuddy 落地 |

### 2.3 WorkBuddy 对标的真实差距

| 项 | WorkBuddy | openbuddy | 差距 |
|---|---|---|---|
| 任务分类侧栏 | 三段式"探索/规划/执行" | 二段式 | 标签不全 |
| 工作流市场 | 完整 marketplace | `WorkBuddyImport` 但 UI 不全 | import 后无可视化编辑 |
| 文件浏览器内嵌 chat | 完整 | 简单 `FilePreview` | 弱 |
| 协同 room UI | 完整 | `ProjectCollaborationTab` 雏形 | 待补 |

## 3. 最小改造计划（高内聚低耦合）

### 阶段 A — ChatMinimap（最小、1 包内、5h）

复用现有 `VirtualizedMessageList` + `MessageItem`，**不引入新概念**：

1. 新建 `packages/ui/openbuddy-ui-conversation/src/ChatMinimap.tsx`
   - props: `messages: MessageItem[]`, `onJumpTo(messageId)`
   - 从 message.kind 提取"色块高度"：text = 4px、tool_call = 12px、thought = 8px
   - 用户点击色块 → `messageItemRef[id].scrollIntoView({behavior:'smooth'})`
2. `ChatView.tsx` 中加 sticky 右侧 mini 列（桌面宽度 ≥ 1024 才显示）
3. 复用现有 `--wb-*` 主题令牌，零新 CSS
4. e2e：`tests/electron/chat-minimap.spec.ts` 验证色块数量 = message 数

### 阶段 B — BranchNavigator（依赖 pi-event-bridge 已有的 `sessionTree`，2h）

openbuddy 已经在 `packages/core/openbuddy-session` 暴露 `sessionTree`，但 UI 没有渲染：

1. 新建 `packages/ui/openbuddy-ui-conversation/src/BranchNavigator.tsx`
   - props: `tree: SessionTreeNode[]`, `activeLeafId: string`, `onLeafChange: (leafId) => void`
   - 渲染树（缩进 + 当前 leaf 高亮）
2. 在 `ChatView` 顶部 `<RewindBar>` 旁嵌入
3. e2e：`tests/electron/branch-navigator.spec.ts`

### 阶段 C — ExtensionStatusBar（依赖 pi-bridge 的 `plugin/loaded` 事件，3h）

`pi-event-bridge` 已经在 emit `plugin/loaded` / `plugin/error` / `extensionUiRequest`，openbuddy UI 没消费：

1. 新建 `packages/ui/openbuddy-ui-shared/src/ExtensionStatusBar.tsx`
   - 订阅 `useRendererPluginRuntime()`（已存在 `@/lib/runtime/renderer-plugin-runtime`）
   - 渲染当前 active 的 MCP server / hook / skill 状态
2. 嵌入 `App.tsx` 顶部条
3. e2e：`tests/electron/extension-status.spec.ts`

### 阶段 D — ExtensionWidgets（最小侵入，4h）

1. 新建 `packages/ui/openbuddy-ui-conversation/src/ExtensionWidgets.tsx`
   - 监听 `extensionUiRequest` 事件（已存在）
   - 渲染自定义 React 组件（基于 message 旁边 inline 卡片）
2. e2e：mock 一个 extension widget，验证渲染

### 阶段 E — WorkBuddy 风格"探索/规划/执行"侧栏分段（2h）

不是 pi-web 的能力，但 workbuddy 的特色：

1. 在 `packages/ui/openbuddy-ui-sidebar/src/TaskItem.tsx` 中加 `phase: "explore" | "plan" | "execute"` enum
2. 数据源：复用现有 `useSubagentStore` 中的 `phase` 字段（已存在）
3. CSS：用 `--wb-*` 三色 token

### 阶段 F — `extension-events` 索引化（基础工作，所有阶段的前置）

让 `pi-event-bridge` 把 plugin/loaded/error 事件索引到 `session-store`，便于所有阶段统一消费：

- 修改 `packages/core/openbuddy-session/src/index.ts` 加 `extensions` 索引
- e2e：`tests/electron/extensions-index.spec.ts`

## 4. 性能 / 体验改造（不引入新包）

### 4.1 ChatView 重渲染（已有 commit 但需进一步）
- 当前 `useSessionStore` 用 `shallow`，但 `ChatView` 还订阅了 `useSubagentStore`，整段重渲染
- 拆 `ChatView` 为 `MessageList` + `Composer` + `RightRail` 三个 memo 组件

### 4.2 ToolCallCard 折叠态保留输出预览
- 当前折叠后只能看 kind 标题，看不到 stdout/stderr 摘要
- 在折叠态加首行 ANSI 预览（pi-web 同款）

### 4.3 流式 placeholder 不消失
- `chat-ui-streaming.spec.ts:170` 已经修复（`the streaming placeholder is replaced, not left behind`）
- 复制此模式到 `ToolCallCard` 的"运行中"占位

## 5. 真实验证计划

每次阶段合并到 main 都跑：

```bash
# 真实 MiniMax 端到端
OPENBUDDY_E2E_REQUIRED=1 \
OPENBUDDY_E2E_API_KEY="sk-cp-..." \
OPENBUDDY_E2E_BASE_URL="https://api.minimaxi.com/anthropic" \
OPENBUDDY_E2E_MODEL_ID="MiniMax-M3" \
npx playwright test \
  tests/electron/chat-ui-minimax-real.spec.ts \
  tests/electron/minimax-real-roundtrip.spec.ts \
  tests/electron/chat-ui-streaming.spec.ts \
  tests/electron/chat-flow-echo.spec.ts \
  tests/electron/session-history-load.spec.ts \
  --reporter=list --retries=1
```

新建的每个 e2e spec 也跑同样套件，回归不能断。

## 6. 风险与权衡

- **不复制 pi-web 的整个 ChatWindow**（1397 行 + ChatInput 2522 行 + MessageView 1781 行）：openbuddy 的 Composer/MessageItem 已经更瘦，复用比 fork 划算。
- **BranchNavigator 必须是基于 pi 的 `sessionTree`**，不能自创数据结构（pi-web 也不是自创）。
- **ExtensionWidgets 不能引入新的 IPC**（复用已有 `extensionUiRequest`）。
- **截图脚本 `_screenshot-real-ui.mjs` 必须保持真实 MiniMax**，禁止回退到 echo（已通过视觉验证）。
- **R3.0 commit（thought body textContent）保留**：防止回归。
