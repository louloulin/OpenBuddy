# @openbuddy/ui-shell

> 外层 Shell 层。承载应用窗口外壳、托盘菜单、关于页、调试入口等操作系统集成。

## 角色与边界

本包是 OpenBuddy UI 插件体系下的一个独立子包,遵循 `packages/ui/AGENTS.md` 中的约束:

- **命名**: `@openbuddy/ui-shell`,目录 `packages/ui/openbuddy-ui-shell/`
- **注册面**: 仅导出 React 组件(由 `App.tsx` 等直接 import),不通过 `./client` 注入槽位
- **可消费 API**: 所有运行时导出都集中在 `src/index.ts`,本文件汇总
- **样式**: `*.module.css` 由本包自包含;主题令牌跨包读取 `@openbuddy/ui-theme`

## 公共 API 摘要

- 值/组件: `TitleBar` ← `./TitleBar`
- 值/组件: `TopbarActions` ← `./TopbarActions`
- 值/组件: `TopbarTitle` ← `./TopbarTitle`
- 值/组件: `WorkspacePicker` ← `./WorkspacePicker`
- 值/组件: `AssistantTopTabs` ← `./AssistantTopTabs`
- 多行导出: 1 项 — AssistantWorkbenchNav
- 多行导出: 3 项 — assistantPluginTabsFromContributions, ASSISTANT_TAB_SECTIONS, ASSISTANT_TAB_ROUTE_BY_SECTION
- 类型契约: `AssistantTopTabItem` ← `./AssistantTopTabs`

> 完整签名见 `src/index.ts`。子路径导入:

- `@openbuddy/ui-shell/invariant` — 不变式同伴(开发态类型守卫)

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
