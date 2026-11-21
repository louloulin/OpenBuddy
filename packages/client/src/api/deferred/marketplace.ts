// Deferred (20261115-md Appendix B, 市场 / 插件): plugins_list / action, marketplace_list / action. Not in the protocol COMMANDS list.
import { invoke } from "../../ipc";
import type {
  MarketplaceListResponse,
  PluginsListResponse,
} from "@openbuddy/protocol/dto";

// ---------- plugins + marketplace (x.ai/plugins/*, x.ai/marketplace/*) ----------

/** List installed plugins via `x.ai/plugins/list`. */
export async function pluginsList(sessionId?: string): Promise<PluginsListResponse> {
  return invoke<PluginsListResponse>("plugins_list", { sessionId: sessionId ?? null });
}

/** Execute a plugin action (enable/disable/install/etc). */
export async function pluginsAction(
  sessionId: string,
  action: unknown,
): Promise<unknown> {
  return invoke("plugins_action", { sessionId, action });
}

/** List marketplace sources + plugins via `x.ai/marketplace/list`. */
export async function marketplaceList(sessionId?: string): Promise<MarketplaceListResponse> {
  return invoke<MarketplaceListResponse>("marketplace_list", { sessionId: sessionId ?? null });
}

/** Execute a marketplace action (install/uninstall/refresh/add_source/remove_source). */
export async function marketplaceAction(
  sessionId: string,
  action: unknown,
): Promise<unknown> {
  return invoke("marketplace_action", { sessionId, action });
}
