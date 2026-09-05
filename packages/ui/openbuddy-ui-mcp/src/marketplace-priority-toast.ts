/**
 * Phase I.3 helper — builds the toast message for a marketplace action
 * result.
 *
 * When the installed/removed package matches a registered pi-priority
 * compatibility adapter (one whose `packageNames` entry appears in
 * `compatibilityAdapters`), the IPC payload carries `piPriorityEnabled` /
 * `capability` so the user knows that OpenBuddy will now prefer the native
 * pi implementation (or fall back to the OpenBuddy adapter after uninstall).
 *
 * For non-pi-priority packages (Cordis bundles, skills-only plugins, ...)
 * the IPC payload has no extra fields and we fall back to the simple toast.
 */

export interface MarketplacePriorityToastInput {
  piPriorityEnabled?: boolean;
  piPriorityEnabledBefore?: boolean;
  capability?: string;
}

export type MarketplaceVerb = "install" | "uninstall" | "update";

export function describeMarketplaceResult(
  pluginName: string,
  verb: MarketplaceVerb,
  result: MarketplacePriorityToastInput | null | undefined,
): string {
  const fallback = (label: string) => `${label}「${pluginName}」`;
  if (!result) {
    if (verb === "install") return fallback("已安装");
    if (verb === "uninstall") return fallback("已卸载");
    return fallback("已更新");
  }
  if (verb === "install") {
    if (result.piPriorityEnabled && result.capability) {
      return `✓ ${pluginName} 已安装。OpenBuddy 将优先使用原生 pi 实现 (capability: ${result.capability})。Cordis 兼容层已自动禁用,Next session 起生效。`;
    }
    return fallback("已安装");
  }
  if (verb === "update") {
    if (result.piPriorityEnabled && result.capability) {
      return `✓ ${pluginName} 已更新。OpenBuddy 将继续优先使用原生 pi 实现 (capability: ${result.capability})。Cordis 兼容层保持禁用。`;
    }
    return fallback("已更新");
  }
  // uninstall
  if (result.piPriorityEnabledBefore && result.capability) {
    return `✓ ${pluginName} 已卸载。原 pi-priority 已被移除,OpenBuddy fallback (capability: ${result.capability}) 已恢复。`;
  }
  return fallback("已卸载");
}
