# OpenBuddy → PI-AI Workbench 改造总规划

> 基于 Cabinet（v0.5.3）深度调研 + OpenBuddy v0.15.0 现状 + 4 阶段执行经验
> 目标:打造顶级 PI 原生微内核 AI 工作台,在产品与功能上**正式超越 WorkBuddy**

---

## 0. 战略定位

| 维度 | WorkBuddy | OpenBuddy 目标 |
|---|---|---|
| 架构 | 闭源 + 强云依赖 | **PI 原生微内核 + 插件化**(本地优先 + 可桥接云) |
| 主题 | ~10 套固定 | **20+ 套 OKLCh 高品质主题** + Theme Studio 用户自制 |
| 编辑器 | 基础富文本 | **TipTap 流式富文本** + math/mermaid/office |
| 文件管理 | 基础树 | **Cabinet 级 tree-store**(虚拟滚动 + 拖拽 + 多选 + 上下文菜单) |
| Onboarding | 简单欢迎 | **Cabinet 级 "Rooms" 模式**(Office/Sales/HR/Product/R&D/Study/Lab/Family) |
| 插件 | 不开放 | **Plugin SDK v1 完整公开 manifest** + Pi Extension Bridge |
| 数据主权 | 云锁定 | **本地优先 + 自托管 telemetry** + Audit Trail |
| Theme Studio | 无 | **OKLCh 滑块编辑器**(用户自制并导入导出 JSON) |

---

## 1. Cabinet 关键模式学习(已完成)

### 1.1 主题系统 (`/src/lib/themes.ts` 901 行)

**架构要点:**
- **OKLCh 色彩空间** —— 不是 RGB / HSL,色相均匀、亮度可控,广色域适配
- **ThemeDefinition 完整契约** —— `name / label / type / font / headingFont / accent / vars`
- **17 套主题**:Claude / White / Black / Midnight-Ocean / Aurora / Ember / Forest / Cyber / Paper / Sakura / Meadow / Sky / Lavender / Win95 / WinXP / Matrix / Apple
- **AGENT_PALETTE** —— Tailwind-500 家族的 8 色循环,按 slug 哈希分配

### 1.2 ThemeProvider (`/src/components/theme-provider.tsx` 152 行)

**关键决策:**
- **避免 inline `<script>`** —— React 19 + Next 16 会输出 console error,改用纯 context provider
- **Hydration safe** —— 服务端/客户端初始 render 一致,localStorage 在 mount 后读
- **`disableTransitionsBriefly()`** —— 主题切换时禁用过渡 1 帧避免闪屏
- **`MediaQueryList change` 监听** —— 系统主题动态响应

### 1.3 ThemePicker (`/src/components/layout/theme-picker.tsx` 252 行)

**关键决策:**
- **portal + 边界检测** —— 用 createPortal 渲染到 body,避免 overflow:hidden 截断
- **`useSyncExternalStore`** —— 取代 useState + useEffect 反模式,从 localStorage 派生
- **左右双向定位** —— 支持 RTL(`dir="rtl"`),定位参数同时计算 right / left
- **Hydration gate** —— 服务端 null 快照 / 客户端 true 快照,避免 hydration mismatch

### 1.4 Onboarding Rooms (`/src/lib/onboarding/rooms.ts` 340 行)

**架构亮点:**
- **9 种房间类型** —— office / sales / hr / product / rnd / study / lab / family-room / blank
- **每房间配置** —— label / tagline / icon / workspaceLabel / askTeamSize / **mandatoryAgents** / **keywordMap** (正则 → agent slug 映射)
- **greetingTemplate** —— 房间专属开场白,根据 workspaceName 动态生成
- **Blank 房强制 editor agent** —— 保证每个房间至少有 editor 角色

### 1.5 Tree-store (`/src/stores/tree-store.ts`)

**关键能力:**
- **Drag zones** —— `before / into / after` 三区拖拽
- **Alphabetical sorting** —— 可切换手动 /字母序,后者带 folders-first 选项
- **Drive integration** —— Drive 节点不在本地树时的特殊处理
- **Pending move** —— 字母序模式下移动需确认(避免覆盖手动排序)
- **Recently changed** —— agent 改动的文件在侧栏高亮

---

## 2. OpenBuddy 现状快照

### 2.1 已具备的微内核能力

| 能力 | 实现位置 | 状态 |
|---|---|---|
| Slot 声明合并 | `packages/ui/openbuddy-ui-slots/src/index.ts` | ✅ |
| SlotProvider | `packages/ui/openbuddy-ui-runtime/src/` | ✅ |
| Cordis Runtime | `packages/runtime/openbuddy-cordis/` | ✅ |
| Plugin Manifest v1 | `packages/runtime/openbuddy-plugin-host/src/plugin-manifest.ts` | ✅ |
| PI Extension UI Slots | `ui-slots` 内置 5 个 key | ✅ |
| Bounded Event Payload | `openbuddy-plugin-host/src/bounded-event-payload.ts` | ✅ |
| Hook System | `openbuddy-plugin-host/src/hooks.ts` | ✅ |

### 2.2 各 ui 包状态

(参见前一轮分析)

| 类别 | 完整度 |
|---|---|
| ui-conversation / workbench / shell / theme | 🟢 70-85% |
| ui-editor / markdown / onboarding / sidebar | 🟡 25-50% |
| ui-account / billing / collaboration / files / mcp | 🟠 0-30% |

---

## 3. 改造路线图(7 期,每期可 shippable)

### Phase A — Theme System v3 ✅ 85% 完成

(前轮已经完成大部分)

**剩余 15%:**
- ☐ 完整 17 套主题 OKLCh 化(参考 cabinet `themes.ts` 直接移植精修)
- ☐ AGENT_PALETTE 8 色循环 agent pill 系统
- ☐ ThemePicker portal + RTL + disableTransitions 完整实现
- ☐ Theme Studio(用户自制主题 OKLCh 滑块编辑器)

### Phase B — Workspace 表现层 🟡 40% → 100%

**B.1 Sidebar 可拖拽宽度**
- 新建 `packages/ui/openbuddy-ui-primitives/src/components/Resizable/`
- clamp 220-420px,localStorage 持久化
- 单文件 < 100 行,纯原子组件

**B.2 CabinetTree 树状文件管理**
- 新建 `packages/ui/openbuddy-ui-files-tree/src/lib/tree-store.ts`(参考 cabinet `tree-store.ts`)
- 集成 `packages/ui/openbuddy-ui-files-tree` 已存在的 `components/`
- 实现 `dragZones: before/into/after` + `recentlyChanged` 高亮
- 接入主 sidebar(替换现有扁平列表)

**B.3 Artifact Tabs 升级**
- 扩展 `openbuddy-ui-workbench/ArtifactTabsBar.tsx`
- 多 tab + breadcrumb + viewer-toolbar
- 状态持久化到 zustand

**B.4 Topbar / Menubar 升级**
- `openbuddy-ui-shell/TopbarTitle.tsx` 加 status chip
- `openbuddy-ui-shell/TopbarActions.tsx` 加 theme picker 入口 + kbd hints

**B.5 Status Bar**
- 已在 `openbuddy-ui-shell/StatusBar.tsx`,需验证完整性

### Phase C — 编辑器与富文本 🟡 25% → 100%

**C.1 TipTap 流式编辑器**
- `packages/ui/openbuddy-ui-editor/` 已存在,接入 `@tiptap/react`
- 扩展:StarterKit + Table + TaskList + CodeBlockLowlight + Mention
- 渲染层继续用 react-markdown,编辑层用 TipTap(双轨制)
- 数学公式 KaTeX + Mermaid

**C.2 Office 预览**
- 新建 `packages/ui/openbuddy-ui-workbench/src/OfficePreview/` 三件套
  - `DocxPreview.tsx`(docx-preview)
  - `XlsxPreview.tsx`(xlsx / handsontable)
  - `PptxPreview.tsx`(pptx-preview)
- 注册 `workbench.office-preview` slot

### Phase D — Onboarding 与差异化 🟡 35% → 100%

**D.1 OnboardingWizard**
- 已有 `ui-onboarding` 包,扩展 rooms 模式
- 移植 cabinet 9 房模式:office/sales/hr/product/rnd/study/lab/family/blank
- 每房强制 mandatoryAgents(editor 必选)
- keywordMap 智能推荐 agent

**D.2 Tour**
- 已有 `ui-onboarding/src/tour/`,需扩展 step state machine
- 跳过 / 恢复逻辑
- 首次启动全流程 E2E

**D.3 DataDir Prompt**
- 已有 `DataDirPrompt`,需确认完整性
- 多平台路径提示(Mac/Win/Linux)

**D.4 Plugin Marketplace UI**
- `openbuddy-ui-modules` 扩展
- MarketplaceTab + InstallDialog + CapabilityVersion 展示
- install/upgrade/rollback 三态 E2E

**D.5 Pi 扩展市场桥接**
- 在 `openbuddy-plugin-host` 加 `pi-extension-bridge.ts`
- 一键安装 Pi 官方扩展到 OpenBuddy
- 实现 v1 manifest 解析 + 依赖注入

### Phase E — Theme Studio 与差异化亮点 🆕

**E.1 Theme Studio**
- Settings → Personalize → "Create your own theme"
- OKLCh 5 维滑块:lightness / chroma / hue
- 实时预览 + 导出 JSON + 导入 JSON
- 6 个基础 token:background/foreground/primary/secondary/border/ring

**E.2 Audit Trail + Local Telemetry**
- 已部分实现 `audit-log.test.ts`
- 完善 Audit Trail UI(在 Settings → Audit)
- Local Telemetry 自带开关,默认关闭
- "本地优先 + 数据自决" 作为差异化主张

**E.3 Plugin SDK v1 文档站点**
- `apps/openbuddy-website/` 加 `/docs/plugin-sdk`
- 完整 manifest 文档 + 示例 + starter 模板
- "examples/" 子目录

### Phase F — 性能与可访问性 🆕

**F.1 字体按需加载**
- Cabinet `applyTheme()` 只加载当前主题字体
- OpenBuddy 当前 `client.tsx` 已有雏形,需验证

**F.2 数据请求去重**
- Cabinet `fetchCabinetOverviewClient` 3s dedupe
- OpenBuddy 多个 store 各自 fetch,需要统一包装

**F.3 a11y 审计**
- 所有 ui-* 包跑 axe-core
- 修复 color contrast + focus ring + ARIA labels

### Phase G — 跨期打磨

- 统一所有 package.json 版本号
- 统一所有 README.md 模板
- 跑完整 Playwright e2e 套件
- 跑所有 ui 包的单测覆盖

---

## 4. 微内核 + 插件架构强化

### 4.1 现有架构不变性保证

- **不破坏 30 个 ui-* 包的 slot 契约**(`packages/ui/AGENTS.md` 不改)
- **不重写 Cordis / Plugin Host 底层**
- **新包继续遵循 `apply()` + slot 声明合并**

### 4.2 增强点

1. **Slot 文档自动化** —— `sync-ui-slots-docs.mjs` 自动生成 slot API 文档
2. **Plugin Manifest v1 validator CLI** —— `pnpm plugin:validate`
4. **Plugin 热加载** —— `ui-hmr` 强化,manifest 修改即时生效
5. **跨包事件总线** —— 利用现有 `event-envelope.ts` + bounded payload

---

## 5. 关键指标

| 指标 | 当前 | 目标 |
|---|---|---|
| ui 包数量 | 30 | 32 (+ ui-theme-studio, + ui-audit) |
| 主题数 | ~17 | **20+(用户可自制无限)** |
| 单元测试覆盖率 | ~40% | **80%+** |
| E2E 测试套件 | ~16 | **40+** |
| 首屏 LCP | ~3.5s | **< 1.5s** |
| Plugin SDK 文档 | 无 | **完整 v1 文档 + 5 个示例** |
| Package bundle 大小 | ~30MB | **< 20MB** |

---

## 6. 优先级与 ROI

| P | 任务 | 影响 | 工作量 |
|---|---|---|---|
| **P0** | Phase A 完整 17 主题 OKLCh 移植 | 高 | 3 天 |
| **P0** | Phase B.2 CabinetTree 集成 | 高 | 1 周 |
| **P0** | Phase C.1 TipTap 接入 | 极高 | 3 周 |
| **P0** | Phase C.2 Office 预览 | 中 | 1 周 |
| **P1** | Phase D.1 Rooms Onboarding | 中 | 2 周 |
| **P1** | Phase E.1 Theme Studio | 高(差异) | 1 周 |
| **P1** | Phase F.1 字体按需加载 | 中 | 3 天 |
| **P2** | Phase D.4 Marketplace UI | 中 | 1 周 |
| **P2** | Phase D.5 Pi Bridge | 中 | 1 周 |
| **P2** | Phase E.3 Plugin SDK 文档 | 中 | 1 周 |
| **P3** | Phase E.2 Audit Trail UI | 中 | 1 周 |

**P0 合计:约 6 周(2 个半月)**
**全部合计:约 12-14 周(3-3.5 个月)**

---

## 7. 立即开始(下一轮)

按 P0 顺序:

1. **Phase A 完整**:把 cabinet 的 17 套主题 OKLCh 全部移植到 `openbuddy-ui-theme/src/themes/index.ts`
2. **Phase B.2 CabinetTree**:在 `ui-files-tree` 实现 drag zones + recently-changed
3. **Phase C.1 TipTap**:在 `ui-editor` 接入 `@tiptap/react`

每次完成立即 commit + push。

---

## 8. 不在范围内

- ❌ 重写 Cordis / Plugin Host 任何底层
- ❌ 引入 Tailwind 4 或 Next.js(保持 Electron + Vite)
- ❌ 复制 cabinet 的 cloud tier / 商业化能力
- ❌ WorkBuddy 的微信 / 企业微信适配(场景不同)

