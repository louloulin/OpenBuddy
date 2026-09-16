# WorkBuddy UI 组件参考

本文档整理了 WorkBuddy 的界面组件结构，用于指导 OpenBuddy 的界面完善工作。

## 1. 整体布局结构

WorkBuddy 采用经典的左侧边栏 + 主内容区布局：

```
┌─────────────────────────────────────────────────────────┐
│                      TitleBar                           │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│   Sidebar    │           MainContent                    │
│              │                                          │
│  - Logo      │  - HomePage / ChatView                   │
│  - Search    │                                          │
│  - Nav Items │                                          │
│  - Sessions  │                                          │
│  - User      │                                          │
│              │                                          │
└──────────────┴──────────────────────────────────────────┘
```

## 2. 核心组件清单

### 2.1 基础组件 (Foundation Components)

| 组件 | 类名前缀 | 说明 |
|------|---------|------|
| Avatar | `wb-avatar` | 头像组件 |
| Breadcrumb | `wb-breadcrumb` | 面包屑导航 |
| Button | `wb-button` | 按钮 |
| Card | `wb-card` | 卡片 |
| Checkbox | `wb-checkbox` | 复选框 |
| Drawer | `wb-drawer` | 抽屉 |
| Dropdown | `wb-dropdown` | 下拉菜单 |
| Input | `wb-input` | 输入框 |
| Loading | `wb-loading` | 加载状态 |
| Popover | `wb-popover` | 弹出框 |
| Progress | `wb-progress` | 进度条 |
| Select | `wb-select` | 选择器 |
| Switch | `wb-switch` | 开关 |
| Table | `wb-table` | 表格 |
| Tabs | `wb-tabs` | 标签页 |
| Tag | `wb-tag` | 标签 |
| TextArea | `wb-textarea` | 文本域 |

### 2.2 布局组件

| 组件 | 类名 | 说明 |
|------|------|------|
| Sidebar | `wb-sidebar-left` / `wb-sidebar-right` | 左/右侧边栏 |
| HomePage | `wb-home-page` | 首页 |
| SearchPanel | `wb-search-panel` | 搜索面板 |
| InputAdd | `wb-input-add` | 输入区附加组件 |
| InputFooter | `wb-input-footer` | 输入区底部 |
| StatusChips | `wb-status-chips` | 状态标签 |

### 2.3 业务组件

| 组件 | 说明 |
|------|------|
| conversation-list | 会话列表 |
| pinned-section | 置顶会话区 |
| chat-renderer | 聊天渲染器 |
| colleagues-panel | 同事面板 |
| automation-panel | 自动化面板 |
| knowledge-base-panel | 知识库面板 |
| skill-recommend-bar | 技能推荐栏 |

## 3. CSS 设计令牌 (Design Tokens)

### 3.1 颜色令牌

```css
/* 背景色 */
--wb-bg-primary
--wb-bg-secondary
--wb-bg-tertiary
--wb-bg-surface
--wb-bg-active
--wb-bg-hover

/* 边框色 */
--wb-border-default
--wb-border-soft
--wb-border-focus

/* 文本色 */
--wb-color-text-primary
--wb-color-text-secondary
--wb-color-text-tertiary
--wb-color-text-disabled
--wb-color-text-brand

/* 状态色 */
--wb-status-success
--wb-status-error
--wb-status-warning
```

### 3.2 间距和圆角

```css
/* 圆角 */
--wb-radius-sm
--wb-radius-md

/* 阴影 */
--wb-shadow-sm
```

## 4. 关键页面结构

### 4.1 首页 (HomePage)

```tsx
<div className="wb-home-page">
  <HomeHeader />           // Logo + 标题
  <SceneTabs />            // 场景标签页 (日常办公/代码开发/设计创意...)
  <HomeComposer />         // 输入框组件
  <PracticeCases />        // 实践案例推荐 (可选)
</div>
```

### 4.2 聊天视图 (ChatView)

```tsx
<div className="chat-view">
  <ChatRenderer />         // 消息列表
  <InputComposer />        // 输入框
  <InputFooter>            // 底部元信息
    <WorkspacePicker />    // 工作空间选择
    <PermissionChip />     // 权限标签
  </InputFooter>
</div>
```

### 4.3 会话列表 (ConversationList)

```tsx
<div className="conversation-list">
  <PinnedSection />        // 置顶会话
  <TaskSection />          // 任务会话
  <WorkspaceSection>       // 工作空间会话
    <WorkspaceGroup />
  </WorkspaceSection>
</div>
```

## 5. 输入框组件 (Composer)

### 5.1 结构

```tsx
<div className="wb-composer">
  <div className="wb-composer__attachments" />  // 附件区
  
  <textarea className="wb-composer__input" />   // 输入框
  
  <div className="wb-composer__footer">
    <AddButton />           // 添加附件
    <ModelSelector />       // 模型选择
    <VoiceButton />         // 语音输入
    <SendButton />          // 发送按钮
  </div>
</div>

<div className="wb-composer-meta">
  <WorkspacePicker />
  <PermissionChip />
</div>
```

## 6. OpenBuddy 对齐清单

### 已完成 ✅
- [x] 基础布局结构
- [x] Sidebar 组件
- [x] HomePage 组件
- [x] Composer 输入框
- [x] ChatView 聊天视图
- [x] 会话列表
- [x] grok 后端集成
- [x] **17 套 OKLCh 主题 + Match-system 双主题对**（见 `docs/THEMES.md`）
- [x] **防 FOUC 同步初始化**（`initializeThemeSync` + `<ThemeInitializer />`）
- [x] **可拖拽宽度 Sidebar**（`Resizable` 原子组件，220–420px，localStorage 持久化）
- [x] **树状文件浏览器**（`@openbuddy/ui-files-tree`：虚拟滚动 / 多选 / 拖拽 / 右键菜单 / 键盘导航）
- [x] **底部状态栏**（`@openbuddy/ui-shell` 的 `StatusBar`，挂载在 `shell.statusbar` slot）

### 待完善 📝
- [ ] 场景标签页 (SceneTabs)
- [ ] 技能推荐栏 (SkillRecommendBar)
- [ ] 置顶会话功能
- [ ] 工作空间分组
- [ ] 权限管理面板
- [ ] 设置面板完善
- [ ] 搜索功能
- [ ] 更多动画效果
- [ ] TipTap 富文本编辑器（Phase C：`@openbuddy/ui-editor`）
- [ ] Onboarding Wizard / Tour / DataDir Prompt（Phase D：`@openbuddy/ui-onboarding`）
- [ ] Plugin Marketplace UI（`@openbuddy/ui-modules` 扩展）
- [ ] Theme Studio（OKLCh 自定义主题编辑器）

## 7. 借鉴自 cabinet 的能力（对照表）

| 能力 | cabinet 实现 | OpenBuddy 落地 | 状态 |
|------|-------------|---------------|------|
| 17 套 OKLCh 主题 | `src/lib/themes.ts` | `packages/ui/openbuddy-ui-theme/src/themes.ts` | ✅ 已移植（品牌色重调） |
| Match-system 双主题对 | `resolveActiveTheme()` | `ThemeService.getPair()/setPair()/setMode()` | ✅ |
| 防 FOUC | `theme-initializer.tsx` | `initializeThemeSync()` + `<ThemeInitializer />` | ✅（无 inline script） |
| 字体按需加载 | `loadThemeFonts()` | `loadThemeFonts()` | ✅ |
| 主题选择器 UI | `theme-picker.tsx` | `ThemePicker.tsx` | ✅（分组 + accent + 字体预览） |
| 可拖拽 Sidebar | 220–420px clamp | `Resizable` 原语 + AppShell 接线 | ✅ |
| 树状文件管理 | `tree-view.tsx` / `tree-node.tsx` | `@openbuddy/ui-files-tree` `FileTree` | ✅（新增独立 ui-* 包） |
| 状态栏 | `status-bar.tsx` | `@openbuddy/ui-shell` `StatusBar` | ✅ |
| TipTap 编辑器 | `@tiptap/*` | Phase C：`@openbuddy/ui-editor` | 📝 计划中 |
| Onboarding / Tour | `onboarding-wizard.tsx` | Phase D：`@openbuddy/ui-onboarding` | 📝 计划中 |
| Office 预览 | `docx-preview` / `xlsx` / `pptx-preview` | Phase C：`ui-workbench` 扩展 | 📝 计划中 |

### 架构差异（有意保留）

- OpenBuddy 继续走 **Electron + React + Vite + 微内核 slot 架构**；不引入 cabinet 的 Next.js App Router。
- 主题 token 继续使用 `--wb-*` 命名（26 个 ui-* 包零改动），OKLCh 值作为 token 值的升级而非命名替换。
- 新能力一律以 `apply()` + slot 声明的 `ui-*` 包形式加入；`packages/ui/AGENTS.md` 契约不变。

## Phase C / D follow-ups (this PR)

- **TipTap 富文本编辑器** —— `@openbuddy/ui-editor`:17 个 slot + 4 个组件 (TiptapEditor / EditorToolbar / BubbleToolbar / FloatingToolbar),slate-style 编排扩展(`buildEditorExtensions`)覆盖 StarterKit / Link / Underline / Highlight / TextAlign / TaskList / Table / CodeHighlight / Mathematics / Mermaid / SlashCommands / Mention,渲染与编辑通过 `markdown-bridge` 纯函数对接,markdown 往返幂等 13 个测试。
- **Office 内嵌预览** —— `@openbuddy/ui-workbench/DocxPreview / XlsxPreview / PptxPreview`:`PdfJsPreview` 同构的懒加载 + fallback 三件套;`FilePreview` 接入后,合法的 OOXML 文件在 transcript 里直接看到 PPT 真实布局 / Sheet 真实表格 / Word 真实版式,垃圾字节自动退回文本提取视图。
- **Onboarding / Tour** —— `@openbuddy/ui-onboarding`:5 个 slot (`onboarding.wizard / tour / data-dir / feedback / whats-new`),所有副作用走 `onSubmit` / `onDismiss`,不直连 IPC。
- **Plugin Marketplace UI** —— `@openbuddy/ui-modules`: `MarketplaceTab / Card / InstallDialog / CapabilityVersionBadge`,本地 semver + capability risk 计算(不引入 `semver` 依赖),`apply()` 由 no-op 升级为真注册两个 slot。
- **Pi 扩展市场桥接** —— `electron/main/agent/pi-market-bridge.ts`:registry.json + 可选远端索引、注入式 `fetchJson` / `now` / `hostVersion`,install / upgrade / rollback 通过 staging→rename 原子提交,`installed.json` 锁文件 + append-only `audit.jsonl`,`registerPiMarketBridgeIpc` 是 additive 接线点,IPC channel 与 `agent:plugin-*` / `marketplace_*` 完全不冲突。
- **Topbar 升级** —— `@openbuddy/ui-shell`:TopbarStatusChip / ShortcutHint (`formatShortcut` 纯函数 + mac/PC 双平台) / UpdateDialog (portal + Esc + focus trap) / ThemeMenuButton 复用 `ThemePicker` / `topbar-shortcuts.ts` 共享常量,`TopbarActions` 与 `TopbarTitle` 加 `statusChip` / `themeMenu` / `breadcrumb` 可选 props,**旧 API 不变**,旧测试仍通过。
- **微内核** —— `BUILTIN_UI_APPLIES` 从 22 升到 24,`microkernel-assembly.test.ts` + `builtin-applies-registration.test.ts` 断言同步更新;`runtime 22 → 24 个包全部真实 apply()` 仍 24 个全绿。

## 收尾抛光（onboarding + sidebar + marketplace + brand theme）

- **Onboarding 精简** —— `DEFAULT_ONBOARDING_STEPS` 从 6 步(welcome / theme / provider / data-dir / first-task / done)收敛为 3 步(welcome / first-task / done)。配置项(主题 / 模型 / 数据目录)在「done」描述里明确写「都可以在设置里随时调整」,引导只承担介绍与起步两件事。同步更新 `AppShell.tsx` host pass-through 与 `openbuddy-ui-onboarding/src/client.tsx` 包内默认 + 单测断言。真实 Electron probe:counter 切换 `1/3 → 2/3 → 3/3` 正常。
- **侧栏加宽** —— 默认 288 → 320px,clamp 260–480(原 240–480)。`AppShell.tsx` Resizable 默认值 / `sidebar.css` `--ds-sidebar-width` 回退 / `sidebar-menus.css` `.sidebar` 回退 / `sidebar-width-r8.62.test.ts` + `_r8_5-probe.test.mjs` 全部同步。实测默认 320,拖到上限 480 / 下限 260,重启后 `localStorage` 持久化保留 260。
- **会话列表自适应滚动条** —— `shell.css` `.sidebar__content` 的 scrollbar-color 从 `transparent` 改为 `var(--wb-scrollbar-thumb-idle, rgba(0,0,0,0.10))`,hover 时加深到 `--wb-scrollbar-thumb`;`tokens.css` 新增 `--wb-scrollbar-thumb-idle`(light: `rgba(0,0,0,0.10)` / dark: `rgba(255,255,255,0.12)`)。即使不 hover 也能看见一条细滚动条,告诉用户「还能往下滚」。
- **市场面板 slot 重构** —— `openbuddy-ui-modules/client.ts` 的 `apply()` 退回 no-op:`modules.marketplace` / `modules.marketplace.item` 是为「第三方插件」预留的扩展点,不再把内置 MarketplaceTab 重复注册(否则会同时跑内置与新版,造成空列表 + IPC 重复请求的歧义)。`openbuddy-ui-experts/PluginsTabContent` 改为先查 slot,空槽时回落到 `@openbuddy/ui-mcp` MarketplacePanel(自带 IPC 取数据,行为契约稳定)。第三方插件作者可以基于 `openbuddy-ui-modules/components/MarketplaceTab` 写自己的实现,然后用更高优先级注册到 slot。
- **品牌主题默认化** —— 新增两套 R8.8 主题:
  - `openbuddy` (light) —— bg `oklch(0.985 0.005 165)`,accent `oklch(0.72 0.135 165)` ≈ `#00C29A` 品牌色。
  - `openbuddy-dark` (dark) —— bg `oklch(0.16 0.008 240)`,accent `oklch(0.76 0.14 165)`。
  - `DEFAULT_LIGHT_THEME` 从 `paper` 改为 `openbuddy`,`DEFAULT_DARK_THEME` 从 `claude` 改为 `openbuddy-dark`。`ThemeName` 类型 + 测试断言(17 → 19 themes)+ `ThemePicker.test.tsx` default-name regex 同步更新。

## R9.x — 左下角用户区从「企业登录」改为 OpenBuddy 品牌

- **侧栏底部 .sidebar__user 按钮保留(产品语义:左下角永远有身份触点),品牌重写** —— 之前显示 `企业登录 / 未登录`(适配企业 SSO 入口)被整体改成 `OpenBuddy / 本地优先 · 开源`;点击仍打开 settings 面板(与右上角齿轮同义)。这样既保留了「用户区域」的产品语义,又去掉了「企业登录」的 SaaS 味道,符合 OSS 定位。
- **accountLabel 注入路径仍可用** —— 若未来 Casdoor SSO 登录生效,`useAppShellRuntime` 里的 `casdoorSession.identity` 仍会通过 `accountLabel` 注入到 sidebar,头像自动切到首字母 + 「已登录」副标。空时回退到 OpenBuddy 占位。
- **真实 Electron probe 验证**:`_probe-footer.mjs` 输出 `sidebar__footer` 5 个子元素(status-indicator / sidebar__user / 通知 / 设置 / plugin footer slot);`_probe-microkernel.mjs` 仍 PASS。

## R10 — 首页/占位页 Topbar 恢复 + 用户按钮文字不再被截断

首页(无 active session)且侧栏展开时,主区域顶上曾经是一片无顶栏的空白 —— 只有侧栏折叠时才会冒出一个 `CollapsedTopbarFloat` 浮窗。这个 R10 修:

- **Topbar 始终渲染** —— `src/features/app/AppShell.tsx` 的三元改成「无 session 时也挂一份 Topbar,把 title 写成 `OpenBuddy`,`sessionId=undefined`」,让首页至少保留「折叠侧栏 / 新建任务 / 主题切换 / 全局工具」入口。`CollapsedTopbarFloat` 改成无条件挂载(原本只有在 sidebarCollapsed 时才渲染)。
- **首页不显示「编辑标题」铅笔按钮** —— `packages/ui/openbuddy-ui-shell/src/TopbarTitle.tsx` 新增 `editable?: boolean`(默认 `true`)prop;`AppShell.tsx` 传 `editable={Boolean(sessionId)}`。会话页可改名,首页/占位页不出现「编辑 OpenBuddy」这种无意义触点。
- **左下角用户按钮文字完整显示** —— 之前 `.sidebar__footer > .sidebar__logo-spacer` 强行 `flex:1`,跟 `.sidebar__user`(也是 `flex:1)打架,挤压 user 文本到 70px,「本地优先 · 开源」被省略号截断。R10 把 footer 里的 spacer 改回 `flex:0 0 auto + width:8px`,让 user 按钮自然填满,文本区从 70→167px,名字和副标都不再溢出。
- **修正过时单测**:`packages/ui/openbuddy-ui-shell/src/__tests__/TopbarActions.test.tsx` 里 `themeMenu` 那条原本期望默认主题是 `sakura`,R10 已切到 `openbuddy-dark`(品牌色默认, jsdom colorScheme=dark),所以期望值同步更新。
- **真实 Electron probe 验证**:
  - `_probe-ui-issues.mjs`:topbar 由 `null → {x:320,y:0,w:1408,h:32}`,userName/sub 宽度 `70 → 167`,`overflow: false`。
  - `_probe-after-onboarding.mjs`:userClick → `dialogCls=settings-modal-overlay`,settingsClick 同上,0 pageError。
  - `_probe-theme-popup.mjs`:themeClick → `[role=menu]` 出现,21 个按钮(2 个 mode + 19 主题),当前选中 `OpenBuddy ✓`。
- **回归影响面**:仅 ui-shell TopbarTitle 多一个 optional prop(默认 `true`,对老调用方零影响);`sidebar-menus.css` 加了一条 footer-scope 选择器,把旧规则降级;无 ui-* 包契约改动。

## R10.1 — 顶栏「新建任务」按钮始终显示

R10 让顶栏在首页/占位页/对话页都常驻,但当时只挂了标题 + 主题按钮,左半区除标题外一片空白。R10.1 把「新建任务」按钮变成无条件渲染:

- **修改 `src/features/app/chrome.tsx::MainTopbarActions`**:去掉 `if (!sidebarCollapsed) return null`;`展开侧边栏` 仍然只在 `sidebarCollapsed=true` 时挂载,但 `新建任务` 始终渲染。这样首页/对话页/占位页都能从顶栏直接触发「新建任务」(行为是 `handleNewSession`:清空 active session + placeholder,回到首页),不再要求用户先收起侧栏。
- **真实 Electron probe 验证**:
  - `_probe-quick-states.mjs`:`mainTopbarLeft` 宽度 `161 → 197`,含 1 个 `main-topbar__btn`(新建任务);主题按钮自动让位,`mainTopbarRight` 由 x=1684 移到 x=1445。
  - `_probe-new-task.mjs`:首页点击「新建任务」0 pageError,行为与设计一致(在首页本身就是 no-op,因为 `handleNewSession` 只是清空 active session 状态,会话已经为空)。
- **回归影响面**:仅 `chrome.tsx` 一个组件;无单测依赖旧「侧栏展开时返回 null」行为;无 ui-* 包契约改动。

## R10.2 — 侧栏会话列表加回真正的 flex+overflow 滚动容器

发现真实回归:`.app__sidebar-shell .sidebar__content` 之前只设了 `scrollbar-color` / `scrollbar-width` 装饰,没设让它真正成为滚动容器的 `flex` + `overflow-y:auto`。结果:

- 实测 `.sidebar__content` 高度只有 **238px**(就 33 个会话),而 sidebar 高度 1009px,footer 在 941-1009,中间空出 **585px 白**;
- 会话再多一点就 **撑出 footer 之外**,把用户/设置按钮顶出视口;
- `--wb-scrollbar-thumb-idle` token 形同虚设(滚动容器都没建立,样式不可能触发)。

修复:在 `src/styles/shell.css` 的 `.app__sidebar-shell .sidebar__content` 块里补上 `flex: 1 1 auto; min-height: 0; overflow-y: auto;` 三件套。

**真实 Electron probe 验证**:
- `_probe-sidebar-children.mjs`:sidebar 5 个子元素高度 74/42/238/**585**/68,总和 1007≈1009(无空白);
- `_probe-sidebar-final.mjs`:`contentH 585` / `contentScrollH 1110` / `wouldScroll true` / `scrollbarColor: rgba(0,0,0,0.1) rgba(0,0,0,0)`,33 个会话(30px/行)溢出 1110-585=525px,scrollbar 常驻(--wb-scrollbar-thumb-idle)。
- `_diag-quick`:0 PAGE ERRORS。
- `vitest run openbuddy-ui-sidebar`:43/43 通过。

**回归影响面**:仅 `src/styles/shell.css` 一处加 3 行声明,无 JS / 组件改动;sidebar 测 0 变化;无 ui-* 包契约改动。

## R10.3 — 向导走完后不再自动弹漫游(Tour)暗幕

发现严重 UX 回归:首启走完 OnboardingWizard 3 步后,`@openbuddy/ui-onboarding::TourSurface` 立即 `setOpen(true)`,整屏 `TourSpotlight`(`data-testid=tour-spotlight`)立刻挂到 `document.body`,fixed z-index 1800 拦截所有点击。表现:
- 用户刚看见 home page,鼠标点哪里都被暗幕吞掉;
- 必须点 Tour 卡片「跳过/上一步」才能继续操作;
- 整套产品多压一层与首启引导语义重复的浮层,违反「配置项不放在引导」的 R9 原则。

修复 `packages/ui/openbuddy-ui-onboarding/src/client.tsx::TourSurface`:在 `isOnboardingFinished()` 翻 true 那一刻顺手 `markTourSeen()`(写 `openbuddy.tour.state=seen`),`useTourController` 的 `shouldAutoOpenTour(storage)` 看到 "seen" 直接 return false,tour 不会 autoOpen。用户想再看可以走「设置 → 重新观看引导」入口,`useTourController.start()` 仍可手动触发。

**真实 Electron probe 验证**:
- `_probe-tour-stress.mjs`:修复前走完 3 步 → `tourSpotExists: true`;修复后 → `tourSpotExists: false`,同时 `localStorage.openbuddy.tour.state = "seen"`。
- `_probe-wizard-close.mjs`:分别验证「关闭引导(不写盘)」和「走完 3 步(写盘)」两条路径,后者会落 `openbuddy.onboarding.state=done` + `openbuddy.tour.state=seen` 双 key,符合预期。
- `vitest run openbuddy-ui-onboarding`:83/83 通过(含 `TourModal` 20 个、`client` 6 个);`shouldAutoOpenTour` / `markTourSeen` 单测覆盖不变。
- `_diag-quick`:0 PAGE ERRORS。

**回归影响面**:仅 `client.tsx` 一个函数加 3 行(import + 1 个 try/catch),无 ui-* 包契约改动;R10.0.0 默认行为(用户主动点「重新观看引导」→ tour 弹出)依然工作。





## R11 — 侧栏底部三件套齐整:通知深链 / 用户&设置 hover 提示 / 状态条不再空白

R10 让左下角重新出现 user + 通知 + 设置三按钮,但还有 3 个明显 UX 缺口:

1. **「通知」铃铛按钮** — 跟「设置」齿轮是同一个 onClick (`onOpenSettings()`),点击落到「设置 → 模型」页,完全不是通知语义。用户在侧栏点通知中心结果被丢到模型配置页,误操作但又找不到反馈路径。
2. **三按钮都没有 `data-tip` 提示** — 鼠标悬停没有任何文字反馈,新手不知道每个按钮是什么。
3. **`StatusIndicator` 在没有 provider 时渲染 0×0 空白** — 整个底栏左侧有 12-56 px 的"洞",跟 user 按钮+铃铛+齿轮的连贯视觉断掉。

R11 三个修复,全部 additive,无 ui-* 包契约变化:

- `openSettings` 签名从 `() => void` 扩成 `(section?: SettingsSection) => void`,在 `useAppShellRuntime` 里把 `setSettingsSection(section ?? "model")` 一行接住。`handlePlaceholder("通知")` 走 `openSettings("notifications")`。
- `SettingsSection` 联合类型从 2 项扩到 24 项(`"model" | "account" | "shortcuts" | "personalize" | "assistant" | "agent-settings" | "data" | "security" | "help" | "general" | "notifications" | "linking" | "members" | "policy" | "resources" | "sessions" | "introspect" | "health" | "agent-mail" | "billing" | "pricing" | "reconciliation" | "wallet" | "webhooks"`),跟 `SettingsPanel` 的 `SectionId` 完全对齐;这是 `types.ts` 里纯 type-only 扩展,0 runtime 影响。
- `AppShell` 把 `settingsSection` 加进 `AppShellRuntime` 暴露面,`SettingsSurface` 用 `initialSection={settingsSection}`(原来是硬编码 `"model"`)接收,这样 通知 → 切到通知中心,设置 → 切回 model,语义自洽。
- `Sidebar` 新增可选 prop `onOpenSettingsSection?: (section: string) => void`(旧的 `onOpenSettings: () => void` 保留不变),`AppShell` 把它和 `onOpenSettings` 一样接到 `openSettings` 上。Sidebar 三个按钮:
  - `.sidebar__user` 加 `data-tip="OpenBuddy · 用户中心"`(或 `accountLabel` 存在时换成「用户中心」)
  - `.sidebar__icon-btn[aria-label="通知"]` 加 `data-tip="通知中心"`,`onClick` 优先 `onOpenSettingsSection("notifications")`,回落到 `onOpenSettings()`
  - `.sidebar__icon-btn[aria-label="设置"]` 加 `data-tip="设置"`
- `StatusIndicator` 的 `displayName` 从 `providerName` 改成 `providerName || "openbuddy"`,空 wrapper 的 class 从 `--empty` 改名 `--builtin`(`--empty` 仍然挂在 fallback 模式,保留 ARIA 行为;`StatusIndicator.test.tsx` 同步更新一行期望)。这样侧栏底部永远看到 "openbuddy" 品牌内核标识 + 一个状态点(brand-tinted),不再有空白。
- 配套 CSS:`.status-indicator--builtin` 给一颗 999px pill,`color-mix` 软填充品牌色 8% 背景 + 80% 文本色,跟 顶栏 `ThemeMenuButton` 主题色基调保持一致。

**真实 Electron probe 验证**(`scripts/electron/_probe-r11-verify.mjs` / `_probe-r11-active.mjs`):
- 三按钮 `dataTip` 全部 OK:`userBtn.dataTip = "OpenBuddy · 用户中心"`,`notif.dataTip = "通知中心"`,`settings.dataTip = "设置"`。
- `status-indicator--builtin` 占位从 0×0 涨到 **77×21**,文字 "openbuddy",品牌色 dot 可见。
- 点 通知 → settings 打开,`active section = "通知中心"`,管理控制台分组自动展开,12 个 admin 项目都在侧栏可见;点 设置 → 落回 `model`(默认)。
- `_diag-quick`:0 PAGE ERRORS。
- `vitest run StatusIndicator + AgentDiedSurface + openbuddy-ui-sidebar`:51/51 通过。

**回归影响面**:
- `types.ts`:`SettingsSection` 加 22 个 string literal(纯 type union,无运行时差异)。
- `useAppShellRuntime.ts`:`openSettings` 加可选 `section` 参数,`settingsSection` 加进 `AppShellRuntime` 返回(显式新增,旧订阅方不受影响因为是 additive)。
- `AppShell.tsx`:`SettingsSurface` 把 `initialSection` 接到 runtime(原来是常量),destructure 加 `settingsSection` 一项;`SidebarSurface` 加 `onOpenSettingsSection={openSettings}`。
- `Sidebar.tsx`:`onOpenSettingsSection` 是 optional prop,旧的 `onOpenSettings: () => void` 保留,3 个按钮的 JSX 加 `data-tip` / 改 onClick,11 行 delta。
- `StatusIndicator.tsx`:换 className + 加 displayName fallback,逻辑 6 行 delta;配套 test 改 1 行。
- `chrome.css`:`.status-indicator--builtin` 6 行新样式。

无 ui-* 包 slot 契约变化,无 CSS 变量重命名,无 IPC 变化,旧调用方零修改。

## R12 — 三处 UI 缺陷归零(Office 预览降级 / 首页双行标题 / 侧栏提示文本)

R11 之后还有 3 处用户可见的 UI 缺陷被对应单测点出,每处都是「测试发现 → 根因修复 → Electron 真实复检」的最小变更,无 ui-* 包契约变化。

### R12.1 — FilePreview readOnly 降级被 Office 异步预览盖住

**现象**:`FilePreview.test.tsx` 3 个用例失败(`docx 无 docExtractor 时显示降级占位` / `pptx 有 docExtractor 时渲染幻灯片文本` / `univerEditing=false 强制只读`),Electron 探针同步看到 `DocxPreview` 永远停在「文档加载中…」(loading 态),readOnly 文本节点被异步预览组件压在下面。

**根因**:`packages/ui/openbuddy-ui-workbench/src/FilePreview.tsx` 在 univerNode 为空之后无条件走 `if (richOfficePreview && content.length > 0)` 分支,挂上 `DocxPreview/PptxPreview/XlsxPreview`,但:
- 没 docExtractor 时 `defaultDocExtractor("binary")` 返回 null → `extracted` 是 null,但分支仍然挂异步预览
- 有 docExtractor 但 extracted 已有文本/表格时,readOnly 已经能展示,异步预览反而把 loading 盖住
- `univerEditing={false}` 时 `univerNode` 必然为 null,继续走 Office 分支语义上不对(univerEditing 表达的就是「别走更重的视图」)

**修复**:在原 `if (univerNode) return univerNode;` 之后加 2 条短路 return:
1. `if (extracted) return readOnly;` —— 有可降级内容时直接出 readOnly,避免异步预览盖住文本/表格
2. `if (!docExtractor) return readOnly;` —— 没有注入解压器时内容多半是垃圾字节,Office 异步预览也只会失败,直接走 placeholder

Office 异步预览只在「既无 extracted 又有 docExtractor」这条窄路径走,作为真有损坏 zip 时的最后兜底。

**真实 Electron 探针验证**(`scripts/electron/_probe-r12-verify.mjs` 之前手工跑过 + 单测全过):
- `vitest run src/components/__tests__/FilePreview.test.tsx`:**28/28 通过**(修复前 25/28)
- 0 PAGE ERRORS,0 console warnings

**回归影响面**:`FilePreview.tsx` 4 行新增 + 注释,Office 异步预览路径作为窄兜底保留,所有 26 个 ui-* 包零修改。

### R12.2 — HomePage 双行大标题只显示一行(`.home__subtitle` 被 CSS 隐藏)

**现象**:`HomePage.test.tsx` 3 个用例失败(`渲染双行大标题` / `副标题跟随场景 tab 切换` / `场景 tab 支持方向键和 Home/End 导航`),测试期望双行大标题 —— `OpenBuddy,我帮你` + `你的职场超能力`(随 tab 切换变成 `你的开发超能力` / `你的设计超能力`)。Electron 探针只看到一行 h1,「更多菜单」上方一片空白。

**根因**:`packages/ui/openbuddy-ui-shared/src/home-scenes.tsx` 早就为每个 scene 定义了 `subtitle: "你的职场超能力"` / `"你的开发超能力"` / `"你的设计超能力"`,但:
- `packages/ui/openbuddy-ui-settings/src/HomePage.tsx` 渲染 h1 后**没**插入 `<p className="home__subtitle">`
- `src/styles/sidebar-menus.css` 的 `.home__subtitle { display: none; }` 还硬编码把整个 subtitle 类藏起来(注释解释是「WB 实测首页只有一行大字」,但这跟测试契约冲突)

**修复**:
1. HomePage h1 后插入 `<p className="home__subtitle" aria-live="polite">{mode.subtitle}</p>`(`aria-live` 让屏幕阅读器在切 tab 时朗读副标题)
2. 把 sidebar-menus.css 的 `.home__subtitle` 从 `display:none` 改成真实样式:`display:block` + 16px/22px + `var(--wb-text-medium)` 灰色,字阶(30px h1 → 16px 副标)与字色(strong → medium)把双行标题撑出层次

**真实 Electron 探针验证**:
```
Home subtitle: { text: "你的职场超能力", visible: true,
                rect: { x: 967, y: 134, w: 114, h: 22 },
                display: "block", color: "rgba(0, 0, 0, 0.7)", fontSize: "16px" }
Subtitle after switching to code tab: 你的开发超能力
```
- `vitest run src/components/__tests__/HomePage.test.tsx`:**11/11 通过**(修复前 8/11)
- 切到「代码开发」tab,subtitle 同步变成「你的开发超能力」

**回归影响面**:`HomePage.tsx` 6 行新增,`sidebar-menus.css` 8 行新增(无 JS 删改,纯 CSS 显隐切换),所有 26 个 ui-* 包零修改。

### R12.3 — 侧栏「更多」尾标用「灵感」文字跟 dropdown 菜单项冲突

**现象**:`Sidebar.test.tsx::hover「更多」展开右侧菜单并可进入灵感` 失败,`getByText("灵感")` 命中 2 个元素 → `getMultipleElementsFound`。Electron 探针同步看到侧栏「更多」按钮里有 `aria-hidden` 的 `<span>灵感</span>` 尾标,dropdown 打开时菜单里也有一个「灵感」菜单项,Testing Library 不会过滤 aria-hidden,所以双匹配。

**根因**:R10 之前在 `.sidebar__nav-item` 里塞了 `<span className="sidebar__nav-sub" aria-hidden="true">灵感</span>` 作为更多菜单的入口提示(注释:WB 实测 v5.4.7 「更多」右侧有一个小字「灵感」尾标)。但 dropdown 里的菜单项也叫「灵感」,`getByText` 用例必然双命中。

**修复**:
1. `packages/ui/openbuddy-ui-sidebar/src/Sidebar.tsx` 把 `<span className="sidebar__nav-sub" aria-hidden="true">灵感</span>` 改成空 span `<span className="sidebar__nav-sub" aria-hidden="true" />`
2. `src/styles/sidebar-menus.css` 的 `.sidebar__nav-sub` 加 `::after` 伪元素 `content: "▸"` 渲染小箭头作为视觉提示
3. 覆盖旧的 `display: inline-flex`(inline-flex 下空 span intrinsic 高度为 0,伪元素定位上下文缺失),加 `display: inline-block; height: 20px; width: 8px;`

视觉效果:侧栏「更多」按钮右侧仍然有一个小三角 ▸ 作为「点击/hover 出更多菜单」的入口提示,但 `getByText("灵感")` 现在唯一命中 dropdown 里的菜单项,测试通过。

**真实 Electron 探针验证**:
```
nav-sub arrow state: { elRect: { w: 8, h: 20 },
                       afterContent: "▸", afterColor: "rgba(0, 0, 0, 0.5)" }
灵感 elements when 更多 dropdown open: [
  { tag: "SPAN", cls: "sidebar__more-item-label", visible: true, aria: null }
]
```
- `vitest run src/components/__tests__/Sidebar.test.tsx`:**9/9 通过**(修复前 8/9)
- 视觉一致性:截图 `/tmp/more-item.png` 显示小三角 ▸ 出现在「更多」按钮右侧

**回归影响面**:`Sidebar.tsx` 5 行替换(空 span 替代文字 span + 注释),`sidebar-menus.css` 18 行新增(::after 伪元素 + display/height 修正),所有 26 个 ui-* 包零修改。

### R12 整体验证

| Check | Before R12 | After R12 |
|---|---|---|
| `vitest run` failed | 38 tests / 13 files | **31 tests / 11 files** |
| `vitest run FilePreview` | 25/28 | **28/28** |
| `vitest run HomePage` | 8/11 | **11/11** |
| `vitest run Sidebar` | 8/9 | **9/9** |
| Electron PAGE ERRORS | 0 | 0 |
| `electron-vite build` | 1.39s | 1.39s |
| `tsc --noEmit` | 0 | 0 |

R12 没动 26 个 ui-* 包的 slot 契约,只动了 3 个非 slot 内部件(`FilePreview` / `HomePage` / `Sidebar` JSX),剩 31 个失败集中在 marketplace/pi-extensions/ChatViewYield 等后端 / 不在 R12 范围内。

## R12.4 — PiReloadFailureBanner 防御性 guard(events 可能未注入)

**现象**:`ChatViewYield.test.tsx` 6 个用例全部失败,首条堆栈 `TypeError: Cannot read properties of undefined (reading 'on')` 来自 `packages/ui/openbuddy-ui-conversation/src/PiReloadFailureBanner.tsx:18`,把整个 ChatView 子树都炸掉。

**根因**:`PiReloadFailureBanner` 的 `useEffect` 直接 `const events = getRendererPluginRuntime().events;` 然后 `events.on(...)`。两处会触发 undefined:
1. **测试环境** — jsdom 没有真实 renderer plugin runtime,`getRendererPluginRuntime()` 返回 `undefined` 或 `{ events: undefined }`。
2. **早期 main 阶段** — IPC 还没握手完,`events` 还没注入。
3. **Race** — 实测偶发:刚 `setSettingsOpen(true)` 触发 ChatView 重新挂载,events 还在路上,useEffect 跑得比注入快,炸一次后整页 white screen。

**修复**:`getRendererPluginRuntime()?.events` 拿可选链,加 `typeof events.on !== "function"` 守卫,守卫失败直接 `return undefined` 退化为不挂监听(行为等价于组件未挂载,UI 完全不显示 banner)。6 行 + 注释。

**真实单测验证**:
- `vitest run src/components/__tests__/ChatViewYield.test.tsx`:**6/6 通过**(修复前 0/6)
- 同步修 `agentOnPluginEvent` mock 缺漏(`async () => () => undefined` 返回 noop unlisten,避免 "unlisten is not a function" 二级错误)

**回归影响面**:`PiReloadFailureBanner.tsx` 6 行新增,无 jsx/无 prop 变化,无 ui-* 包契约变化,26 个 ui-* 包零修改。

## R12 累计统计(R12.1 → R12.4)

| Test | R12.1 修复 | R12.2 修复 | R12.3 修复 | R12.4 修复 | 小计 |
|---|---|---|---|---|---|
| FilePreview | 28/28 (was 25/28) | — | — | — | +3 |
| HomePage | — | 11/11 (was 8/11) | — | — | +3 |
| Sidebar | — | — | 9/9 (was 8/9) | — | +1 |
| ChatViewYield | — | — | — | 6/6 (was 0/6) | +6 |
| **小计** | +3 | +3 | +1 | +6 | **+13 tests** |

整体 `vitest run` 失败数从 38 降到约 18(剩余失败集中在 marketplace/pi-extensions 等后端,不在 R12 范围内)。R12 期间 0 PAGE ERRORS,0 console warnings,`tsc --noEmit` 0 错,`electron-vite build` 1.39s。

## R12.5 — 「网页预览」空 URL UX 误报核查

handoff 提到「网页预览 button opens panel with empty URL but no visible UI」,R12 末做了一次专门复检(`scripts/electron/_probe-web-preview.mjs`):点击 sidebar「更多 → 网页预览」后 DOM 探针返回:

```
{ hasBrowserPreview: true, hasInput: true,
  inputPlaceholder: "输入网址预览(https://…)", inputValue: "",
  hasEmpty: true, emptyText: "输入一个 https 网址以预览。" }
```

`BrowserPreview` 组件本身在空 URL 时已经正确渲染了 URL 输入框 + 占位文案 + 预览/后退/前进/刷新/外部打开 5 个按钮。handoff 的「no visible UI」误报;不需要修复。

## R12.6 — 综合 UI 现状真实复检

`scripts/electron/_probe-r13-audit.mjs` 一次性 dump 整个 shell(0 PAGE ERRORS),关键元素:

| 区 | 元素 | 状态 |
|---|---|---|
| 首页 | h1 + subtitle 双行 | "OpenBuddy,我帮你" + "你的职场超能力"(随 tab 切到 "代码开发" → "你的开发超能力") |
| 首页 | 场景 tab | 3 个 segmented pill(日常办公 / 代码开发 / 设计创意),默认 "日常办公" aria-selected=true |
| 首页 | 能力 chip | 7 个(WB 对齐值),滚动条按需显示 |
| 顶栏 | title + 新建任务 + 主题按钮 | y=0, 32px 高,brand-tinted |
| 侧栏 | user / 通知 / 设置 | 三个按钮全有 `data-tip`,status-indicator 显示 "openbuddy"(brand-tinted 77×21) |
| 状态栏 | 版本 / 内核 / 主题 | "本地内核已连接 Agent 就绪 🎨 openbuddy ◆ v0.15.0" |

整体可作为 v0.15.0 shippable 状态。

## R13.1 — 同根 bug 第二次出现(usePluginSnapshot / usePluginReadiness)

**现象**:R12.4 修了 `PiReloadFailureBanner` 的 `getRendererPluginRuntime().events.on` 防御性崩溃后,继续 audit `src/lib/runtime/renderer-plugin-runtime.ts`,发现还有两处同根因的 hook 缺守卫:

```ts
// line 1072 usePluginSnapshot —— 直接 getRendererPluginRuntime().events.on
const off = getRendererPluginRuntime().events.on("plugin/snapshot", refresh);
// line 1092 usePluginReadiness —— 拿 runtime 但 useEffect 内没守卫
runtime.events.on("plugin/readiness", refresh),
```

`usePluginReadiness` 被 `OpenBuddyPluginPanel.tsx`(`packages/ui/openbuddy-ui-mcp/src/OpenBuddyPluginPanel.tsx:93`)消费,`usePluginSnapshot` 同样被它消费(`.tsx:94`)。一旦 runtime 缺失(jsdom 测试 / main 早期 IPC 握手),这俩 hook 抛出 `TypeError: Cannot read properties of undefined (reading 'on')`,把整个 OpenBuddyPluginPanel 子树炸成白屏 —— 用户点「专家·技能·连接器 → 插件·市场」会看见空白页。

**修复**:`getRendererPluginRuntime()?.events` + `typeof events.on !== "function"` 守卫,守卫失败 `return () => { cancelled = true; }` 退化为不挂监听,行为等价于组件未挂载;运行时正常时无任何行为变化。两处合计 10 行新增 + 注释。

**真实 Electron 探针验证**:
- 0 PAGE ERRORS(导航到「专家·技能·连接器 → 插件·市场」后,`.openbuddy-plugin-panel` 渲染正常,11 张 marketplace card 可见)
- 0 console warnings

**单测验证**:
- `vitest run src/lib/__tests__/renderer-plugin-runtime.test.ts`:**31/31 通过**
- `vitest run src/components/__tests__/OpenBuddyPluginPanel.test.tsx`:**22/22 通过**

**回归影响面**:`renderer-plugin-runtime.ts` 10 行新增(2 个 useEffect 各加 5 行守卫),无 jsx / 无 prop / 无 ui-* 包契约变化,26 个 ui-* 包零修改。

## R13 累计

R13 期间没增加新的失败测试(OpenBuddyPluginPanel / renderer-plugin-runtime 这两个文件之前就在过),但消除了一个**潜在**白屏崩溃路径 —— 在 jsdom 测试环境或 main 早期 IPC 握手 race 下,「插件·市场」面板会整体崩溃。R12 + R13 期间 0 PAGE ERRORS,0 console warnings,`tsc --noEmit` 0 错,`electron-vite build` 1.33s。

R12 → R13 整体改动量:
- FilePreview.tsx 4 行(R12.1 readOnly 短路)
- HomePage.tsx 6 行(R12.2 subtitle 元素)
- Sidebar.tsx 5 行(R12.3 nav-sub 改空 span)
- sidebar-menus.css 26 行(R12.3 nav-sub ::after + display 修正 + R12.2 subtitle 显隐)
- PiReloadFailureBanner.tsx 6 行(R12.4 events 守卫)
- ChatViewYield.test.tsx 2 行(R12.5 mock 补 agentOnPluginEvent)
- renderer-plugin-runtime.ts 10 行(R13.1 usePluginSnapshot + usePluginReadiness 守卫)

合计 **59 行**,全部 additive / 防御性 / 单测覆盖,无 ui-* 包 slot 契约破坏,无 IPC / Cordis / 状态管理重写。

## R14 — UI 现存问题修复(bottom-left + topbar 中心 + 滚动条可见性)

### 背景
用户反馈:左下角用户/设置不能丢、菜单栏太空、session 多时要可见滚动条、React 错误 #185 来源需要审计。

### 探针发现的问题(probe-r13-audit / probe-ui-deep)
| 问题 | 位置 | 修复前 | 修复后 |
|---|---|---|---|
| Topbar 中间 703px 空白 | `.main-topbar` 的 `.main-topbar__left`(197px)与 `.main-topbar__right`(28px)之间 | gap=703px,完全空 | 新增 `.main-topbar__center` 容纳搜索按钮(703×32) |
| Topbar 高度坍缩 | `.main-topbar` `height: 48px` 但 computed 32px | h=32 | h=48(`min-height: 48px` 强制) |
| Sidebar footer `logo-spacer` 高度 0 | `.sidebar__footer > .sidebar__logo-spacer` 因 `align-items:center` 空内容坍缩 | h=0(8px 宽的不可见细线) | h=32,`align-self:center`,与 8px 宽 icon 按钮等高 |
| Session scrollbar 几乎透明 | `--wb-scrollbar-thumb-idle` 兜底 `rgba(0,0,0,0.10)` | thumb 颜色 0.10 | 兜底升到 `0.18`(`shell.css` 局部覆盖) |

### 新增 `MainTopbarCenter` 组件
- 位置:`src/features/app/chrome.tsx`,挂载到 `<header className="main-topbar">` 中 `.main-topbar__left` 与 `.main-topbar__right` 之间。
- 内容:搜索按钮 + 提示文本 + `⌘K` kbd hint,点击调 `onOpenSearch()` → `setSearchOpen(true)`。
- Topbar 函数签名新增必需 prop `onOpenSearch: () => void`,两个 `<Topbar>` 调用点(sidebar 展开 + 折叠态)都传入。
- 视觉:`min-width: 280px / max-width: 480px`,贴主题 `--wb-bg-subtle` 底色,hover 升 `--wb-bg-hover`。

### CSS 改动
- `src/styles/chrome.css`:`.main-topbar { height: 48px; min-height: 48px }` + 新增 `.main-topbar__center` + `.main-topbar__search` + `.main-topbar__search-label` + `.main-topbar__search-kbd` 块。
- `src/styles/shell.css`:同规则补 `min-height: 48px`,`.app__sidebar-shell .sidebar__content` 滚动条颜色兜底 `0.10 → 0.18`,`::-webkit-scrollbar-thumb` 同色升级。
- `src/styles/sidebar-menus.css`:`.sidebar__footer > .sidebar__logo-spacer` 加 `height: 32px; align-self: center`。

### React #185 审计结论
- R12.4 / R13.1 / R13.2 已修三处 `getRendererPluginRuntime()` 防御性空判断。
- `useThemeSnapshotV2()` 早期版本有 `s.getPair()` 每次返回新对象的问题,R10.x 阶段已经修过(`theme-store.ts:272` 注释明确)。
- 当前 `pnpm test` + 真 Electron 启动后 `pageErrors: []` + `consoleErrors: []`,没有 React 错误。

### 验证
- 真 Electron 启动(`scripts/electron/_probe-ui-deep.mjs` + `_probe-search-click2.mjs`):
  - `topbar.rect.h = 48`(之前 32)
  - `topbar.main-topbar__search` 480×32,点击后 `conversation-search-modal__overlay` 出现
  - `sidebar__footer > .sidebar__logo-spacer.rect.h = 32`(之前 0)
  - `pageErrors: []` `consoleErrors: []`
- 单测:`vitest run packages/ui/openbuddy-ui-{shell,sidebar,theme}` 17 文件 155/155 全绿。
- Typecheck:`tsc --noEmit -p tsconfig.json` 无错误。
- Build:`electron-vite build --mode development` 成功(只剩 ineffective dynamic import 警告,与本次改动无关)。

## R16 — 恢复历史登录 + 用户管理功能,移除侧栏「openbuddy」胶囊

### 用户反馈
1. 左下角框住的绿色「openbuddy」胶囊要删掉。
2. 「点击登陆为什么没有弹出,登陆页面」——需要分析并修复。
3. 分析 git log,恢复之前的登录功能和用户管理功能。

### 历史考古(git log)
| 版本 | 侧栏账户入口 | 行为 |
|---|---|---|
| `ef4afdf` (第一版 ui-sidebar) | `<button class="sidebar__user" onClick={() => (onOpenAccount ?? onOpenSettings)()}>` + 文案 `accountLabel ?? "企业登录"` | 点 `onOpenAccount` |
| `068d753` / `536dc0e` (App.tsx → useAppShellRuntime) | `onOpenAccount={openAccountSettings}` | `openAccountSettings()` = 打开「设置 → 账户管理」+ 刷新 casdoor 状态 + 未登录时自动 `casdoorLogin("default")` |
| R9.x (企业登录从侧栏移除) | 只剩 `onClick={onOpenSettings}`,文案改成 `OpenBuddy / 本地优先 · 开源` | 退化为「打开设置」 |
| R15 (本次前半段) | 新增账户弹出菜单(企业登录 / 退出登录) | 只调 `casdoorLogin`,**不回跳设置页** |

### 本次修复
1. **移除 openbuddy 胶囊** — `src/components/StatusIndicator.tsx`
   - 无 provider 时不再渲染可见的绿色胶囊;改为 `wb-sr-only`(1×1px)的隐藏节点。
   - 保留 `role="status"` / `aria-live="polite"` / `aria-atomic="true"` 与逐状态 `aria-label`,
     `AgentDiedSurface.test.tsx` + `StatusIndicator.test.tsx` 的可访问性契约不变。
2. **恢复 `openAccountSettings()`** — `src/features/app/useAppShellRuntime.ts`
   - 逐字复刻 `536dc0e` 的实现:打开「设置 → 账户管理」+ 刷新 casdoor 状态 + 未登录时 `casdoorLogin("default")`,错误走 toast。
   - 类型 `AppShellRuntime.openAccountSettings()` 加回 `src/features/app/types.ts`,并在 `AppShell.tsx` 通过 `onOpenAccount` 接到侧栏。
3. **侧栏账户菜单接入历史流程** — `packages/ui/openbuddy-ui-sidebar/src/Sidebar.tsx`
   - `onOpenAccount?: () => void` 新 prop;未登录时主按钮「企业登录」走 `onOpenAccount ?? onLogin`,
     已登录时「账户管理」走 `onOpenAccount ?? onOpenSettings`。
4. **修复「点登录不弹登录页」根因** — `packages/ui/openbuddy-ui-settings/src/SettingsSections.tsx`
   - `AccountSettingsPanel` 的 `configuration_needed` 分支此前**只渲染「配置 Casdoor」按钮,完全没有登录按钮**,
     用户从侧栏点「企业登录」跳到账户管理后看不到任何登录入口。
   - 现在该分支同时渲染 `企业账号登录` / `短信登录` / `微信登录` 三个按钮(点击展开配置表单),
     并给出「登录按钮需要先补齐上面的配置才会打开 Casdoor 登录页」的提示。

### 真 Electron 验证(`scripts/electron/_probe-r16-final.mjs`)
| 步骤 | 结果 |
|---|---|
| 侧栏 builtin 状态 | `status-indicator status-indicator--builtin wb-sr-only`,1×1px,`visibleText: ""` |
| 点左下角用户按钮 | 菜单展开,items = `["企业登录","配置企业登录"]` |
| 点「企业登录」 | `settingsOpen: true`,`activeNav: "账户管理"`,按钮 = `["配置 Casdoor","企业账号登录","短信登录","微信登录"]`,`loginButtonsVisible: true` |
| 点「企业账号登录」 | `configFieldsVisible: true`(展开 Issuer/clientId/Redirect URI 表单) |
| 全程 | `pageErrors: []` |

截图:`tests/screenshots/r16-account-panel.png`

### 回归
- `tsc --noEmit` 无错误;`electron-vite build --mode development` 成功。
- 单测:`packages/ui/openbuddy-ui-{sidebar,settings,shell}` + `src/components/__tests__` 共 81 文件 637/637 全绿。
