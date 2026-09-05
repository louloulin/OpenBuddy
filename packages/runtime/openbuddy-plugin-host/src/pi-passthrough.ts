/**
 * pi-passthrough.ts — single source of truth for "this capability is now
 * served by a native Pi package, skip the OpenBuddy Cordis mount."
 *
 * Stage D Friction #1 + #4:
 *   - F1: when passthrough applies (user opted in or auto-detected
 *     installation), the adapter factory must not register slash commands;
 *     the legacy path already skipped this but produced no visible signal.
 *   - F4: Cordis plugins still mount their capability even when the Pi
 *     native package owns the surface, causing duplicate tool registration
 *     and stale persistence.
 *
 * The extension resolver writes to this registry; capability plugins read
 * from it during `apply()` and skip both mount + tool registration when
 * the capability is already owned by a Pi package.
 *
 * The registry is intentionally process-global and mutable: it is populated
 * once during profile bootstrap (when `findCompatibilityAdapter` decides
 * each adapter's fate) and consulted by every later plugin mount. Tests
 * call `clearPassthroughRegistry` to reset between cases.
 *
 * The static capability→plugin-id mapping is NOT defined here anymore. It
 * lives in `capability-ownership.ts` (the single authority for pi-native vs
 * OpenBuddy ownership) and is re-exported below for back-compat.
 */

import {
  CAPABILITY_TO_PLUGIN_ID as AUTHORITY_CAPABILITY_TO_PLUGIN_ID,
  pluginIdForCapability as authorityPluginIdForCapability,
} from "./capability-ownership";

const REGISTRY = new Map<string, { source: "opted-in" | "installed"; adapter: string; recordedAt: number }>();

export type PassthroughSource = "opted-in" | "installed";

export function recordPassthrough(capability: string, source: PassthroughSource, adapter: string): void {
  REGISTRY.set(capability, { source, adapter, recordedAt: Date.now() });
}

export function isPassthroughed(capability: string): boolean {
  return REGISTRY.has(capability);
}

export function getPassthroughInfo(capability: string): { source: PassthroughSource; adapter: string; recordedAt: number } | undefined {
  return REGISTRY.get(capability);
}

export function listPassthroughed(): readonly { capability: string; source: PassthroughSource; adapter: string }[] {
  return Array.from(REGISTRY.entries()).map(([capability, info]) => ({ capability, source: info.source, adapter: info.adapter }));
}

export function clearPassthroughRegistry(): void {
  REGISTRY.clear();
}

/**
 * Map adapter capability identifiers to the plugin id that would otherwise
 * mount it. Used by the capability plugins to decide which plugins to skip
 * when their underlying capability is passthrough'd.
 *
 * Derived from the single authority in `capability-ownership.ts` so the
 * pi-native vs OpenBuddy ownership decision cannot drift between the
 * extension resolver and the Cordis capability plugins.
 */
export const CAPABILITY_TO_PLUGIN_ID: ReadonlyMap<string, string> = AUTHORITY_CAPABILITY_TO_PLUGIN_ID;

export function pluginIdForCapability(capability: string): string | undefined {
  return authorityPluginIdForCapability(capability);
}
