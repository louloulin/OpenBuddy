import { bool, text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `extensions` module. Pi extension configuration. */
export function extensionsModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  const commands: Record<string, Handler> = {
    agent_extensions_list: () => engine.extensionsConfig(),
    agent_extensions_add: (p) =>
      engine.configureExtensions("add", text(p.path)),
    agent_extensions_remove: (p) =>
      engine.configureExtensions("remove", text(p.path)),
    agent_extensions_set_enabled: (p) =>
      engine.configureExtensions("enabled", bool(p.enabled)),
  };
  return { id: "extensions", commands };
}
