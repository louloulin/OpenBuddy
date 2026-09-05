/**
 * @openbuddy/ui-mcp/client — apply() 注册 7 个 MCP / 插件面板。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { DiscoverPanel } from "./DiscoverPanel";
import { MarketplacePanel } from "./MarketplacePanel";
import { NotifyChannelsPanel } from "./NotifyChannelsPanel";
import { OpenBuddyPluginPanel } from "./OpenBuddyPluginPanel";
import { PluginsPanel } from "./PluginsPanel";
import { ResourceCatalogPanel } from "./ResourceCatalogPanel";

const PANELS = [
  { name: "placeholder.discover", component: DiscoverPanel as never },
  { name: "placeholder.marketplace", component: MarketplacePanel as never },
  { name: "placeholder.notify-channels", component: NotifyChannelsPanel as never },
  { name: "placeholder.openbuddy-plugin", component: OpenBuddyPluginPanel as never },
  { name: "placeholder.plugins", component: PluginsPanel as never },
  { name: "placeholder.resource-catalog", component: ResourceCatalogPanel as never },
  { name: "placeholder.resources", component: ResourceCatalogPanel as never },
];

export function apply(ctx: UiRuntimeContext): () => void {
  const disposers = PANELS.map((p) =>
    ctx.slots.register(
      { name: p.name, kind: "single", scope: "root", registrant: "@openbuddy/ui-mcp" },
      p.component as never
    )
  );
  return () => { for (let i = disposers.length - 1; i >= 0; i--) disposers[i](); };
}
