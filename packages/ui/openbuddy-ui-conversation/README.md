# @openbuddy/ui-conversation

> 会话对话层。承载对话流式渲染、消息操作、上下文压缩、引用附件等会话交互相关 UI。

## 角色与边界

本包是 OpenBuddy UI 插件体系下的一个独立子包,遵循 `packages/ui/AGENTS.md` 中的约束:

- **命名**: `@openbuddy/ui-conversation`,目录 `packages/ui/openbuddy-ui-conversation/`
- **注册面**: 仅通过 `./client` 子路径在 `SlotProvider` 挂载时调用 `apply()` 注入槽位;不在模块顶层副作用中注册 React 组件
- **可消费 API**: 所有运行时导出都集中在 `src/index.ts`,本文件汇总
- **样式**: `*.module.css` 由本包自包含;主题令牌跨包读取 `@openbuddy/ui-theme`

## 公共 API 摘要

- 值/组件: `ChatView` ← `./ChatView`
- 值/组件: `Composer` ← `./Composer`
- 值/组件: `ContextUsagePill` ← `./ContextUsagePill`
- 值/组件: `FileChangesPanel` ← `./FileChangesPanel`
- 值/组件: `FindBar, isFindHit` ← `./FindBar`
- 值/组件: `InputAddMenu` ← `./InputAddMenu`
- 值/组件: `LoadingRow` ← `./LoadingRow`
- 值/组件: `MessageItem` ← `./MessageItem`
- 值/组件: `QuestionInlineCard` ← `./QuestionInlineCard`
- 值/组件: `RewindBar` ← `./RewindBar`
- 值/组件: `ToolCallCard, ToolCallDetailBody` ← `./ToolCallCard`
- 值/组件: `ToolSidePanel` ← `./ToolSidePanel`
- 类型契约: `ToolSidePanelMode` ← `./ToolSidePanel`

> 完整签名见 `src/index.ts`。子路径导入:

- `@openbuddy/ui-conversation/client` — 槽位注册入口,由 `@openbuddy/ui-runtime` 调用
- `@openbuddy/ui-conversation/invariant` — 不变式同伴(开发态类型守卫)

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
