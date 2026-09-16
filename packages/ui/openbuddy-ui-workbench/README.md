# @openbuddy/ui-workbench

> 工作台层。承载工作台场景(Agent 工作台/计划工作台/调试工作台等)的多面板组合视图。

## 角色与边界

本包是 OpenBuddy UI 插件体系下的一个独立子包,遵循 `packages/ui/AGENTS.md` 中的约束:

- **命名**: `@openbuddy/ui-workbench`,目录 `packages/ui/openbuddy-ui-workbench/`
- **注册面**: 仅通过 `./client` 子路径在 `SlotProvider` 挂载时调用 `apply()` 注入槽位;不在模块顶层副作用中注册 React 组件
- **可消费 API**: 所有运行时导出都集中在 `src/index.ts`,本文件汇总
- **样式**: `*.module.css` 由本包自包含;主题令牌跨包读取 `@openbuddy/ui-theme`

## 公共 API 摘要

- 值/组件: `SearchOverlay` ← `./SearchOverlay`
- 值/组件: `ModelSelector` ← `./ModelSelector`
- 类型契约: `ModelOption` ← `./ModelSelector`
- 值/组件: `AssistantCalendarPanel` ← `./AssistantCalendarPanel`
- 值/组件: `AssistantWorkspacePanel, AssistantExtensionPanel` ← `./AssistantWorkspacePanel`
- 类型契约: `AssistantWorkspacePanelProps` ← `./AssistantWorkspacePanel`
- 值/组件: `BrowserPreview` ← `./BrowserPreview`
- 值/组件: `BuddyDirectory` ← `./BuddyDirectory`
- 类型契约: `BuddyEntry` ← `./BuddyDirectory`
- 值/组件: `FilePreview` ← `./FilePreview`
- 值/组件: `LocalAssistantView` ← `./LocalAssistantView`
- 值/组件: `ProjectCollaborationTab` ← `./ProjectCollaborationTab`
- 值/组件: `ProjectDetailView` ← `./ProjectDetailView`
- 值/组件: `RecoveryList` ← `./RecoveryList`
- 值/组件: `RendererContributionView, RendererContributionCard, RendererSlotView` ← `./RendererContributionView`
- 值/组件: `ShareMenu` ← `./ShareMenu`
- 值/组件: `SlashCommands, slashCommandsKeyHandler` ← `./SlashCommands`
- 值/组件: `TeamStatusView` ← `./TeamStatusView`
- 值/组件: `WorkflowBlackboard, computeWorkflowLevels` ← `./WorkflowBlackboard`
- 类型契约: `WorkflowBlackboardProps` ← `./WorkflowBlackboard`
- 值/组件: `ArtifactTabsBar` ← `./ArtifactTabsBar`
- 值/组件: `ArtifactBreadcrumb, buildBreadcrumbItems` ← `./ArtifactBreadcrumb`
- 类型契约: `ArtifactBreadcrumbProps, ArtifactBreadcrumbSegment` ← `./ArtifactBreadcrumb`
- 值/组件: `ArtifactViewerHeader` ← `./ArtifactViewerHeader`
- 类型契约: `ArtifactViewerHeaderProps, ArtifactViewerStatus, ArtifactViewerStatusTone` ← `./ArtifactViewerHeader`
- 值/组件: `ViewerToolbar` ← `./ViewerToolbar`
- 类型契约: `ViewerToolbarMenuItem, ViewerToolbarProps` ← `./ViewerToolbar`
- 值/组件: `DocxPreview, XlsxPreview, PptxPreview` ← `./DocxPreview` / `./XlsxPreview` / `./PptxPreview`
- 类型契约: `DocxPreviewProps, XlsxPreviewProps, PptxPreviewProps` ← 同上
- 纯函数: `pickOfficePreviewKind, officePreviewKindLabel, decodeDataUrl, toArrayBuffer` ← `./office-preview`
- 懒加载器: `loadDocxPreview, loadXlsx, loadPptxPreview` ← `./office-preview-loader`
- 值/组件: `FileTreeView` ← `./FileTreeView`
- 值/组件: `ViewSelector, defaultViews` ← `./ViewSelector`

> 完整签名见 `src/index.ts`。子路径导入:

- `@openbuddy/ui-workbench/client` — 槽位注册入口,由 `@openbuddy/ui-runtime` 调用
- `@openbuddy/ui-workbench/invariant` — 不变式同伴(开发态类型守卫)

## 查看器 chrome（ArtifactTabsBar / 头部条 / 工具栏）

三层结构，各自独立可复用，宿主按需组合：

```
┌ ArtifactTabsBar ── 打开了哪些（点击切换 / × 或中键关闭 / 拖拽排序 / 滚轮横滚 / 溢出菜单）
└ ArtifactViewerHeader
    ├ ArtifactBreadcrumb ── 当前是什么（中间省略折叠，点击展开）
    └ ViewerToolbar ── 能对它做什么（刷新 / 外部打开 / 复制 / 下载 ‖ 换行 / 缩放 ‖ 分屏 / 更多）
```

约定：

- **未传 handler 的工具栏按钮一律 `disabled`**，不会出现「点了没反应」的假交互。
- 每个工具栏按钮同时带 `aria-label` / `title` / `data-tip`（后者供全局 tooltip 系统使用）。
- 面包屑与工具栏都是**受控**的：数据全部来自 props，不读包外 store。
- `ArtifactTabsBar` 的新增能力（中键关闭、滚轮横滚、溢出菜单）都是增量，
  `overflowMenu={false}` 可完全关闭溢出菜单。

## Office 内嵌预览

与既有 `PdfJsPreview` 同构的「懒加载 + 永不白屏」模式：

| 组件 | 底层库 | 说明 |
| --- | --- | --- |
| `DocxPreview` | `docx-preview` | 逐页渲染成 DOM，`inWrapper:false` + 纸张卡片化 |
| `XlsxPreview` | `xlsx` (SheetJS) | `sheet_to_html` 转表格，首屏最多 5 张工作表，其余按需展开 |
| `PptxPreview` | `pptx-preview` | 按容器宽度 16:9 初始化，卸载时 `destroy()` |

- 三个库都走 `office-preview-loader.ts` 的 **dynamic import + 单次缓存 + 失败可重试**；
  失败（库缺失 / 文件损坏 / 非法 base64）一律渲染调用方传入的 `fallback`。
- `pickOfficePreviewKind(filename)` 只识别 OOXML 家族（docx/xlsx/pptx 及其同族），
  老式 `.doc` / `.xls` / `.ppt` 刻意返回 `null`，让调用方走显式「暂不支持」分支。

## 协作方式

1. **类型扩展**: 若本包为槽位声明类型(如 `ui-slots`, `ui-settings-models`),其他包可通过 `declare module "@openbuddy/ui-slots"` 进行声明合并
2. **跨包消费**: `import { Foo } from "@openbuddy/ui-other"`,路径别名由 `scripts/sync-ui-aliases.mjs` 自动维护
3. **样式互通**: 仅消费主题令牌(`var(--wb-*)`);不在本包硬编码颜色 / 间距

## TypeScript 配置

本包继承 `packages/ui/tsconfig.base.client.json`,后者再继承 `tsconfig.base.json`。
自身 `paths` 由 `sync-ui-aliases.mjs` 自动注入,无需手工维护。

## 测试

本包与根项目共用 vitest 配置。若新增组件,推荐在 `src/__tests__/` 下添加组件渲染或交互测试。

## 参考

- `packages/ui/AGENTS.md` — UI 包整体约定
- `deepseek-harness/packages/client/*` — 子包分桶与命名参考
