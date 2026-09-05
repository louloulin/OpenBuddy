# @openbuddy/ui-dialogs

> 通用对话框层。承载确认、提示、表单、权限确认、文件选择等系统级模态对话框。

## 角色与边界

本包是 OpenBuddy UI 插件体系下的一个独立子包,遵循 `packages/ui/AGENTS.md` 中的约束:

- **命名**: `@openbuddy/ui-dialogs`,目录 `packages/ui/openbuddy-ui-dialogs/`
- **注册面**: 仅通过 `./client` 子路径在 `SlotProvider` 挂载时调用 `apply()` 注入槽位;不在模块顶层副作用中注册 React 组件
- **可消费 API**: 所有运行时导出都集中在 `src/index.ts`,本文件汇总
- **样式**: `*.module.css` 由本包自包含;主题令牌跨包读取 `@openbuddy/ui-theme`

## 公共 API 摘要

- 值/组件: `AboutDialog` ← `./AboutDialog`
- 值/组件: `ConfirmDialog` ← `./ConfirmDialog`
- 类型契约: `ConfirmTone` ← `./ConfirmDialog`
- 值/组件: `FeedbackDialog` ← `./FeedbackDialog`
- 值/组件: `FolderTrustDialog` ← `./FolderTrustDialog`
- 值/组件: `ModalIcon` ← `./ModalIcon`
- 值/组件: `ModalShell, ModalHead, ModalBody, ModalFooter` ← `./ModalShell`
- 类型契约: `ModalTone, ModalShellProps, ModalHeadProps` ← `./ModalShell`
- 值/组件: `PermissionInlineCard` ← `./PermissionDialog`
- 值/组件: `ProjectConfirmDialog, ProjectInputDialog` ← `./ProjectDialog`
- 值/组件: `PromptDialog` ← `./PromptDialog`

> 完整签名见 `src/index.ts`。子路径导入:

- `@openbuddy/ui-dialogs/client` — 槽位注册入口,由 `@openbuddy/ui-runtime` 调用
- `@openbuddy/ui-dialogs/invariant` — 不变式同伴(开发态类型守卫)

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
