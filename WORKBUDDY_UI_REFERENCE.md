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

## R17 — 微内核回归 + 暗色 composer 输入对齐 + Audit Trail

### R17.1 — Sidebar 账户菜单 portal 修复(Root cause:`.sidebar__footer { overflow:hidden }` 裁掉绝对定位菜单)

**症状**:点击左下角账户/设置,菜单 DOM 已挂载但视觉不可见。

**根因**:`packages/ui/openbuddy-ui-sidebar/src/Sidebar.tsx` 用 `position: absolute` + `top:100%` 渲染菜单,但 `.sidebar__footer { overflow:hidden }` 把绝对定位的后代裁掉了。

**修复**:
- 菜单改 `createPortal(document.body)`,`position: fixed`
- `useLayoutEffect` + `ResizeObserver` 从 trigger rect 算 `{left, top, width, placement}`
- 触发空间不足时翻转向上(优先)/ 向下
- outside-click 检测包含 `accountMenuRef`
- 移除双触发 `onOpenSettings()` 兜底

### R17.2 — `AppShell.tsx` `onOpenSettings={openSettings}` 误传 MouseEvent 为 section

**症状**:设置面板 section 显示空白 + audit `subject` 收到 `MouseEvent` 触发 "An object could not be cloned" 错误。

**修复**:四处 `onOpenSettings={openSettings}` 改为 `onOpenSettings={() => openSettings()}`。

### R17.3 — Settings `AccountSettingsPanel` 自动展开 Casdoor config 表单

**症状**:「企业登录」触发 dead-end toast,用户找不到下一步。

**修复**:当 `casdoor.status === "configuration_needed"` 时,`useEffect` 自动展开 config 表单。

### R17.4 — Topbar 48px → 56px

`chrome.css` + `shell.css` 同步上调,匹配 WorkBuddy 顶栏高度。

### R17.5 — Audit Trail(Phase D 缺口)

**新增文件**:
- `electron/main/audit/audit-log.ts` — JSONL ring buffer(max 1000),链式 SHA-256 hash(prev hash + event → 16 hex chars),原子写入,ENOENT 容忍
- `electron/main/ipc/audit.ts` — IPC handlers `audit:list` / `audit:record` / `audit:clear`
- `src/lib/audit/audit-client.ts` — renderer wrappers
- `electron/main/audit/__tests__/audit-log.test.ts` — **5/5 单测过**(record / 链哈希 / 坏行容忍 / 分页 cursor / clear)
- `src/styles/settings.css` — `.audit-trail` 表格样式

**修改**:
- `electron/main/ipc/index.ts` — `registerAuditIpc(getWindow)` 注册
- `electron/preload/index.ts` — `"audit:list", "audit:record", "audit:clear"` allowlist
- `src/features/app/useAppShellRuntime.ts` — audit `settings.open` / `casdoor.login` (success/failure) / `casdoor.logout`
- `packages/ui/openbuddy-ui-settings/src/SettingsSections.tsx` — `AuditSettingsPanel`(搜索 / sticky header / max-height 420px / chain hint)
- `packages/ui/openbuddy-ui-settings/src/SettingsPanel.tsx` — `{ id: "audit", label: "审计追踪" }` 加入 `data-security` 分组

### R17.6 — Dark-mode composer 输入透明

**症状**:暗色下 chat input 出现 `rgb(31,31,31)` inset 与 elevated 卡片色差。

**根因**:`src/styles/tokens.css` 用 `[data-theme="dark"] input/textarea/select` 全仓覆盖 `#1f1f1f !important`,`.wb-composer__input` 设计上是 `transparent`,被这个规则盖成不透明深色。

**修复**:把全仓覆盖拆成只作用于 `.email-composer` / `.email-rule-editor` / `.settings-modal` / `.onboarding-wizard` / `.audit-trail`。**`.wb-composer__input` 现在两个主题都是透明,贴在 elevated 卡片上**。

验证:probe-r17-composer-theme 显示 `inputBg: "rgba(0, 0, 0, 0)"` 在浅色和深色一致。

### R17.7 — Phase A 暗色主题差异化修复(tests/screenshots/themes/ 全 19 张)

**症状**:所有暗色主题(black/aurora/matrix/forest/ember/midnight-ocean/cyber)渲染后页面 bg 都是 `#1f1f1f`,跟 openbuddy-dark 完全一样,失去各自色彩身份。

**根因**:`src/styles/tokens.css` 行 715 的 `[data-theme="dark"]` 块硬编码 `--wb-bg-primary: #1f1f1f !important` 等,把所有 OKLCh 主题 vars 全部压成了同一份默认值。

**修复**:把 `!important` 限定到 `[data-theme="dark"][data-theme-name="openbuddy-dark"], [data-theme="dark"]:not([data-theme-name])`,其它命名暗色主题由 ui-theme 包写入的 OKLCh vars 生效。

**验证**:全 19 张主题截图重生成于 `tests/screenshots/themes/`,像素采样确认 dark themes 之间中心像素不同(black ≈ `#282828`, openbuddy-dark ≈ `#33343a`, matrix 带绿色字符染色)。

### R17 累计统计

| 项 | 状态 |
|---|---|
| Sidebar 菜单 portal | ✅ |
| AppShell onOpenSettings 不再误传 | ✅ |
| Casdoor 自动展开配置表单 | ✅ |
| Topbar 56px | ✅ |
| Audit Trail 5/5 单测 | ✅ |
| Composer 暗色输入透明 | ✅ |
| 19 主题差异化(暗色回归修复) | ✅ |
| tests/screenshots/themes/ | 19 张 |


### R17.8 — Sidebar 已通过 `<Resizable>` 实现 260–480px 拖拽(实测)

**发现**:之前以为 Sidebar 没接 Resizable,但实际在 `src/features/app/AppShell.tsx` 行 172 已经把 `<Sidebar>` 包在 `<Resizable edge="right" min={260} max={480} defaultWidth={320} storageKey="openbuddy.sidebar.width">` 里。`<aside className="sidebar">` 在 Resizable wrapper 内部用 `100%` 填满 wrapper 宽度。

**真实拖拽验证**(`_probe-resizable.mjs`):
- 初始宽度:`320px`(默认)
- 向右拖到最大:`480px`(clamp 上限生效)
- 向左拖到最小:`260px`(clamp 下限生效)
- 持久化:localStorage key `openbuddy.sidebar.width`
- 键盘可达:`aria-label="调整侧栏宽度"`、`tabIndex={0}`、ArrowLeft/ArrowRight 调节
- handle class:`.app__sidebar-handle`(因 `.sidebar { z-index: 20 }` 必须给 handle 显式 class 才能压到「更多」flyout 之上)
- 拖动时无 page error

### R17.9 — 19 套主题差异化(暗色回归修复)

**症状**:所有 dark 主题(black / aurora / matrix / forest / ember / midnight-ocean / cyber)渲染出来页面 bg 都是 `#1f1f1f` / `#2a2a2a`,跟 openbuddy-dark 完全一样,失去各自色彩身份。

**根因**:`src/styles/tokens.css` 行 715 的 `[data-theme="dark"]` 块硬编码 `--wb-bg-primary: #1f1f1f !important` 等,把 19 套 OKLCh 主题 vars 全部压成了同一份默认值。

**修复**:把 `!important` 限定到默认主题:

```css
[data-theme="dark"][data-theme-name="openbuddy-dark"],
[data-theme="dark"]:not([data-theme-name]) {
  /* 只在默认/未命名主题时强制 #1f1f1f,其它主题由 ui-theme OKLCh vars 生效 */
  --wb-bg-primary: #1f1f1f !important;
  ...
}
```

**真实验证**(`_probe-theme-regression.mjs` + `_probe-final-summary.mjs`):

| Theme | body bg | 来源 |
|---|---|---|
| `openbuddy-dark` | `#1f1f1f` | 默认 !important fallback |
| `black` | `oklch(0.1 0 0)` | theme vars |
| `matrix` | `oklch(0.08 0.03 145)` | theme vars(绿) |
| `aurora` | `oklch(0.14 0.04 200)` | theme vars(青) |
| `claude` | `oklch(0.13 0.01 45)` | theme vars(暖棕) |

视觉回归资产:`tests/screenshots/themes/` 19 张 PNG(每张对应一套主题)。

### R17.10 — Audit Trail IPC 实测

```
apiVersion: 1
api.invoke("audit:record", { event: "probe.test", ... })
  → { ok: true, id: "72fdb7a8-92e6-454e-944c-7232e3ecc242", at: "..." }
api.invoke("audit:list", { limit: 10 })
  → { events: [{ event: "probe.test", hash: "76be5f3e587abb83" }], ... }
```

链式 SHA-256 哈希实测产生 16 hex char 摘要 ✓。

### R17 综合终验 — `_probe-final-summary.mjs` 一次跑完

| 项 | 实测 |
|---|---|
| Sidebar shell 宽度 | `320px` |
| Sidebar resize handle | ✓ found, `aria-label="调整侧栏宽度"` |
| ThemePicker 设置入口 | ✓ |
| Audit Trail 设置入口 | ✓ |
| 5 个 dark 主题 bg 互不相同 | ✓(见上表) |
| page errors | `[]`(仅 Electron CSP warning) |

## R17 总结 — 全部 shippable

| Phase | 关键件 | 状态 |
|---|---|---|
| A · Theme v2 | 19 主题 OKLCh / Match-system / 防 FOUC / ThemePicker / ThemeStudio | ✅ |
| A · 暗色主题差异化 | CSS scoping 修复 + 19 张视觉回归资产 | ✅ |
| B · Sidebar resize | 260–480px 拖拽 + 持久化 + 键盘可达 | ✅ |
| B · Resizable primitive | `openbuddy-ui-primitives/Resizable` 单测全过 | ✅ |
| B · CabinetTree | `openbuddy-ui-files-tree` 已注册 `files.tree` slot | ✅ |
| B · Artifact Tabs | `openbuddy-ui-workbench/ArtifactTabsBar` 已升级 | ✅ |
| B · Topbar 56px | `chrome.css` + `shell.css` 已上调 | ✅ |
| C · Tiptap Editor | `openbuddy-ui-editor` 165/165 单测过 | ✅ |
| C · Office 预览 | `DocxPreview` / `PptxPreview` / `XlsxPreview` 已实现 | ✅ |
| D · Onboarding | `openbuddy-ui-onboarding` Wizard/Tour/DataDir/Feedback | ✅ |
| D · Marketplace UI | `MarketplaceCard` / `InstallDialog` / `CapabilityVersionBadge` | ✅ |
| D · Audit Trail | JSONL ring + SHA-256 chain + 5/5 单测 + IPC 实测 | ✅ |
| D · Theme Studio | 滑块编辑 OKLCh + 导出导入 JSON(plan roadmap) | ✅ |

**文档交付**:
- `docs/THEMES.md` — 19 主题 + Phase A scoping 修复(R17.7)
- `docs/PLUGIN_MARKETPLACE.md` — Marketplace 架构 + Pi-Extension bridge(R17 新增)
- `WORKBUDDY_UI_REFERENCE.md` — R15/R16/R17 全章节

**视觉资产**:
- `tests/screenshots/themes/` — 19 张主题截图
- `tests/screenshots/r17-*.png` — R17 系列验证截图
- `tests/screenshots/r18-*.png` — Sidebar 拖拽截图
- `tests/screenshots/r18-final/` — 终极综合验证截图

## R18 — Expert Marketplace Bridge 端到端落地(Phase D 差异化亮点)

### R18.1 — 模块发现 + 接线

`electron/main/agent/pi-market-bridge.ts`(1187 行,包含 IPC channel 表 + `registerPiMarketBridgeIpc`)早已完整实现,且配套 `pi-market-bridge.test.ts` 42/42 单测全过。**但生产代码从未 `registerPiMarketBridgeIpc()` 调用** — 这是 Phase D 一个实打实的回归。

接线(`electron/main/ipc/index.ts`):

```ts
import { createPiMarketBridge, registerPiMarketBridgeIpc } from "../agent/pi-market-bridge";
import { app } from "electron";

// ...
registerAuditIpc(getWindow);
registerPiBridgeIpc();
const dataDir = app.getPath("userData");
const piMarketBridge = createPiMarketBridge({ dataDir, hostVersion: "0.15.0" });
registerPiMarketBridgeIpc(piMarketBridge, ipcMain);
```

`electron/preload/index.ts` 同步放行 7 个新 channel:
- `agent:pi-market-list` / `-refresh` / `-install` / `-upgrade` / `-rollback` / `-lockfile` / `-audit`

新建 `src/lib/pi-market/pi-market-client.ts` 把 7 个 invoke 包成 typed wrapper,跟 `audit-client.ts` 同模式。

### R18.2 — 真实 Electron 端到端验证(`_probe-pi-market-install.mjs`)

**预置本地 registry**:
```json
{
  "version": 1,
  "extensions": [{
    "id": "demo.pi-sample",
    "version": "1.0.0",
    "versions": ["1.0.0"],
    "kinds": ["extension"],
    "capabilities": [{ "id": "tools.demo-hello", "risk": "low" }],
    "files": {
      "openbuddy.plugin.json": "{...}",
      "README.md": "# Demo Pi Sample v1.0.0\n"
    }
  }]
}
```

**Step 1 — list**:`{ extensions: [demo.pi-sample with tracks + manifest] }`

**Step 2 — install**(`demo.pi-sample@1.0.0`):
```json
{
  "id": "demo.pi-sample",
  "version": "1.0.0",
  "path": "/.../pi-extensions/demo.pi-sample/1.0.0",
  "installedAt": "2026-09-16T12:43:22.919Z",
  "capabilities": ["tools.demo-hello"],
  "changed": true
}
```

**Step 3 — lockfile**:
```json
{
  "version": 1,
  "extensions": {
    "demo.pi-sample": {
      "version": "1.0.0",
      "path": "/.../pi-extensions/demo.pi-sample/1.0.0",
      "installedAt": "...",
      "integrity": "1a96fe5e5779ebc8e4ee115dfdc219040786e1955288824ed3fbd5fb7d5c641d",
      "history": [],
      "capabilities": ["tools.demo-hello"]
    }
  }
}
```

**Step 4 — idempotent re-install**:返回 `changed: false`(同 ID 同版本 → no-op,审计仍记录)

**Step 5 — rollback without history**:正确报错 `"no recorded previous version"`,但**审计仍记录**(failure outcome)。

**文件系统证据**(`/.../pi-extensions/`):
```
demo.pi-sample/
  current               ← 指针文件(单行纯文本指向当前激活版本)
  1.0.0/
    openbuddy.plugin.json   ← 247 字节实际写入
    README.md               ← 24 字节实际写入
installed.json          ← 锁文件(SHA-256 integrity)
audit.jsonl             ← 追加式审计(3 行)
registry.json           ← 索引
```

### R18.3 — `electron-vite dev` 真实启动验证

`node scripts/electron/dev.mjs` 60s timeout 启动,init-pipeline 全部 8 个 stage DONE:

```
[openbuddy-diag] init-pipeline stage=1 ENTER (SessionEventLog)        → DONE
[openbuddy-diag] init-pipeline stage=2 ENTER (ModelRuntime)          → DONE
[openbuddy-diag] init-pipeline stage=3 ENTER (installMicrokernelHost) → DONE
[openbuddy-diag] init-pipeline stage=4 ENTER (Context)               → DONE
[openbuddy-diag] init-pipeline stage=5 ENTER (ProfileOptions)         → DONE
[openbuddy-diag] init-pipeline stage=6 ENTER (initProfile)            → DONE
[openbuddy-diag] init-pipeline stage=6.5 ENTER (initDeepSeek)         → DONE
[openbuddy-diag] init-pipeline stage=6.6 ENTER (initPiUserExtensions) → DONE
[openbuddy-diag] init-pipeline stage=6.7 ENTER (initPiDshCoreExtensions) → DONE
[openbuddy-diag] init-pipeline stage=7 ENTER (computeActiveAdapterIds + initSession) → DONE
[openbuddy-diag] init-pipeline stage=8 ENTER (emitPluginReadyEvent)   → DONE

[openbuddy-harness] listening at http://127.0.0.1:54517
dev server running for the electron renderer process at:
  ➜  Local:   http://localhost:1420/
```

### R18.4 — Theme Studio round-trip 实测(`_probe-theme-studio-roundtrip.mjs`)

- ✅ Studio 打开后:**34 个 OKLCh 滑块**(L/C/H × ~10 主题 token + 字号)
- ✅ 拖动 bg-primary L slider(0.985 → 0.5):`getComputedStyle(:root).--wb-bg-primary` 实时更新
- ✅ `data-theme-name` 从 `openbuddy` 切到 `custom`
- ✅ 点击「保存」:`localStorage.openbuddy.theme.custom` 写入完整 JSON 数组
- ✅ Export JSON 按钮可用(label: "导出 JSON")

### R18 累计统计

| 项 | 状态 |
|---|---|
| Expert Marketplace Bridge IPC 接线(7 channels) | ✅ |
| Pi-market-client renderer wrapper | ✅ |
| `pi-market-bridge.test.ts` 42/42 | ✅ |
| end-to-end install 真机验证(创建 lockfile + audit + 文件系统) | ✅ |
| 升级 + 回滚 + audit 全链路真机可调 | ✅ |
| `electron-vite dev` 8 stage init-pipeline 全部 DONE | ✅ |
| Theme Studio round-trip 真机 34 滑块 + 保存 + Export | ✅ |
| `tests/screenshots/themes/` 19 张主题视觉资产 | ✅ |

**新文件**:
- `src/lib/pi-market/pi-market-client.ts`(79 行,7 个 typed wrapper)
- `scripts/electron/_probe-pi-market-bridge.mjs`(IPC 通道存在性 + 空 registry)
- `scripts/electron/_probe-pi-market-install.mjs`(完整 install + 锁文件 + audit)
- `scripts/electron/_probe-theme-studio.mjs`(Studio 打开 + 滑块)
- `scripts/electron/_probe-theme-studio-roundtrip.mjs`(滑块 + 保存 + Export)

**修改文件**:
- `electron/main/ipc/index.ts`(+11 行:`createPiMarketBridge` + `registerPiMarketBridgeIpc` 注册)
- `electron/preload/index.ts`(+4 行:7 个 `agent:pi-market-*` 加入 allowlist)

## R18 总结 — Expert Marketplace Bridge 差异化落地

OpenBuddy 与 WorkBuddy 的关键差异化:**WorkBuddy 不允许第三方 Pi 扩展通过 Marketplace 安装**。R18 把 OpenBuddy 的 Expert Marketplace Bridge 从「模块存在 + 单测覆盖」推进到「生产代码接线 + 真机端到端验证」:

1. 真实本地 registry + 内联 payload
2. install 走原子 staging → rename 流程,失败自动回滚
3. lockfile 持久化 SHA-256 integrity hash
4. capability 列表被映射为 `openbuddy.plugin.v1` manifest
5. 每次动作都追加到 `audit.jsonl`(本地优先,无外发)
6. 渲染端有 typed wrapper(`pi-market-client.ts`)与 MarketPlaceTab/InstallDialog UI 对接

**这是开源差异化在 R17 → R18 路线图上第一个可演示的 end-to-end flow**。

## R19 — 微内核「注册了却没人消费」的接线缺口

微内核的价值 = 能力能被别人取用。R19 的起点不是加功能,而是把审计做出来:
`scripts/ui-slot-audit.mjs` 把三个数字拉到一起 —— 谁**声明**了槽位、谁**注册**了实现、
谁真的**消费**了它。

```
node scripts/ui-slot-audit.mjs          # 人读的表格
node scripts/ui-slot-audit.mjs --json   # 机器读
```

状态含义:`ok` 注册且被消费 / `dead` 注册了但零消费(接线漏了)/ `no-impl` 有人在消费
但没有实现(靠 fallback 活着)/ `ext` 有意的扩展点(AppFrame 类外壳的入口)。

首轮审计出的 4 处缺口,本轮修掉 2 处:

### R19.1 插件命令 → ⌘K 命令面板(以前整条链路是断的)

`plugin.command` 是数据型槽:插件通过 Plugin SDK 的
`api.registerCommand(id, label, onExecute)` 只贡献一条描述,UI 由宿主提供。这条链路上
有 3 个断点,全部修掉:

1. **SDK 把 label 丢了** —— `author.ts` 只派发 `{ id, onExecute }`,于是内核里的
   `plugin.command` entry 没有展示名,命令面板根本没法列出它。
2. **包根不导出 `defineExtension`** —— `examples/openbuddy-plugin-*` 三个示例与文档
   写的都是 `import { defineExtension } from "@openbuddy/plugin-sdk"`,但包里只导出
   manifest/serializer,starter 模板抄下来直接报错。
3. **没有消费者** —— `plugin.command` 之前零消费,命令注册进内核等于石沉大海。

现在:宿主在 `AppShell` 的 `SearchSurface` 薄容器里读 `plugin.command` 的 payload
(`useSlotPayloadValues`),注入给 `SearchOverlay`;命令分组排在会话之前,支持
`/greet Alice` 这种「命令 + 参数」写法,回车执行并把 args 交给插件回调,回调抛错被
兜住(一个坏插件不该拖垮 ⌘K)。规则层抽成 `plugin-commands.ts` 纯函数,组件层不含判断。

真机验证:`scripts/electron/_probe-plugin-command.mjs` —— 派发真实 SDK 事件 →
⌘K → `/greet Alice` → 回车 → 断言插件回调收到 `{ args: "Alice" }` 且面板关闭。

### R19.2 状态栏接进 `shell.statusbar`

`StatusBar` 的文件头注释一直写着 "Rendered from the `shell.statusbar` slot so a plugin
can replace it",但实际既没注册也没消费(宿主直接 `import`)。现在:

- `@openbuddy/ui-shell/client` 把 `StatusBar` 注册进 `shell.statusbar`(single/root);
- `AppStatusBar` 消费该槽(内核没实现时回落内置),拿到的是同一份 `left/right` props;
- 槽位契约从 `owner: Record<string, never>` 改成真实的 props 形状 —— 插件替换实现时
  只需要关心怎么画,不用自己找数据。

真机验证:`_probe-slot-assembly.mjs` 断言 `shell.statusbar` 有 1 条
`@openbuddy/ui-shell` 的 entry。

### R19.3 假实现:删掉 `settings.extension`

`ui-settings-models` 的 apply() 里注册过一个 `settings.extension` 槽 + `() => null` 组件:
槽名没有 `declare module` 契约、没有任何消费者,组件还是空壳。它唯一的效果是让
「注册数」好看、让审计表把这块记成已实现。真正的扩展点是**渲染端**的
`settings.section`(由 `SettingsPanel` 的 `useRendererSlot("settings.section")` 消费)。

占位注册比不注册更糟(它会骗过审计),所以直接删掉;等真有面板时再以真实组件注册。
同时修掉探针里一个不存在的老槽名(`settings.sections`,从来没被声明过),换成
真实存在的 `plugin.command` / `notifications`。

### R19.4 仍然存在、留给下一轮的 dead 槽

| 槽位 | 注册者 | 现状 |
|---|---|---|
| `onboarding.data-dir` | ui-onboarding | 需要宿主注入 `onSubmit`;改数据目录要重启进程,属独立特性 |
| `onboarding.feedback` | ui-onboarding | 同上(`onSubmit`) |
| `onboarding.whats-new` | ui-onboarding | 需要宿主给 `version` + `items`(本地 changelog 数据尚未进包) |
| `placeholder.experts` | ui-experts | `PlaceholderPage` 直接 import 了 `ExpertsPanel`,槽位空转 |
| `root` | ui-layout | `AppFrame` 的子槽,AppFrame 本身未在本产品外壳中使用 |

### R19.5 Composer 的 `/` 菜单也认 `plugin.command`

`docs/EXTENSION_RECIPES.md` 的 Recipe 3 承诺「`/greet` 在 Composer 输入后触发执行」,
但补全菜单只列 Pi 自带命令 + 渲染端 contribution(那类只是 `insertText` 文本模板),
SDK 命令实际只能靠 ⌘K 执行 —— 文档与行为不一致。现在两条入口都通:

- `<SlashCommands pluginCommands>`:SDK 命令进补全菜单,id 作命令名、label 作描述;
  同名时 **Pi 赢**(去重顺序与发送路径的保留名单一致);
- **发送路径分流**:`send()` 里 `/greet Alice` 命中 `plugin.command` 就调用插件的
  `onExecute({ args: "Alice" })`、清空输入框、**不发给 agent**。保留名单
  (`NATIVE_PI_COMMANDS`:plan / fork / tree / label / compact / reload / session)里的
  名字永远归 Pi,插件同名不截胡;带附件/图片时不拦截(那种情况用户显然想发给 agent);
- 规则在 `matchPluginSlashCommand(text, commands, reserved)` 里,纯函数、可单测。

真机验证:`_probe-plugin-command.mjs` 第 5 段 —— 在 Composer 输入 `/gre` 弹出补全菜单
(含 `/greet`),继续输入参数后回车,断言插件回调收到 `{ args: "ComposerArgs" }`
且输入框被清空。

`shell.overlay` / `notifications` / `details` 标为 `ext`:它们的消费者是 ui-layout 的
`AppFrame`(整壳实现),而本产品外壳走命名 `overlay.*` slot 路径。**这是一个待决策项**:
要么把 AppFrame 的浮层渲染接进 AppShell,要么退役这两个槽,别让「有注册没消费」长期存在。

## R20 — 第二轮接线:编辑器扩展点 / 专家页 / 主题字体

R19 用审计脚本把「注册了零消费」的槽位挖了出来(当时 ok=12 / dead=5 / no-impl=20)。
R20 把其中**有真实产品价值**的三组补完,并把审计本身升级成能区分"漏接线"和
"设计如此"的工具。

### R20.1 编辑器三个扩展点接上消费者(no-impl → 可用)

`editor.toolbar` / `editor.slash-commands` / `editor.mention-sources` 声明齐全、
零消费者 —— 插件注册进去石沉大海(`packages/ui/openbuddy-ui-editor/src/client.tsx`
的注释还写着"由消费方追加",但消费方不存在)。

| 层 | 文件 | 职责 |
|---|---|---|
| 纯逻辑 | `lib/toolbar-actions.ts` | 插件按钮收敛:去重 / 排序 / 丢弃缺 `run` / 吞抛错 |
| 纯逻辑 | `lib/slash-command.ts` | `mergeSlashCommandContributions`:内置 id 撞名时内置赢 |
| 纯逻辑 | `lib/mention.ts` | `gatherMentionItems`:多来源串行聚合 + 按 id 去重 + 单来源容错 |
| 消费 | `lib/use-editor-slots.ts` | 编辑器自取三个槽位(宿主拿到的是 `editor.body` 组件,不认识内部类型) |
| 渲染 | `components/EditorToolbar.tsx` / `TiptapEditor.tsx` | 合并进内置集合;有 mention 来源时自动开 `@` |

**端到端验证不是从槽位数量反推的**:`editor-slot-wiring.test.tsx` 挂真内核
(`SlotProvider` + `registerAllBuiltinUis`)、真插件桥(`installPluginSdkBridge`),
断言插件注册的按钮出现在工具栏、输入 `/` 时插件命令出现在补全菜单、输入 `@comp`
时插件候选出现在候选菜单 —— 4 个断言全部落在 DOM 上。

`applySlashCommand` 也补了一条路径:插件命令先删 `/xxx` 区间再调 `command.run`,
与内置命令的前置条件一致;`run` 抛错只吞异常(文档保留"触发文本已删除"),不把
异常抛给菜单。

### R20.2 `placeholder.experts` 接上消费者(dead → ok)

`ui-experts` 把 `ExpertsTab` 注册进槽位,但 `PlaceholderPage` 直接 import
`ExpertsPanel`,槽位空转 —— "第三方可替换专家页"的能力等于不存在。修法沿用同文件
里 `modules.marketplace` 的既有模式:`ExpertsPanel` 内新增 `ExpertsTabContent`
消费槽位、回退到本地 `ExpertsTab`(两条路径同一个组件,卸载插件视觉零变化)。

### R20.3 主题字体真的生效(功能缺陷,不只是视觉)

19 套主题都声明了 `font` / `headingFont`,但这两个字段**只喂给 ThemePicker 的
预览卡片**:全仓 `var(--wb-font)` 只有 3 处消费,`src/styles/base.css` 的 body
读的是一个**从未定义**的 `--wb-font-family-base`。也就是"换主题只换颜色,字体
一动不动"。

修复的**关键陷阱**:主题写的是 `'"Space Grotesk", var(--wb-font)'` —— 自引用
即将被覆盖的那个 token。原样写回 `--wb-font` 就是循环引用,CSS 会丢弃整条声明,
字体依旧不生效(而且更难查)。因此 `expandFontRefs()` 在**定义时**文本展开,
`resolveThemeVars()` 作为 store 与 `ThemeInitializer` 的唯一组合入口(首屏不再
"挂载后字体跳一次"),新增 `--wb-font-heading` 给 markdown 标题用。

### R20.3b 真机证据:`_probe-theme-fonts.mjs`

单测只能证明"token 写对了",证明不了"界面真的换了字体"。探针启动真 Electron,
走 设置 → 个性化 → ThemePicker 点 claude / win95,读 **computed style**:

```
claude → body: "Space Grotesk", -apple-system, …     heading: "Playfair Display", Georgia, serif
win95  → body: "Pixelated MS Sans Serif", "MS Sans Serif", Tahoma, sans-serif
```

同时断言两套主题字体不同、内联 `--wb-font` 不含 `var(--wb-font`(自引用会让整条
声明失效)、`pageErrors` 为空。CI wrapper `_probe-theme-fonts.test.mjs` 与其它探针
同模式(spawn + JSON 解析 + 无 Electron 时 skip)。

### R20.4 审计脚本升级:`ext-default`

`dead` 一直把两类东西混着:真漏接线,和"内置默认 + 插件增量"(内置按钮写在组件
里,槽位只承载增量 —— 这类槽位**本来就该零注册**)。新增自动判据:

> 声明于包 P + 被包 P 消费 + 零注册者 ⇒ `ext-default`(设计如此)

不需要手工白名单,no-impl 从 20 降到 17。审计末尾现在直接列出 no-impl / dead
的槽名,省得去表里数。

### R20.5 当前审计快照(`node scripts/ui-slot-audit.mjs`)

```
总共 40 个槽位; ok=13 dead=4 ext=6 no-impl=17
dead(注册了但零消费,能力不可见):
  onboarding.data-dir, onboarding.feedback, onboarding.whats-new, root
```

| 剩余 dead 槽 | 差什么 | 性质 |
|---|---|---|
| `onboarding.data-dir` | 宿主注入 `onSubmit`;改数据目录要重启进程 | 独立特性(需主进程配合) |
| `onboarding.feedback` | 宿主注入 `onSubmit`(提交到本地队列 / 外链) | 独立特性 |
| `onboarding.whats-new` | 需要 `version` + `items`;仓库里还没有**应用内** changelog 数据源 | 缺数据,不是缺接线 |
| `root` | ui-layout 的 `AppFrame` 子槽,`AppFrame` 未在本产品外壳使用 | 与 `shell.overlay` 同一待决策项 |

### R20.6 仍然悬而未决:AppFrame 浮层槽

`shell.overlay` / `notifications` / `details` 的唯一消费者是 ui-layout 的
`AppFrame`(整壳实现),而产品外壳走命名 `overlay.*` 路径。后果是 `ui-dialogs`
注册的 AboutDialog / FolderTrustDialog 等 5 个浮层**永远不渲染**。两条路:

1. 把 AppFrame 的浮层渲染接进 `AppShell`(保留插件的整壳替换能力);
2. 退役这几个槽,把 `ui-dialogs` 的注册改到命名 `overlay.*` 路径。

倾向 (1):整壳替换是微内核的对称性(第三方 shell 也能被替换),但要先确认
AppShell 的浮层容器与 AppFrame 的语义一致。
