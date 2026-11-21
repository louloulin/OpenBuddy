import { bool, text } from "@openbuddy/services/settings/settings";
import { ExtensionRegistryService } from "@openbuddy/services/extensions/registry";
import type { ExtensionPackageFilters } from "@openbuddy/protocol/extensions";
import type { Handler, HostContext, HostModule } from "../module.js";
/** Optional text payload (absent, null and "" all mean "not supplied"). */
const opt = (value: unknown) => (typeof value === "string" && value ? value : undefined);
/** §5.3 `extensions` module. Pi extension configuration + 扩展中心 (W2.6). */
export function extensionsModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  // Pi 包市场 (S15): the public npm registry, filtered by Pi's `pi-package` keyword.
  const registry = new ExtensionRegistryService({ ...(ctx.options.fetchImpl ? { fetchImpl: ctx.options.fetchImpl } : {}) });
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
    // 扩展包 (W2.6 P2 / S14): npm / git sources through Pi's DefaultPackageManager.
    agent_extensions_packages: (p) => engine.extensionPackages(opt(p.cwd)),
    agent_extensions_install_package: (p) =>
      engine.installExtensionPackage(text(p.source, "source"), opt(p.cwd)),
    agent_extensions_remove_package: (p) =>
      engine.removeExtensionPackage(text(p.source, "source"), opt(p.cwd)),
    agent_extensions_update_packages: (p) =>
      engine.updateExtensionPackages(opt(p.source), opt(p.cwd)),
    agent_extensions_preview_package: (p) =>
      engine.previewExtensionPackage(text(p.source, "source"), opt(p.cwd)),
    agent_extensions_check_updates: (p) => engine.extensionUpdates(opt(p.cwd)),
    // Pi 包市场与包资源 (S15): real npm search results + what installed packages contribute.
    agent_extensions_search_registry: (p) =>
      registry.search(typeof p.query === "string" ? p.query : "", { from: typeof p.offset === "number" ? p.offset : 0 }),
    // 包详情 (E1): integrity / 维护者 / 发布时间 / git commit —— 审查一个包的真实依据。
    agent_extensions_package_details: (p) => registry.details(text(p.name, "name")),
    agent_extensions_resources: (p) => engine.extensionResources(opt(p.cwd)),
    // 包资源开关 (S17): the payload is validated by the protocol before reaching here.
    agent_extensions_set_package_resources: (p) =>
      engine.setExtensionPackageResources(text(p.source, "source"), p.resources as ExtensionPackageFilters, opt(p.cwd)),
  };
  return { id: "extensions", commands };
}
