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
 */

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
 * Map adapter capability identifiers to the Cordis plugin id that would
 * otherwise mount it. Used by `capability-plugins.ts` to decide which
 * plugins to skip when their underlying capability is passthrough'd.
 */
export const CAPABILITY_TO_PLUGIN_ID: ReadonlyMap<string, string> = new Map([
  // G-2: "team" stays Cordis-owned for multi-buddy orchestration
  // (openbuddy-team provides team_create / team_status / team_delete as
  // real pi tools via createTeamTools() and the on-disk teams.json
  // ledger). The subagent delegation path is fully owned by pi-subagents
  // (no Cordis wrapper exists by design — see capability-plugins.ts:197),
  // and the goal sub-capability is owned by pi-goal which exposes its
  // own goal_* tools. We still track both installs here so diagnostics
  // (listPassthroughed, getPassthroughInfo) can report the full surface.
  ["team", "openbuddy-team"],
  ["team-subagent", "pi-subagents"],
  ["team-goal", "pi-goal"],
  ["task", "openbuddy-task"],
  // Stage H-4: openbuddy-automation removed (Stage G-1c); capability
  // key "automation" is owned by pi-goal-list-loop-audit (npm 18,959
  // downloads/month, source of truth for goal-loop queue + audit).
  // The Cordis mount is skipped entirely — see misc.ts automations:*
  // handlers which throw a migration message pointing users at this
  // package, and AutomationPanel which surfaces the toast.
  ["automation", "pi-goal-list-loop-audit"],
  ["session", "openbuddy-session"],
  ["fs", "openbuddy-fs-local"],
  ["mcp", "openbuddy-mcp-client"],
  // C7: extend the passthrough map for additional Pi packages whose Cordis
  // counterparts in `capability-plugins.ts` already declare `passthroughCapability`.
  // Each entry is the canonical adapter npm name as published on pi.dev.
  ["plan", "pi-plan-mode"],
  // OpenBuddy historically names this surface "web"; the test suite in
  // capability-plugins.test.ts and pi-resource-loader exercises both
  // spellings. We register the canonical short name "web" as the map key
  // so the existing recordPassthrough("web", ...) call sites line up.
  ["web", "pi-web-access"],
  ["permission", "@gotgenes/pi-permission-system"],
]);

export function pluginIdForCapability(capability: string): string | undefined {
  return CAPABILITY_TO_PLUGIN_ID.get(capability);
}
