/**
 * @openbuddy/ui-modules/components — 组件与模型层聚合出口。
 *
 * 历史包袱清理(R97):曾在这里导出整套 marketplace 表现层
 * (MarketplaceTab / MarketplaceCard / InstallDialog / CapabilityVersionBadge /
 * marketplace-model))。R83 之后「插件·市场」面板的事实唯一实现是
 * `@openbuddy/ui-mcp` 的 `MarketplacePanel`(自带 IPC 取数据 + 虚拟化 + 预检),
 * ui-modules 的这份只导出组件、没有宿主装配,于是形成"两份 marketplace 实现"
 * 却只有一份在跑。R97 把这套孤儿参考实现删除,避免新人误以为有两套契约。
 *
 * 仍然保留的模块(ClientModuleSystem / 模块注册)走 `./index.ts` 顶层导出。
 *
 * @see packages/ui/openbuddy-ui-modules/src/index.ts
 */

export {};
