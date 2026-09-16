# @openbuddy/ui-modules

> 模块管理 UI 层。负责第三方插件 / 扩展模块的浏览、启用、停用与配置编辑,与 OpenBuddy 的插件加载器协作展示模块状态;并承载
> **插件 / 扩展市场**的表现层(MarketplaceTab / MarketplaceCard / InstallDialog / CapabilityVersionBadge)。

## 角色与边界

本包是 OpenBuddy UI 插件体系下的一个独立子包,遵循 `packages/ui/AGENTS.md` 中的约束:

- **命名**: `@openbuddy/ui-modules`,目录 `packages/ui/openbuddy-ui-modules/`
- **注册面**: 仅通过 `./client` 子路径在 `SlotProvider` 挂载时调用 `apply()` 注入槽位;不在模块顶层副作用中注册 React 组件
- **可消费 API**: 所有运行时导出都集中在 `src/index.ts`,本文件汇总
- **样式**: `*.module.css` 由本包自包含;主题令牌跨包读取 `@openbuddy/ui-theme`(`var(--wb-*)`)

## 公共 API 摘要

**renderer-host 复用(lazy 兼容层)**

- `ClientModuleSystem` / `loadRendererPlugin` 及其类型 — 第三方 `dsh.client` 模块的客户端宿主接口,由
  `renderer-plugin-runtime` 在 boot 时初始化;本包只做 re-export,不重复实现。

**市场组件(props 驱动,不直接调用 IPC)**

- `MarketplaceTab` — 整版面浏览器:搜索 / 类型 chip(带计数)/ 能力过滤 / 安装状态过滤 / 排序 / 网格·列表切换 / 空态·加载态·错误态。
- `MarketplaceCard` — 单条目卡片:图标、名称、发布者、描述、能力 chip(按风险排序 + `+N` 截断)、版本徽标、安装状态徽标、
  主操作按钮(安装 / 更新 / 已安装 / 不可用 / 安装中)、溢出菜单。
- `InstallDialog` — portal 到 `document.body` 的安装确认框:版本选择、能力与权限清单(风险色调)、依赖清单、磁盘占用提示、
  高风险能力勾选确认、进度与错误态、Esc 关闭、Tab 焦点环。
- `CapabilityVersionBadge` — semver 关系徽标(`已是最新` / `可升级` / `可回滚` / `版本不兼容`)+ 破坏性升级提示 + 升级 / 回滚入口。

**纯函数模型(`src/components/marketplace-model.ts`)**

- 版本:`parseSemver` / `compareSemver` / `classifyVersion` / `isMajorUpgrade` / `sortVersionsDesc`
- 状态:`resolveInstallState` / `summarizeCapabilities` / `capabilityRisk`
- 过滤排序:`filterMarketplaceEntries` / `sortMarketplaceEntries` / `selectMarketplaceEntries` / `scoreRelevance`
- 展示辅助:`collectKindFacets` / `collectCapabilityIds` / `highlightSegments` / `formatBytes` / 各标签常量

> 语义化版本比较是本包自己实现的子集(主/次/修订 + prerelease),不引入 `semver` 依赖:
> renderer 侧只需要 `update-available` / `downgrade` / `incompatible` 三态判定。

## 槽位

`src/index.ts` 通过声明合并扩展 `@openbuddy/ui-slots`:

| 槽位                       | kind     | scope           | owner props            |
| -------------------------- | -------- | --------------- | ---------------------- |
| `modules.marketplace`      | `single` | `session-maybe` | `MarketplaceTabProps`  |
| `modules.marketplace.item` | `list`   | `session-maybe` | `MarketplaceCardProps` |

`scope=session-maybe`:市场是 profile 级资源,不强制要求活跃会话。注册方通过 **owner props** 注入数据与动作,
因此 `apply()` 本身零 IPC / 零网络副作用 —— 卸载插件即恢复内置实现。

## 协作方式

1. **类型扩展**: 若本包为槽位声明类型(如 `ui-slots`, `ui-settings-models`),其他包可通过 `declare module "@openbuddy/ui-slots"` 进行声明合并
2. **跨包消费**: `import { MarketplaceTab } from "@openbuddy/ui-modules/components"`,路径别名由 `scripts/sync-ui-aliases.mjs` 自动维护
3. **样式互通**: 仅消费主题令牌(`var(--wb-*)`);不在本包硬编码颜色 / 间距

## 子路径导入

- `@openbuddy/ui-modules/client` — 槽位注册入口,由 `@openbuddy/ui-runtime` 调用
- `@openbuddy/ui-modules/invariant` — 不变式同伴(开发态类型守卫)
- `@openbuddy/ui-modules/components` — 组件 + 模型聚合出口
- `@openbuddy/ui-modules/components/MarketplaceTab` / `MarketplaceCard` / `InstallDialog` / `CapabilityVersionBadge` / `marketplace-model` — 细粒度入口

## TypeScript 配置

本包继承 `packages/ui/tsconfig.base.client.json`,后者再继承 `tsconfig.base.json`。
自身 `paths` 由 `sync-ui-aliases.mjs` 自动注入,无需手工维护。

## 测试

本包与根项目共用 vitest 配置,覆盖在 `src/__tests__/`:

- `marketplace-model.test.ts` — 版本解析 / 比较 / 状态派生 / 过滤排序 / 高亮 / 体积格式化
- `MarketplaceTab.test.tsx` — 过滤、排序、视图切换、四种状态(加载/错误/空/结果)、回调接线
- `MarketplaceCard.test.tsx` — 状态徽标、主操作路由、溢出菜单、能力截断、高亮
- `InstallDialog.test.tsx` — portal、Esc / 背板关闭、焦点环、版本选择(受控 + 非受控)、风险确认、进度与错误
- `CapabilityVersionBadge.test.tsx` — 版本关系、破坏性升级、回滚入口
- `client.test.tsx` / `index-exports.test.ts` — 槽位注册契约与公共导出面

## 参考

- `packages/ui/AGENTS.md` — UI 包整体约定
- `WORKBUDDY_UI_REFERENCE.md` — WorkBuddy UI 对照
- `docs/PLUGIN_SYSTEM.md` — 插件 manifest 与加载链路
- `electron/main/agent/pi-market-bridge.ts` — Pi 扩展市场桥接(main 进程,数据来源)
