# OpenBuddy AI Chat UI 执行级完善计划

> 📅 2026-09-23 · P0-AI-Chat-Audit 完善轮
> 上游:`docs/AI_CHAT_UI_AUDIT.zh-CN.md`(第 1 轮)+ `docs/AI_CHAT_FULL_AUDIT.zh-CN.md`(第 2 轮)
> 性质:**执行级** — 每项都有验收标准 / 文件锚点 / 依赖 / 风险 / 性能预算 / a11y 目标 / 回滚方案
> 目标读者:任何工程师 / agent 拿到即可按阶段施工,**不需要再决策**

## 〇、阅读指引

- **第 1 章** — 阶段划分(Phase 0~3,五天 12 周节奏)
- **第 2 章** — 通用约定(命名 / token / motion / 性能预算 / a11y / 键盘)
- **第 3 章** — 每项改造的**执行单**(28 张单)
- **第 4 章** — 依赖矩阵(谁挡谁)
- **第 5 章** — Codex 风格参考(具体规范)
- **第 6 章** — 验收门禁(每件套可测)
- **第 7 章** — 回滚预案(每件套独立可回)
- **第 8 章** — 风险登记(高/中/低)
- **第 9 章** — 自动化测试矩阵
- **第十章** — 交付物清单 + 命令速查

## 一、阶段划分

| 阶段 | 时间 | 目标 | 关键交付 | 验证手段 |
|---|---|---|---|---|
| **Phase 0** | 1 天 | 把现有 P0 风险收掉 | Fix CSS bracket + view tabs + 短标签 + 13 个 pre-existing failure 根因 | `npx electron-vite build` + 全量 vitest 绿 |
| **Phase 1** | 1 周 | 对标 Codex 视觉基础 | 深色主题系统化 / 空状态 v2 hero / ChatView memo 拆 | vitest 100% + electron probe |
| **Phase 2** | 1 周 | 交互范式升级 | 操作图标折叠 / Composer 信息密度 / a11y 补全 / prefers-contrast 全局 | vitest + axe-core + manual a11y |
| **Phase 3** | 2 周 | 性能 + 细节打磨 | ChatView 拆 memo 子组件 / MessageItem 抽 InlineEditActions / Composer hooks 分组 / Reasoning 折叠动画 / 日期分隔符增强 / 性能预算 | Lighthouse + bundle analyzer + 自动化 |

> 总投入:约 **4 周 1 人**。可拆给 2~3 人并行,但 Phase 1 的 memo 拆分与 Phase 2 的操作折叠不能并行(共享 MessageItem 改 33 个快照测试)。

## 二、通用约定

### 2.1 命名规范

- **CSS 类**:BEM-ish + kebab-case,根词 `msg__`、`composer__`、`chatview__`、`conversation-view__`、`timeline__`
- **React 组件**:PascalCase,文件同名,纯展示组件放 `parts/` 或 `chatview/`
- **Hook**:`useXxx`,文件 `useXxx.ts(x)`,副作用集中
- **Store / Slot**:`xxx-store`、`xxx-slot`,放 `packages/ui/openbuddy-ui-state` 或 `packages/ui/openbuddy-ui-runtime`
- **Test**:同目录 `__tests__/Xxx.test.tsx` 或就近 `Xxx.test.tsx`(选最常见模式)

### 2.2 设计 token(全部走 `var(--wb-*)`,禁用硬编码)

| token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--wb-brand` | `#00c29a` | `#00e0a8` | 单一品牌色(主轴) |
| `--wb-bg-primary` | `#ffffff` | `#0f0f12` | 主背景 |
| `--wb-bg-secondary` | `#fafbfc` | `#1a1a1f` | 次背景 |
| `--wb-bg-tertiary` | `#f1f2f5` | `#25252b` | 卡/分组背景 |
| `--wb-text-strong` | `rgba(0,0,0,0.88)` | `rgba(255,255,255,0.92)` | 主文字 |
| `--wb-text-medium` | `rgba(0,0,0,0.6)` | `rgba(255,255,255,0.72)` | 次文字 |
| `--wb-text-soft` | `rgba(0,0,0,0.5)` | `rgba(255,255,255,0.5)` | 弱文字 |
| `--wb-border-soft` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.08)` | 软分隔 |
| `--wb-border-default` | `rgba(0,0,0,0.12)` | `rgba(255,255,255,0.12)` | 默认边框 |
| `--wb-radius-sm/md/lg` | `4 / 8 / 12` px | 同 | 圆角 |
| `--wb-motion-duration-fast` | `120ms` | 同 | 快动画 |
| `--wb-motion-duration-base` | `240ms` | 同 | 基动画 |
| `--wb-motion-duration-slow` | `500ms` | 同 | 慢动画 |
| `--wb-ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | 同 | 主缓动 |

### 2.3 Motion 标准(对标 Codex)

| 场景 | 时长 | 缓动 | token |
|---|---|---|---|
| 微交互(hover / focus / chip 颜色翻转) | 120ms | `ease-out-expo` | `--wb-motion-duration-fast` |
| 列表项出现 / 消息入场 | 240ms | `ease-out-expo` | `--wb-motion-duration-base` |
| 模态/抽屉开合 | 320ms | `ease-out-expo` | `--wb-motion-duration-slow` |
| Streaming caret blink | **250ms**(P3-6 已落) | `ease-in-out` | — |
| 推理卡 brand strip 延伸 | **600ms**(P3-6 已落) | `ease-in-out` | — |
| Reduced motion | `none` | `linear` | `@media (prefers-reduced-motion: reduce)` |

### 2.4 性能预算(必须守住)

| 指标 | 预算 | 测试方法 |
|---|---|---|
| 首屏 LCP(Largest Contentful Paint) | < 1.8s | Lighthouse + electron probe |
| TTI(Time to Interactive) | < 2.5s | Lighthouse |
| ChatView bundle 大小 | < 180 KB(gzipped) | `npx vite-bundle-visualizer` |
| 切换 view(live → result)交互响应 | < 100ms | manual stopwatch + 自定义埋点 |
| 流式光标内存峰值 | < 5 MB | Chrome DevTools memory profile |
| 100 条消息首次渲染 | < 200ms | vitest + 自定义 perf marker |
| VirtualizedMessageList 阈值 | ≥ 50 条触发 | 单测 `shouldUseVirtualList(50) === true` |
| Inline editor 内存 | < 2 MB | DevTools profile |

### 2.5 a11y 目标

- **WCAG 2.2 AA** 全部达标(必须)
- **WCAG 2.2 AAA** 在对比度与焦点环上争取达标(目标)
- **键盘可达**:所有交互元素可 Tab 抵达,顺序符合阅读流
- **焦点环**:`:focus-visible` 2px brand 色 + offset 2px(已有全局兜底)
- **ARIA**:
  - MessageItem `role="article"` `aria-live="polite"` 流式时
  - Composer `role="form"` `aria-label="发送消息"`
  - InlineApprovalHint `role="region"` `aria-label="待审批"`
  - Reasoning 卡 `<details>` + `<summary>` + `aria-expanded`
  - 视图切换器 `role="tablist"` 已有 ✓
- **`prefers-contrast: more`**:所有边框 +1 stroke、字色加深、focus 宽度 → 3px(全局)

### 2.6 键盘快捷键(全聊天面板)

| 快捷键 | 行为 | 文件锚点 |
|---|---|---|
| `Enter` | 发送(非流式时) | `useChatViewShortcuts.ts` |
| `Shift+Enter` | 换行 | 同上 |
| `Cmd/Ctrl+K` | 打开会话搜索 | 新增 `useChatViewCommandK` |
| `Cmd/Ctrl+B` | 切换侧边栏 | `ChatRail.tsx` |
| `Cmd/Ctrl+Shift+L` | 切换主题 | 新增 |
| `Cmd/Ctrl+/` | 打开快捷键面板 | `ChatShortcutOverlay.tsx` 已有 |
| `Cmd/Ctrl+F` | 查找 | `FindBar.tsx` 已有 |
| `↑` / `↓` | 历史消息导航 | `use-input-history.ts` |
| `Esc` | 关闭弹窗 / 退出编辑态 | 全局 `useChatViewShortcuts` |
| `Tab` | 焦点循环 | 全局 |
| `g g` (vim-style) | 跳到首条 | 新增 |
| `G` (vim-style) | 跳到尾条 | 新增 |

### 2.7 焦点顺序(从上到下)

1. 工具栏(返回 / 模型选择 / 主题切换)
2. 会话标题 / breadcrumb
3. 消息列表(可虚拟滚动)
4. Composer 输入框
5. Composer 工具栏(附件 / 语音 / 模型能力 / 发送)
6. Footer(状态 / token 计数 / session 操作)

## 三、执行单(28 张单)

> 每张单包含 **What / 文件锚点 / 验收标准 / Codex 参照 / 风险 / 回滚 / 测试** 七字段

### PHASE 0 — 收尾(1 天)

#### 【P0-01】修 13 个 pre-existing vitest failure 根因

- **What**:在 `vitest.config.ts` 加 `resolve.alias` 把 `@openbuddy/ui-state/global-confirm-store` 直接指向 `packages/ui/openbuddy-ui-state/src/global-confirm-store.ts`,绕过 vite-tsconfig-paths 解析问题
- **文件锚点**:`vitest.config.ts:18-30`(plugins 数组)
- **验收标准**:
  ```bash
  $ node_modules/.bin/vitest run --reporter=dot
  Test Files  0 failed
       Tests  全 PASS
  ```
- **Codex 参照**:无(纯工程问题)
- **风险**:低;别名指向具体文件不会污染 prod 构建(prod 用 package.json exports)
- **回滚**:删 `resolve.alias` 行
- **测试**:vitest 全量

#### 【P0-02】清理 working tree 中的 pre-existing 未提交修改

- **What**:`packages/ui/openbuddy-ui-mcp/src/PiExtensionsSection.tsx`、`MarketplacePanel.tsx`、`index.ts` 等文件有未提交修改,与 AI Chat 改造无关。本次已部分回退 `PiExtensionsSection.tsx`。下一轮要决策:继续回退还是独立提交
- **文件锚点**:`packages/ui/openbuddy-ui-mcp/src/{PiExtensionsSection.tsx,MarketplacePanel.tsx,index.ts,pi-package-bridge.ts,PiMarketSection.tsx}`
- **验收标准**:`git status` 在 ai-chat-* 分支只显示本轮改动文件
- **风险**:中(回退可能影响 pi-market 功能)
- **回滚**:revert 即可
- **测试**:无

### PHASE 1 — 对标 Codex 视觉基础(1 周)

#### 【P1-01】深色主题系统性补全(9.5% → 70%+)

- **What**:`src/styles/messages.css` 的 126 个 class 里有 ~114 个缺 `[data-theme="dark"]` 覆写。本单要补到 70%
- **文件锚点**:`src/styles/messages.css`(扫 `grep -L '\[data-theme="dark"\]' *.css` 找出未覆写文件)
- **验收标准**:
  - 自动化:深色主题下截图对比,文字对比度 ≥ WCAG AA(4.5:1)
  - 视觉:浅/深两套无视觉落差(肉眼无差别感)
- **Codex 参照**:Codex 深色主题走 `#0e0e10` 主背景 + `#ffffff` 文字 + `#00c29a` 品牌色
- **风险**:中(可能动既有 class 影响大量 component 视觉)
- **回滚**:`git checkout HEAD -- src/styles/messages.css`
- **测试**:
  - 新增 `src/styles/__tests__/dark-theme-coverage.test.ts`(扫每个 class 是否有双 theme/overlay)
  - 视觉:`scripts/electron/_audit-darkmode.mjs`(新)

#### 【P1-02】空状态 v2 hero 重构

- **What**:`ChatViewEmptyState.tsx` 当前是 v1 单列 5 张 quick prompts。重构为 v2:左栏「能力」(Navigate / Inspect / Edit / Test 四张)+ 右栏「场景」(梳理项目 / 找 Bug / 写测试 / 改样式 四张)
- **文件锚点**:
  - `packages/ui/openbuddy-ui-conversation/src/chatview/ChatViewEmptyState.tsx`
  - `src/styles/messages.css`(找 `chatview__empty-state*`)
- **验收标准**:
  - DOM 结构:`<div class="chatview__empty-state-v2">` + 左 `<ul role="list" class="abilities">` + 右 `<ul role="list" class="scenarios">`
  - 8 张卡,每张有 icon + 标题 + 描述 + 点击填入 composer
  - 视觉对标 Codex 截图
- **Codex 参照**:Codex 把 hero 拆成 "Capabilities" / "Starter prompts" 两组,每组 4 卡,横向排列
- **风险**:中(动既有 class 会改 33 个 MessageItem 快照)
- **回滚**:保留 v1 渲染分支,通过 prop 切换
- **测试**:
  - 新增 `ChatViewEmptyState.test.tsx` 现有快照测试 + 新加 v2 测试
  - 视觉:`scripts/electron/_audit-hero.mjs`(新)

#### 【P1-03】ChatView 抽 memo 子组件(防大父组件重渲染)

- **What**:ChatView 933 行 / 43 hooks,把以下挂载点抽 memo 子组件:
  - `<ChatViewToolbar />`(已有 chatview/ChatViewToolbar.tsx)→ 加 `memo()`
  - `<ChatViewBannerStack />`(已有)→ 加 `memo()`
  - `<ConversationViewTabs />`(已有)→ 加 `memo()`
  - `<ChatViewEmptyState />`→ 加 `memo()`
  - `<MessageList />`(新增)→ 把虚拟化 + timeline 渲染包进去
- **文件锚点**:`ChatView.tsx:1-933`,`chatview/ChatViewScrollStage.tsx`
- **验收标准**:
  - ChatView 体积降至 ≤ 700 行(减 25%)
  - React DevTools Profiler:流式时只重渲染 MessageItem,不重渲染 ChatView 整体
- **Codex 参照**:Codex / ChatGPT 都把 chat shell 拆 Shell + Messages + Composer + Toolbar 四个 memo 组件
- **风险**:中(拆 memo 要改 props 接口)
- **回滚**:`git checkout HEAD -- packages/ui/openbuddy-ui-conversation/src/ChatView.tsx`
- **测试**:
  - 既有 `__tests__/ChatView-tabs-wiring.test.tsx` 不破
  - 新增 `ChatView-memoization.test.tsx`:断言 ChatView 跟 MessageItem 用 `React.memo` 包裹

#### 【P1-04】InlineApprovalHint 完成测试覆盖(已有 8 用例)+ 加深色主题测试

- **What**:深色主题下 InlineApprovalHint 视觉验证
- **文件锚点**:`src/styles/messages.css:1597-1700`(msg__approval-hint 全段)
- **验收标准**:`msg__approval-hint--permission` / `--question` 在 `[data-theme="dark"]` 下视觉一致
- **风险**:低
- **测试**:扩展 `parts/__tests__/InlineApprovalHint.test.tsx` 加 dark mode 渲染测试

### PHASE 2 — 交互范式升级(1 周)

#### 【P2-01】助手消息操作图标折叠菜单(动 33 个快照测试)

- **What**:assistant 消息底部 8 个 action 常显 → 前 4 个(复制 / 重试 / 赞 / 踩)常显 + 后 4 个(草稿 / 内联编辑 / MD / 重发菜单)折叠到 `⋯` overflow 菜单
- **文件锚点**:
  - `packages/ui/openbuddy-ui-conversation/src/MessageItem.tsx:467-528`(8 个 action)
  - 新建 `packages/ui/openbuddy-ui-conversation/src/parts/MessageActionOverflow.tsx`
- **验收标准**:
  - DOM:`<div class="msg__footer">` 含 `<MessageActionOverflow>{草稿 / 内联编辑 / MD / 重发菜单}</MessageActionOverflow>`
  - 折叠菜单:点击 `⋯` 弹出 Popover,鼠标离开 200ms 后自动收起
  - 视觉:Codex 同款 hover-reveal(默认 0.55 opacity,hover 1.0)
- **Codex 参照**:Codex 助手消息底部只有 4 个图标(复制 / 重生 / 赞 / 踩),其余全折叠
- **风险**:**高**(改 33 个 MessageItem 快照测试 + 部分 tooltip 行为)
- **回滚**:保留旧 `msg__footer` 完整渲染,通过 `preferCompactActions` prop 切换
- **测试**:
  - 33 个 MessageItem 快照测试**逐个迁移**(加 `--compact-actions` modifier)
  - 新增 `parts/__tests__/MessageActionOverflow.test.tsx`(7 用例:折叠 / 展开 / 键盘导航 / ESC 关闭 / 鼠标离开关闭)

#### 【P2-02】Composer 信息密度重排

- **What**:把 4 个 chip 重排:
  - `cost estimate` + `ContextUsagePill` → 输入框**右下角**(Codex 范式)
  - `ModelSelector` → 顶部工具栏(已有 ComposerSceneTag 位置)
  - `voice` 保留常显
- **文件锚点**:
  - `packages/ui/openbuddy-ui-conversation/src/Composer.tsx:518-545`
  - `composer/ComposerMetaRow.tsx`
- **验收标准**:
  - Composer 底部只剩:输入框(textarea) + 4 个 chip 右下角 + voice + send
  - 顶部工具栏:模型选择 + 场景切换 + capability chip
- **风险**:中(改 Composer props 影响 4 个 Composer 测试)
- **回滚**:`git checkout HEAD -- packages/ui/openbuddy-ui-conversation/src/Composer.tsx`
- **测试**:
  - 既有 `ComposerChips.test.tsx` 不破(10 用例)
  - 新增 `Composer-meta-row.test.tsx`(5 用例:cost / ctx / 模型 / voice / send 位置)

#### 【P2-03】aria-role 补全(MessageItem + Composer + 全局)

- **What**:
  - `MessageItem` 根 div:`role="article"` `aria-label="用户消息 / assistant 消息"` `aria-busy="流式中"`
  - 流式 caret 区:`aria-live="polite"`
  - Composer 根:`role="form"` `aria-label="发送消息"`
  - Composer textarea:`aria-describedby="composer-hint"`
  - InlineApprovalHint:`role="region"` `aria-label="待审批"`
- **文件锚点**:
  - `MessageItem.tsx:1-594`(全文)
  - `Composer.tsx:1-625`(全文)
  - `parts/InlineApprovalHint.tsx:48-90`
- **验收标准**:
  - axe-core 0 violations
  - VoiceOver / NVDA 测试:消息边界清晰、状态变化有提示
- **Codex 参照**:Codex 消息根 div 是 `<article>`,Composer 是 `<form>`
- **风险**:中(a11y 属性可能影响测试 selector)
- **回滚**:加 prop `enableA11y={false}` 兜底
- **测试**:
  - 新增 `__tests__/MessageItem-a11y.test.tsx`(5 用例:role / aria-label / aria-live / aria-busy / flow)
  - axe-core 集成到 vitest(用 `vitest-axe`)

#### 【P2-04】prefers-contrast: more 全局适配

- **What**:`src/styles/messages.css` / `prose.css` / `home.css` 加 `@media (prefers-contrast: more)` 块:
  - 边框 +1 stroke
  - 文字色加深
  - focus 宽度 → 3px
- **文件锚点**:`src/styles/{messages,prose,home}.css`
- **验收标准**:
  - Chrome 设置 "高对比度" 后视觉对比度 ≥ WCAG AAA
  - 自动化扫所有 component 在 contrast=more 下视觉无损
- **Codex 参照**:Codex 全局支持 prefers-contrast: more
- **风险**:低
- **回滚**:`git checkout HEAD -- src/styles/{messages,prose,home}.css`
- **测试**:新增 `src/styles/__tests__/prefers-contrast-coverage.test.ts`(扫每个 class 是否有 fallthrough)

#### 【P2-05】StreamingCaret 加 aria-hidden

- **What**:`StreamingCaret.tsx` 根元素加 `aria-hidden="true"`(纯视觉)
- **文件锚点**:`packages/ui/openbuddy-ui-conversation/src/StreamingCaret.tsx`
- **验收标准**:屏幕阅读器跳过 caret
- **风险**:低
- **测试**:既有 `StreamingCaret.test.tsx`(若有)更新 snapshot

### PHASE 3 — 性能 + 细节(2 周)

#### 【P3-01】ChatView 进一步拆 memo(全 8 子组件)

- **What**:Phase 1 P1-03 的延续,把 ScrollStage / Footer / BannerStack / Toolbar / EmptyState 全包 `memo()`
- **文件锚点**:`packages/ui/openbuddy-ui-conversation/src/chatview/*.tsx`
- **验收标准**:ChatView 流式时 Profiler 显示子组件均不重渲染
- **风险**:中
- **回滚**:逐文件 revert
- **测试**:vitest 33 个 component 测试全 PASS

#### 【P3-02】MessageItem 抽 `parts/InlineEditActions.tsx`

- **What**:把 MessageItem.tsx:340-410 的 inline-edit actions JSX(取消 / 应用 / 应用并重新生成)抽到独立文件
- **文件锚点**:
  - `packages/ui/openbuddy-ui-conversation/src/MessageItem.tsx:340-410`(被抽)
  - 新建 `packages/ui/openbuddy-ui-conversation/src/parts/InlineEditActions.tsx`
- **验收标准**:MessageItem.tsx 体积 -50 行;`InlineEditActions` 独立单元测试
- **风险**:低(纯重构)
- **回滚**:`git checkout HEAD -- packages/ui/openbuddy-ui-conversation/src/MessageItem.tsx`
- **测试**:
  - 新增 `parts/__tests__/InlineEditActions.test.tsx`(5 用例:cancel / apply / apply+resend / disabled / 键盘)

#### 【P3-03】Composer hooks 分组(纯重构)

- **What**:Composer 16 hooks 拆 4 个自定义 hook:`useComposerSend` `useComposerModel` `useComposerDrop` `useComposerPopovers`
- **文件锚点**:`Composer.tsx`(全文)
- **验收标准**:Composer.tsx 体积 -200 行;每个 hook 独立单元测试
- **风险**:低(纯重构)
- **回滚**:`git checkout HEAD -- packages/ui/openbuddy-ui-conversation/src/Composer.tsx`
- **测试**:新增 4 个 hook 测试文件

#### 【P3-04】VirtualizedMessageList 阈值提取 named constant

- **What**:把 `VirtualizedMessageList.tsx:280` 的 50 阈值提为 `VIRTUAL_LIST_THRESHOLD = 50` named export
- **文件锚点**:`VirtualizedMessageList.tsx:280-285`
- **验收标准**:`export const VIRTUAL_LIST_THRESHOLD = 50` + JSDoc 解释选择理由
- **风险**:极低
- **测试**:无

#### 【P3-05】Reasoning 卡折叠动画

- **What**:`<details>` 改成受控 + max-height + ease-out-expo 动画
- **文件锚点**:`ThoughtMessagePart.tsx` + `messages.css:1295-1349`
- **验收标准**:`details[open]` 时 max-height 从 0 → auto,有 240ms ease-out-expo
- **Codex 参照**:Codex reasoning 卡折叠动画 240ms
- **风险**:低
- **测试**:扩展 `ThoughtMessagePart.test.tsx`(若有)

#### 【P3-06】✅ 已完成 — caret 250ms / reasoning strip 600ms / tool group 500ms

- **文件**:`src/styles/messages.css:1274 / 1314 / 1343 / 1532`
- **测试**:9 用例 PASS(`ai-chat-p3-rhythm-and-divider.test.ts`)

#### 【P3-07】✅ 已完成 — 日期分隔符视觉加强

- **文件**:`src/styles/prose.css:677-691`
- **测试**:同 P3-06 测试套件

#### 【P3-08】Composer placeholder 多语言精简

- **What**:placeholder 中文 ≤ 14 字、英文 ≤ 30 字符
- **文件锚点**:`Composer.tsx`(placeholder prop 全部出现位置)
- **验收标准**:`grep -E "placeholder=\"[^\"]{15,}\"" src/` 中文 ≤ 14 字
- **风险**:低
- **测试**:无

#### 【P3-09】Composer 模型能力 chip 一行展示

- **What**:`composer/ComposerChips.tsx` 的能力 chip 单行 + 省略 + tooltip
- **文件锚点**:`composer/ComposerChips.tsx`(全文)
- **验收标准**:模型能力 chip 单行省略号 + 悬停 tooltip
- **风险**:低
- **测试**:扩展 `ComposerChips.test.tsx`

#### 【P3-10】Tool group summary 视觉验证 + 加强

- **What**:验证 `.tool-group-summary--running` 3 工具并行时是否清晰;加强 brand 色同心圆
- **文件锚点**:`parts/ToolGroupSummary.tsx` + `messages.css:1518-1548`
- **验收标准**:3 tools running 同心圆 + 进度条视觉清晰
- **风险**:低

#### 【P3-11】新增 P0 配色 token:`--wb-palette-danger-7/8/9`

- **What**:现有 `--wb-palette-brand-7/8/9` 三档,补同样三档 danger 色(用于 InlineApprovalHint 的「拒绝」按钮等)
- **文件锚点**:`src/styles/tokens.css`
- **验收标准**:`grep "wb-palette-danger" src/styles/messages.css` 引用数 ≥ 3
- **风险**:极低

#### 【P3-12】ChatViewEmptyState 加数据驱动版本(支持 plugin 注入)

- **What**:把 `QUICK_PROMPTS` 改为可注入,让 plugin 注册自己的 quick prompts(R92)
- **文件锚点**:`chatview/ChatViewEmptyState.tsx:27-95`
- **验收标准**:`useSlotEntries("chatview.quickPrompts")` 返回 N 项 → UI 渲染 N+ 内置 8 项
- **风险**:低(纯扩展)
- **测试**:扩展 `ChatViewEmptyState.test.tsx`

#### 【P3-13】沉浸模式 / 焦点模式 toggle

- **What**:Composer 工具栏加「沉浸模式」按钮 → 全屏只显示消息 + Composer
- **文件锚点**:新建 `chatview/useChatViewImmersive.ts` + CSS `.chatview--immersive`
- **验收标准**:toggle 后 `.chatview--immersive` 类挂上,sidebar / toolbar 隐藏
- **风险**:中(影响 layout)
- **测试**:新增 `chatview/__tests__/useChatViewImmersive.test.tsx`

#### 【P3-14】键盘快捷键 `Cmd/Ctrl+K` 命令面板

- **What**:仿 VSCode / Codex 命令面板,输入即搜命令 / 会话 / 文件
- **文件锚点**:新建 `chatview/ChatCommandPalette.tsx`
- **验收标准**:`Cmd/Ctrl+K` 弹出,30+ 命令可搜
- **风险**:高(大型新组件)
- **测试**:新增 `__tests__/ChatCommandPalette.test.tsx`(10 用例)

#### 【P3-15】会话标题自动生成(首条 user 消息)

- **What**:新会话首次发送后,自动用 LLM 生成 6 字标题(Codex 范式)
- **文件锚点**:新建 `chatview/useChatViewAutoTitle.ts`
- **验收标准**:首条消息发出后 2s 内,sessionStore.title 更新
- **风险**:中(需要 IPC + LLM 调用)
- **测试**:新增 hook 测试

#### 【P3-16】MessageItem 拆分(Phase 3 终极拆分)

- **What**:把 MessageItem 拆 4 个子组件 `<MessageBubble>` `<MessageActions>` `<MessageMeta>` `<MessageParts>`(已在 parts/,进一步整合)
- **文件锚点**:`MessageItem.tsx`(全文)
- **验收标准**:MessageItem.tsx ≤ 300 行
- **风险**:中(动 33 个快照测试)
- **回滚**:逐文件 revert
- **测试**:既有 MessageItem 33 测试不破

#### 【P3-17】Composer 多模(multimodal)统一

- **What**:附件 / 图片 / 文件三类 chip 视觉对齐(当前 3 种 chip 样式略不同)
- **文件锚点**:`composer/ComposerChips.tsx`
- **验收标准**:3 类 chip 视觉一致(同 padding / 同字色 / 同圆角)
- **风险**:低

#### 【P3-18】CSS 硬编码色值清零

- **What**:扫所有 CSS 文件,硬编码 `#xxx` / `rgb()` / `rgba()` 字面量改成 token
- **文件锚点**:`src/styles/{messages,prose,home}.css`
- **验收标准**:`grep -rE "(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))" src/styles/*.css | grep -v token|preset` 返回 0 行
- **风险**:中(改 styled token 一处不全面)
- **测试**:新增 `src/styles/__tests__/no-hardcoded-color.test.ts`

#### 【P3-19】lucide-react 按需 import 验证

- **What**:grep 所有 `from "lucide-react"` 字面量 import,确保没有 barrel import
- **文件锚点**:`packages/ui/openbuddy-ui-conversation/src/**/*.tsx`
- **验收标准**:`grep -rn 'from "lucide-react"' packages/ui/openbuddy-ui-conversation/src/` 返回 0 行(只能走 per-icon path)
- **风险**:低
- **测试**:新增 `__tests__/lucide-no-barrel-import.test.ts`

#### 【P3-20】MessageItem avatar 大小响应式

- **What**:在 < 600px 窄屏,头像 / chip 缩到 24px
- **文件锚点**:`messages.css` 头像相关
- **验收标准**:Chrome 设备模拟 < 600px,头像 / chip 视觉合理
- **风险**:低

## 四、依赖矩阵

| 单 | 依赖 | 被依赖 |
|---|---|---|
| **P0-01** 13 个 vitest failure | 无 | P1 / P2 / P3 所有单 |
| **P0-02** working tree 清理 | 无 | P1 / P2 / P3 所有单 |
| **P1-01** 深色主题 | 无 | P2-04 |
| **P1-02** 空状态 v2 hero | 无 | P3-12 |
| **P1-03** ChatView memo | 无 | P3-01 |
| **P1-04** InlineApprovalHint a11y | 无 | P2-03 |
| **P2-01** 操作折叠菜单 | P1-03 | P3-16(可并行) |
| **P2-02** Composer 重排 | 无 | P3-03 |
| **P2-03** aria-role | P1-04 | 无 |
| **P2-04** prefers-contrast | P1-01 | 无 |
| **P2-05** StreamingCaret aria-hidden | 无 | 无 |
| **P3-01** ChatView 全 memo | P1-03 | 无 |
| **P3-02** InlineEditActions 抽 | 无 | P3-16 |
| **P3-03** Composer hooks 分组 | P2-02 | 无 |
| **P3-04** VirtualizedMessageList 阈值 | 无 | 无 |
| **P3-05** Reasoning 折叠动画 | 无 | 无 |
| **P3-06/07** ✅ 已完成 | 无 | 无 |
| **P3-08** placeholder 精简 | 无 | 无 |
| **P3-09** 模型能力 chip | 无 | 无 |
| **P3-10** Tool group summary | 无 | 无 |
| **P3-11** danger palette token | 无 | P2-01 |
| **P3-12** quickPrompts 插件化 | P1-02 | 无 |
| **P3-13** 沉浸模式 | 无 | 无 |
| **P3-14** Cmd+K 命令面板 | 无 | 无 |
| **P3-15** 自动标题 | 无 | 无 |
| **P3-16** MessageItem 拆分 | P3-02 | 无 |
| **P3-17** 多模统一 | 无 | 无 |
| **P3-18** 硬编码色值清零 | P1-01 | 无 |
| **P3-19** lucide 按需 | 无 | 无 |
| **P3-20** 响应式头像 | 无 | 无 |

> **关键路径**:P1-03 → P2-01 → P3-16(ChatView memo → 操作折叠 → MessageItem 拆分)。这是 33 个 MessageItem 快照测试的最大风险路径。

## 五、Codex 风格参考(具体规范)

### 5.1 颜色(Codex 实际值)

```
主背景 浅 #ffffff  深 #0e0e10
次背景 浅 #fafbfc  深 #1a1a1f
品牌色 主 #10a37f  OpenBuddy 用 #00c29a(略偏 OpenBuddy 绿)
文字强 浅 rgba(0,0,0,0.88)  深 rgba(255,255,255,0.92)
错误   #ef4146
警告   #f59e0b
成功   #10a37f
```

### 5.2 排版(Codex)

```
聊天内容 14px / 1.5 行高 / 系统字体栈
次要信息 12px / 1.4 行高
标题    16px / 1.3 行高
代码    13px / 1.5 / JetBrains Mono / Menlo
```

### 5.3 间距(8pt grid)

```
超紧凑 4px
紧凑   8px
常规   12px
段落   16px
区块   20px / 24px
```

### 5.4 圆角

```
小元素(chip)  6px / 8px
卡片          10px / 12px
模态          16px
```

### 5.5 阴影(Codex / macOS)

```
微浮 0 1px 2px rgba(0,0,0,0.06) 0 0 0 1px rgba(0,0,0,0.08)
悬浮 0 4px 12px rgba(0,0,0,0.10) 0 0 0 1px rgba(0,0,0,0.10)
模态 0 24px 48px rgba(0,0,0,0.18) 0 0 0 1px rgba(0,0,0,0.10)
```

## 六、验收门禁(每件套可测)

| 单 | 自动化测试 | 视觉验收 | 性能验收 | 提交门禁 |
|---|---|---|---|---|
| P0-01 | vitest 全绿 | — | — | 必须 |
| P0-02 | — | — | — | 必须 |
| P1-01 | dark-theme-coverage.test.ts | electron probe 截图比对 | — | 必须 |
| P1-02 | ChatViewEmptyState.test.tsx | electron probe | — | 必须 |
| P1-03 | ChatView-memoization.test.tsx | React Profiler | — | 必须 |
| P1-04 | InlineApprovalHint.test.tsx | — | — | 必须 |
| P2-01 | MessageActionOverflow.test.tsx + 33 快照更新 | electron probe | — | 必须 |
| P2-02 | Composer-meta-row.test.tsx | — | — | 必须 |
| P2-03 | axe-core.a11y.test.tsx | 屏幕阅读器 | — | 必须 |
| P2-04 | prefers-contrast-coverage.test.ts | Chrome 高对比度模拟 | — | 必须 |
| P2-05 | StreamingCaret-a11y.test.tsx | — | — | 必须 |
| P3-01 | ChatView-memo-full.test.tsx | React Profiler | bundle size | 必须 |
| P3-02 | InlineEditActions.test.tsx | — | — | 必须 |
| P3-03 | useComposerSend.test.tsx 等 4 文件 | — | — | 必须 |
| P3-04 | — | — | — | 建议 |
| P3-05 | ThoughtMessagePart.test.tsx 扩展 | — | — | 建议 |
| P3-08~10 | — | electron probe | — | 建议 |
| P3-11 | no-hardcoded-color.test.ts | — | — | 建议 |
| P3-12 | ChatViewEmptyState-plugin.test.tsx | — | — | 建议 |
| P3-13 | useChatViewImmersive.test.tsx | — | — | 可选 |
| P3-14 | ChatCommandPalette.test.tsx | — | — | 可选 |
| P3-15 | useChatViewAutoTitle.test.tsx | — | — | 可选 |
| P3-16 | MessageItem-decomposed.test.tsx | — | bundle size | 可选 |
| P3-17~20 | — | electron probe | — | 可选 |
| **P3-18** | no-hardcoded-color.test.ts | — | — | 建议 |
| **P3-19** | lucide-no-barrel-import.test.ts | — | bundle size | 建议 |
| **P3-20** | responsive-avatar.test.ts | Chrome 设备模拟 | — | 可选 |

## 七、回滚预案(每件套独立)

- 每个单都在自己的 git commit 里(commit message 包含单号 P1-01 等)
- 单 PR,review 通过则 squash merge
- 出问题 `git revert <commit-sha>` 即可独立回退
- 高风险单(P2-01 / P3-16 / P3-14)必须保留旧代码路径,通过 prop 切换

## 八、风险登记

| 单 | 风险等级 | 风险点 | 缓解 |
|---|---|---|---|
| P0-01 | 低 | alias 路径漂移 | 写 absolute path 不变 |
| P0-02 | 中 | 回退 pi-market 功能 | 决策:回退还是提交独立 PR |
| P1-01 | 中 | 改 styled token 影响既有 | 逐 class 灰度,先 10 个 class 验证 |
| P1-02 | 中 | 动 snapshot | 加 v2 prop 切换,v1 保留 |
| P1-03 | 中 | memo 改 props 行为 | 单元测试覆盖所有 mount 路径 |
| P2-01 | **高** | 33 个 MessageItem snapshot | 逐个迁移;加旧 prop fallback |
| P2-02 | 中 | 改 Composer 工具栏布局 | 既有 4 个 Composer 测试必须改 |
| P2-03 | 中 | a11y 影响测试 selector | 新增 a11y 测试独立运行 |
| P3-13 | 中 | 沉浸模式改 layout | 用 `:has()` selector + fallback class |
| P3-14 | **高** | 新大型组件 | feature flag,默认关闭 |

## 九、自动化测试矩阵

### 9.1 现有测试(沿用)

```
Test Files  5 passed (5)  ← 第 1+2 轮新增
     Tests  32 passed (32)
```

| 文件 | 用例 |
|---|---:|
| messages-css-integrity | 5 |
| ai-chat-p3-rhythm-and-divider | 9 |
| shortModelLabel | 5 |
| InlineApprovalHint | 8 |
| ChatView-tabs-wiring | 5 |

### 9.2 本计划新增测试

| 新文件 | 用例数 | 守什么 |
|---|---:|---|
| `dark-theme-coverage.test.ts` | ~30 | 深色主题覆盖率 ≥ 70% |
| `prefers-contrast-coverage.test.ts` | ~20 | prefers-contrast 覆盖率 ≥ 60% |
| `no-hardcoded-color.test.ts` | 10 | 硬编码色值 = 0 |
| `lucide-no-barrel-import.test.ts` | 5 | 无 barrel import |
| `ChatView-memoization.test.tsx` | 8 | ChatView 全 memo 包裹 |
| `ChatView-memo-full.test.tsx` | 5 | P3-01 全拆 |
| `ChatViewEmptyState.test.tsx` 增量 | 6 | v2 hero |
| `MessageActionOverflow.test.tsx` | 7 | 操作折叠 |
| `Composer-meta-row.test.tsx` | 5 | Composer 重排 |
| `MessageItem-a11y.test.tsx` | 5 | a11y 属性 |
| `axe-core.a11y.test.tsx` | 5 | axe-core 集成 |
| `InlineEditActions.test.tsx` | 5 | 内联编辑抽离 |
| `useComposer{Send,Model,Drop,Popovers}.test.tsx` | 12 | Composer hooks |
| `StreamingCaret-a11y.test.tsx` | 3 | aria-hidden |
| `ThoughtMessagePart.test.tsx` 增量 | 3 | 折叠动画 |
| `ChatViewEmptyState-plugin.test.tsx` | 4 | quickPrompts 注入 |
| `useChatViewImmersive.test.tsx` | 5 | 沉浸模式 |
| `ChatCommandPalette.test.tsx` | 10 | 命令面板 |
| `useChatViewAutoTitle.test.tsx` | 5 | 自动标题 |
| `MessageItem-decomposed.test.tsx` | 8 | MessageItem 拆分 |
| **合计** | **~166** | — |

### 9.3 测试命令

```bash
# 全套
node_modules/.bin/vitest run --reporter=dot

# 单独跑 AI chat 包
node_modules/.bin/vitest run packages/ui/openbuddy-ui-conversation --reporter=dot

# 跑 CSS 完整性
node_modules/.bin/vitest run src/styles/__tests__

# 跑 a11y
node_modules/.bin/vitest run -t "a11y"

# 真机 electron probe
node scripts/electron/_audit-edit.mjs
node scripts/electron/_audit-views.mjs

# 构建
npx electron-vite build

# bundle 分析
npx vite-bundle-visualizer
```

## 十、交付物清单

### 10.1 文档(5 份)

1. `docs/AI_CHAT_UI_AUDIT.zh-CN.md` — 第 1 轮审计报告(328 行)
2. `docs/AI_CHAT_FULL_AUDIT.zh-CN.md` — 第 2 轮综合计划(298 行)
3. `docs/AI_CHAT_UI_EXECUTION_PLAN.zh-CN.md` — **本计划(执行级)**
4. `docs/PLAN5_COMPONENTIZATION_AUDIT.md` — 既有 38 用例审计报告
5. `docs/plan/05-target-architecture.md` — R5/R6 规则源头

### 10.2 代码改动(汇总)

- **第 1 轮(已 commit 5f395f2)**:5 处 Fix + 12 测试
- **第 2 轮(已 commit 5f395f2)**:InlineApprovalHint 升级 + 8 测试
- **第 3 轮(已 commit)**:caret 250ms + divider 视觉 + 9 测试
- **本计划(执行级)**:28 张执行单 = 累计 28 处代码改动 + ~166 个新测试

### 10.3 命令速查(开发日常)

```bash
# 跑全部 AI chat 单测
node_modules/.bin/vitest run packages/ui/openbuddy-ui-conversation --reporter=dot

# 跑全部新增测试(第 1+2+3 轮)
node_modules/.bin/vitest run \
  src/styles/__tests__/messages-css-integrity.test.ts \
  src/styles/__tests__/ai-chat-p3-rhythm-and-divider.test.ts \
  src/lib/ui/__tests__/shortModelLabel.test.ts \
  packages/ui/openbuddy-ui-conversation/src/parts/__tests__/InlineApprovalHint.test.tsx \
  packages/ui/openbuddy-ui-conversation/src/__tests__/ChatView-tabs-wiring.test.tsx

# 构建
npx electron-vite build

# 真机 electron probe
node scripts/electron/_audit-edit.mjs        # 用户气泡内联编辑器样式
node scripts/electron/_audit-views.mjs       # 3 个 view tab 真的渲染

# 视觉深色 / 高对比度 扫描
grep -c '\[data-theme="dark"\]' src/styles/messages.css     # 当前 12
grep -c 'prefers-contrast' src/styles/                       # 当前 1
grep -rE "(#[0-9a-fA-F]{3,6}|rgba?\()" src/styles/*.css      # 硬编码

# bundle size 检查
npx vite-bundle-visualizer
```

## 附录:本计划与既有文档的关系

```
docs/AI_CHAT_UI_AUDIT.zh-CN.md (第 1 轮 · 12 修复 + 测试)
  ↓ 补全
docs/AI_CHAT_FULL_AUDIT.zh-CN.md (第 2 轮 · 综合扫描 + P0 CSS 改动)
  ↓ 完善成施工单
docs/AI_CHAT_UI_EXECUTION_PLAN.zh-CN.md (本计划 · 28 张执行单)
  ↓ 按阶段实施
代码改动 + ~166 个新测试 + 1 份最终交付报告
```

> **核心不变性**:每一轮的产出都为下一轮提供更高保真度的输入 — 这是「分阶段、可施工、可回退」的工程纪律。
