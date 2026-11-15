import { bool, text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";
/** Optional text payload (absent, null and "" all mean "not supplied"). */
const opt = (value: unknown) => (typeof value === "string" && value ? value : undefined);
/** §5.3 `extensions` module. Pi extension configuration + 扩展中心 (W2.6). */
export function extensionsModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  const commands: Record<string, Handler> = {
    // 扩展中心 (W2.6): paths + what each registers + last load errors.
    agent_extensions_list: (p) => engine.extensionsList(opt(p.cwd)),
    agent_extensions_inspect: (p) => engine.extensionsInspect(text(p.path), opt(p.cwd)),
    agent_extensions_add: (p) =>
      engine.configureExtensions("add", text(p.path)),
    agent_extensions_remove: (p) =>
      engine.configureExtensions("remove", text(p.path)),
    agent_extensions_set_enabled: (p) =>
      engine.configureExtensions("enabled", bool(p.enabled)),
    /** Per-extension switch (W2.6): disabled paths stay configured but are not loaded. */
    agent_extensions_set_path_enabled: (p) =>
      engine.setExtensionPathEnabled(text(p.path), bool(p.enabled)),
  };
  return { id: "extensions", commands };
}
