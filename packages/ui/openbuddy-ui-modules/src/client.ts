/**
 * @openbuddy/ui-modules/client — apply() 现状：no-op。
 *
 * 设计上 `modules.marketplace` / `modules.marketplace.item` 是为「第三方
 * 插件」预留的扩展槽位:插件作者可以基于本包导出的 `MarketplaceTab` /
 * `MarketplaceCard` 写出自己的实现,然后注册到这两个槽位上覆盖「插件·
 * 市场」面板。本包自己默认 apply() **不再注册**,原因:
 *
 *   1. MarketplaceTab 是纯展示组件,需要宿主注入 entries / query / 过滤态
 *      等数据 props;直接注册会让 ui-experts 渲染出空白列表。
 *   2. 内置的「插件·市场」面板走的是 `@openbuddy/ui-mcp` 的
 *      `MarketplacePanel`（自带 IPC 取数据）—— 那个已经经过市场虚拟化、
 *      安装/回滚等完整 e2e 验证,行为契约稳定。
 *   3. 微内核契约：slot 应该给「第三方插件」提供扩展点,而不是把内置
 *      UI 重复注册一遍造成"两份实现都在跑"的歧义。
 *
 * 第三方插件作者:可以这样接入 —
 *
 *     import { applyModules } from "@openbuddy/ui-modules";
 *     import { MarketplaceTab } from "@openbuddy/ui-modules/components/MarketplaceTab";
 *     applyModules({ slots: ctx.slots, MarketTabImpl: MarketplaceTab });
 *
 * ui-experts 的 PluginsTabContent 现在走 slot 优先 + 内置回退,空槽时
 * 仍然渲染 ui-mcp 的 MarketplacePanel。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";

export function apply(_ctx: UiRuntimeContext): () => void {
  // 详见上方注释:本包默认不向内核注册 MarketplaceTab / MarketplaceCard,
  // 这两个组件作为参考实现导出,留给第三方插件自行装配。
  return () => {};
}
