/**
 * capability-ownership.ts — single authority for "which plugin owns a
 * capability" across the pi-native + OpenBuddy plugin boundary.
 *
 * This is the consolidation point for two previously-overlapping sources of
 * truth:
 *   1. `compatibilityAdapters` in `electron/main/agent/pi-extensions.ts`
 *      (the 12 passthrough-eligible adapters: mcp, permission, goal, plan,
 *      task, session, fs, lens, simplify, hashline, worktree, automation).
 *   2. `CAPABILITY_TO_PLUGIN_ID` in `pi-passthrough.ts` (the Cordis plugin id
 *      to skip when a capability is passthrough'd, plus the team/web family).
 *
 * Every capability that can be served by either a native Pi package or an
 * OpenBuddy plugin is declared here exactly once. Consumers derive their
 * views from this table instead of maintaining their own copy, so the
 * "pi owns it vs OpenBuddy owns it" decision cannot drift between the
 * extension resolver and the Cordis capability plugins.
 *
 * Ownership model:
 *   - `piPlugin`      — the native Pi package that owns the surface when
 *                       passthrough applies (user opted in or auto-detected).
 *   - `openbuddyPlugin` — the OpenBuddy plugin/service that owns it as the
 *                       Cordis fallback when passthrough does NOT apply.
 *   - `serviceKey`    — the Cordis service key backing `openbuddyPlugin`.
 *   - `passthrough`   — whether this capability is passthrough-eligible.
 *   - `pluginId`      — the plugin id that would otherwise mount the surface
 *                       and must be skipped on passthrough (this is what
 *                       `CAPABILITY_TO_PLUGIN_ID` is derived from).
 */

export interface CapabilityOwnership {
  /** Canonical capability key (e.g. "mcp", "permission", "goal"). */
  capability: string;
  /** Native Pi package that owns the surface when passthrough applies. */
  piPlugin: string;
  /** OpenBuddy plugin/service that owns it as the Cordis fallback. */
  openbuddyPlugin: string;
  /** Cordis service key backing `openbuddyPlugin` (empty when none). */
  serviceKey: string;
  /** Whether this capability is passthrough-eligible. */
  passthrough: boolean;
  /** Plugin id to skip on passthrough (derives `CAPABILITY_TO_PLUGIN_ID`). */
  pluginId: string;
  /** Optional ownership rationale. */
  note?: string;
}

/**
 * The single authority table. Ordered by the 12 compatibility adapters first
 * (the double-track surface), then the team/web family that has no adapter
 * but still participates in passthrough bookkeeping.
 */
export const CAPABILITY_OWNERSHIP: readonly CapabilityOwnership[] = [
  // --- 12 compatibility adapters (pi-extensions.ts) ---
  {
    capability: "mcp",
    piPlugin: "pi-mcp-adapter",
    openbuddyPlugin: "openbuddy-mcp-client",
    serviceKey: "mcpClient",
    passthrough: true,
    pluginId: "openbuddy-mcp-client",
  },
  {
    capability: "permission",
    piPlugin: "pi-permission-system",
    openbuddyPlugin: "openbuddy-authorization",
    serviceKey: "permission",
    passthrough: true,
    // Canonical npm name as published on pi.dev (differs from the adapter
    // hint `pi-permission-system`; kept for back-compat with the registry).
    pluginId: "@gotgenes/pi-permission-system",
  },
  {
    capability: "goal",
    piPlugin: "pi-goal",
    openbuddyPlugin: "openbuddy-team",
    serviceKey: "team",
    passthrough: true,
    pluginId: "pi-goal",
  },
  {
    capability: "plan",
    piPlugin: "pi-plan-mode",
    openbuddyPlugin: "pi-plan-mode",
    serviceKey: "plan",
    passthrough: true,
    pluginId: "pi-plan-mode",
  },
  {
    capability: "task",
    piPlugin: "@juicesharp/rpiv-todo",
    openbuddyPlugin: "openbuddy-task",
    serviceKey: "task",
    passthrough: true,
    pluginId: "openbuddy-task",
  },
  {
    capability: "session",
    piPlugin: "pi-session",
    openbuddyPlugin: "openbuddy-session",
    serviceKey: "sessions",
    passthrough: true,
    pluginId: "openbuddy-session",
  },
  {
    capability: "fs",
    piPlugin: "pi-fs",
    openbuddyPlugin: "openbuddy-fs-local",
    serviceKey: "fsLocal",
    passthrough: true,
    pluginId: "openbuddy-fs-local",
  },
  {
    capability: "lens",
    piPlugin: "pi-lens",
    openbuddyPlugin: "pi-lens",
    serviceKey: "lens",
    passthrough: true,
    pluginId: "pi-lens",
  },
  {
    capability: "simplify",
    piPlugin: "pi-simplify",
    openbuddyPlugin: "pi-simplify",
    serviceKey: "simplify",
    passthrough: true,
    pluginId: "pi-simplify",
  },
  {
    capability: "hashline",
    piPlugin: "pi-hashline-edit-pro",
    openbuddyPlugin: "pi-hashline-edit-pro",
    serviceKey: "hashline",
    passthrough: true,
    pluginId: "pi-hashline-edit-pro",
  },
  {
    capability: "worktree",
    piPlugin: "@dietrichgebert/ponytail",
    openbuddyPlugin: "@dietrichgebert/ponytail",
    serviceKey: "worktree",
    passthrough: true,
    pluginId: "@dietrichgebert/ponytail",
  },
  {
    capability: "automation",
    piPlugin: "pi-goal-list-loop-audit",
    openbuddyPlugin: "pi-goal-list-loop-audit",
    serviceKey: "automation",
    passthrough: true,
    pluginId: "pi-goal-list-loop-audit",
  },

  // --- team/web family (no adapter, but participates in passthrough) ---
  {
    capability: "team",
    piPlugin: "pi-goal",
    openbuddyPlugin: "openbuddy-team",
    serviceKey: "team",
    // G-2: "team" stays Cordis-owned for multi-buddy orchestration.
    passthrough: false,
    pluginId: "openbuddy-team",
    note: "team stays Cordis-owned; subagent delegation is pi-subagents, goal sub-capability is pi-goal.",
  },
  {
    capability: "team-subagent",
    piPlugin: "pi-subagents",
    openbuddyPlugin: "pi-subagents",
    serviceKey: "",
    passthrough: true,
    pluginId: "pi-subagents",
    note: "No Cordis wrapper exists by design; fully owned by pi-subagents.",
  },
  {
    capability: "team-goal",
    piPlugin: "pi-goal",
    openbuddyPlugin: "pi-goal",
    serviceKey: "",
    passthrough: true,
    pluginId: "pi-goal",
    note: "Goal sub-capability owned by pi-goal which exposes its own goal_* tools.",
  },
  {
    capability: "web",
    piPlugin: "pi-web-access",
    openbuddyPlugin: "pi-web-access",
    serviceKey: "",
    passthrough: true,
    pluginId: "pi-web-access",
    note: "Canonical short name 'web'; the test suite exercises both 'web' and 'web-access' spellings.",
  },
];

/** Look up ownership by canonical capability key. */
export function ownershipForCapability(capability: string): CapabilityOwnership | undefined {
  return CAPABILITY_OWNERSHIP.find((entry) => entry.capability === capability);
}

/** The native Pi package that owns a capability when passthrough applies. */
export function piPluginForCapability(capability: string): string | undefined {
  return ownershipForCapability(capability)?.piPlugin;
}

/** The OpenBuddy plugin that owns a capability as the Cordis fallback. */
export function openbuddyPluginForCapability(capability: string): string | undefined {
  return ownershipForCapability(capability)?.openbuddyPlugin;
}

/** The plugin id to skip on passthrough (derives `CAPABILITY_TO_PLUGIN_ID`). */
export function pluginIdForCapability(capability: string): string | undefined {
  return ownershipForCapability(capability)?.pluginId;
}

/** All passthrough-eligible capabilities. */
export function listPassthroughEligible(): readonly CapabilityOwnership[] {
  return CAPABILITY_OWNERSHIP.filter((entry) => entry.passthrough);
}

/** All capabilities that stay OpenBuddy/Cordis-owned (passthrough: false). */
export function listOpenBuddyOwned(): readonly CapabilityOwnership[] {
  return CAPABILITY_OWNERSHIP.filter((entry) => !entry.passthrough);
}

/**
 * The capability → plugin-id map, derived from the authority. Kept as a
 * `ReadonlyMap` so existing consumers (`pi-passthrough.ts`) and tests see
 * the same shape as before, but the content now has a single origin.
 */
export const CAPABILITY_TO_PLUGIN_ID: ReadonlyMap<string, string> = new Map(
  CAPABILITY_OWNERSHIP.map((entry) => [entry.capability, entry.pluginId]),
);
