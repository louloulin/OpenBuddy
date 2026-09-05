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
- 值/组件: `FileTreeView` ← `./FileTreeView`
- 值/组件: `ViewSelector, defaultViews` ← `./ViewSelector`

> 完整签名见 `src/index.ts`。子路径导入:

- `@openbuddy/ui-workbench/client` — 槽位注册入口,由 `@openbuddy/ui-runtime` 调用
- `@openbuddy/ui-workbench/invariant` — 不变式同伴(开发态类型守卫)

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
