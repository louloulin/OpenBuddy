# @openbuddy/ui-experts

> 专家(Experts)配置层。管理与调用场景化专家模板、提示词、工具集的 UI 入口。

## 角色与边界

本包是 OpenBuddy UI 插件体系下的一个独立子包,遵循 `packages/ui/AGENTS.md` 中的约束:

- **命名**: `@openbuddy/ui-experts`,目录 `packages/ui/openbuddy-ui-experts/`
- **注册面**: 仅通过 `./client` 子路径在 `SlotProvider` 挂载时调用 `apply()` 注入槽位;不在模块顶层副作用中注册 React 组件
- **可消费 API**: 所有运行时导出都集中在 `src/index.ts`,本文件汇总
- **样式**: `*.module.css` 由本包自包含;主题令牌跨包读取 `@openbuddy/ui-theme`

## 公共 API 摘要

- 值/组件: `ExpertsPanel` ← `./ExpertsPanel`
- 值/组件: `MarketPills` ← `./MarketHeader`
- 类型契约: `MarketTab` ← `./MarketHeader`
- 值/组件: `ExpertsTab` ← `./experts/ExpertsTab`
- 值/组件: `ExpertCard` ← `./experts/ExpertCard`
- 值/组件: `ExpertDetailModal` ← `./experts/ExpertDetailModal`
- 值/组件: `FeaturedScenes` ← `./experts/FeaturedScenes`
- 值/组件: `MyExpertsEmpty` ← `./experts/MyExpertsEmpty`
- 值/组件: `SkillsTab` ← `./skills/SkillsTab`
- 值/组件: `SkillCatalogCard` ← `./skills/SkillCatalogCard`
- 值/组件: `SkillCard` ← `./skills/SkillCard`
- 值/组件: `SkillDetailModal` ← `./skills/SkillDetailModal`
- 值/组件: `ImportSkillModal` ← `./skills/ImportSkillModal`
- 值/组件: `ConnectorsTab` ← `./connectors/ConnectorsTab`
- 类型契约: `ConnectorAuthState` ← `./connectors/ConnectorsTab`
- 值/组件: `ConnectorCard` ← `./connectors/ConnectorCard`
- 值/组件: `ConnectorDetailModal` ← `./connectors/ConnectorDetailModal`
- 值/组件: `ConnectorTokenForm` ← `./connectors/ConnectorTokenForm`
- 值/组件: `ConnectorAuthModal` ← `./connectors/ConnectorAuthModal`
- 值/组件: `ConnectorQrModal` ← `./connectors/ConnectorQrModal`
- 值/组件: `McpModal` ← `./connectors/McpModal`
- 值/组件: `McpConfigEditor` ← `./connectors/McpConfigEditor`
- 值/组件: `ConnectorIcon` ← `./shared/ConnectorIcon`
- 值/组件: `LetterAvatar` ← `./shared/LetterAvatar`
- 值/组件: `ThumbImg` ← `./shared/ThumbImg`
- 值/组件: `Chip, SegmentTabs, ScrollRow` ← `./shared/ui`
- 值/组件: `CONNECTOR_LIST` ← `./data/connectors-catalog`
- 值/组件: `FEATURED_SCENES` ← `./data/featured-scenes`
- 值/组件: `SKILL_CATEGORIES` ← `./data/skills-catalog`

> 完整签名见 `src/index.ts`。子路径导入:

- `@openbuddy/ui-experts/client` — 槽位注册入口,由 `@openbuddy/ui-runtime` 调用
- `@openbuddy/ui-experts/invariant` — 不变式同伴(开发态类型守卫)

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
