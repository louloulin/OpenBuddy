/**
 * host-modules/plugin-pi-native-inventory.ts — PI-native inventory aggregation.
 *
 * Phase 7.2 of plan3.0.md (E.2 partial):
 *   Aggregates the 4 surfaces that define "PI-native WorkBuddy" into a
 *   single response the renderer can render as a settings tab / health
 *   panel:
 *
 *     1. builtinExtensions   — the 10 BUILTIN_PI_PLUGIN_MANIFESTS entries
 *                              always present in every OpenBuddy build.
 *     2. userExtensions      — PI extensions loaded via the
 *                              discoverAndLoadExtensions path (user
 *                              ~/.pi/agent/extensions + project
 *                              .pi/extensions). These come from the
 *                              state.piExtensionStatuses filter.
 *     3. marketplacePackages — plugins from `electron/main/agent/pi-resources/marketplace.ts`
 *                              `listPlugins(cwd)` (workbuddy marketplace
 *                              sources + remote pi.dev scans).
 *     4. skillsAndAgents     — PI skill paths + agent files
 *                              (listPiPluginResourcePaths / listPiPluginAgentFiles)
 *                              plus the local `listSkills` resolver.
 *
 * Reverse-dep invariant (plan4 §4.1):
 *   This module is consumed by `plugin-lifecycle-facade.ts` (Layer 2.5).
 *   It imports nothing from agent-host.ts. All deps come via the install
 *   pattern (state + emit + cwd).
 */

import { BUILTIN_PI_PLUGIN_MANIFESTS } from "../pi-extensions";
import * as marketplace from "../pi-resources/marketplace";
import * as skills from "../pi-resources/skills";
import * as agents from "../pi-resources/agents";
import type { AgentEntry, SkillInfo } from "@openbuddy/shared-types";
import type { AgentHostState } from "./_state-shape";

export interface PiNativeInventoryBuiltin {
  id: string;
  packageName: string;
  version: string;
  description: string;
}

export interface PiNativeInventoryUserExtension {
  id: string;
  state: string;
  source?: string;
  sourceScope?: string;
  packageName?: string;
  version?: string;
  mode?: string;
  health?: string;
  toolCount?: number;
  hookCount?: number;
}

export interface PiNativeInventoryMarketplacePackage {
  name: string;
  root: string;
  enabled: boolean;
}

export interface PiNativeInventorySkill {
  name: string;
  description?: string;
  path: string;
  enabled: boolean;
}

export interface PiNativeInventorySnapshot {
  builtinExtensions: PiNativeInventoryBuiltin[];
  userExtensions: PiNativeInventoryUserExtension[];
  marketplacePackages: PiNativeInventoryMarketplacePackage[];
  skills: PiNativeInventorySkill[];
  agents: PiNativeInventoryAgent[];
  /** Aggregate counters for renderer health pill / status bar. */
  totals: {
    builtin: number;
    user: number;
    marketplace: number;
    skills: number;
    agents: number;
  };
  /** Schema version — bump when the response shape changes. */
  schemaVersion: 1;
}

export interface PiNativeInventoryAgent {
  name: string;
  path: string;
}

export interface PiNativeInventoryDeps {
  state: AgentHostState;
  cwd: string;
}

/**
 * Aggregate the 4 PI-native surfaces in one call. Safe to invoke before
 * the host is fully bootstrapped — every branch falls back to an empty
 * array instead of throwing so the renderer can render a partial state.
 */
export async function buildPiNativeInventory(
  deps: PiNativeInventoryDeps,
): Promise<PiNativeInventorySnapshot> {
  const { state, cwd } = deps;

  // 1. builtin — read directly from the manifest table. These are always
  //    present regardless of cwd / profile.
  const builtinExtensions: PiNativeInventoryBuiltin[] = BUILTIN_PI_PLUGIN_MANIFESTS.map(
    (manifest) => ({
      id: manifest.id,
      packageName: manifest.packageName ?? "",
      version: manifest.version ?? "",
      description: manifest.description ?? "",
    }),
  );

  // 2. user extensions — entries loaded via discoverAndLoadExtensions
  //    (state.piExtensionStatuses), filtered to non-builtin entries.
  const userExtensions: PiNativeInventoryUserExtension[] = state.piExtensionStatuses
    .filter((entry) => !entry.builtIn)
    .map((entry) => ({
      id: entry.id,
      state: entry.state,
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.sourceScope ? { sourceScope: entry.sourceScope } : {}),
      ...(entry.packageName ? { packageName: entry.packageName } : {}),
      ...(entry.version ? { version: entry.version } : {}),
      ...(entry.mode ? { mode: entry.mode } : {}),
      ...(entry.health ? { health: entry.health } : {}),
      ...(entry.toolCount !== undefined ? { toolCount: entry.toolCount } : {}),
      ...(entry.hookCount !== undefined ? { hookCount: entry.hookCount } : {}),
    }));

  // 3. marketplace packages — workbuddy marketplace + remote pi.dev scans.
  //    Fail soft: if the heavy HTML parser isn't ready yet, return [].
  let marketplacePackages: PiNativeInventoryMarketplacePackage[] = [];
  try {
    const plugins = await marketplace.listPlugins(cwd);
    marketplacePackages = plugins.map((plugin) => ({
      name: plugin.name,
      root: plugin.root,
      enabled: plugin.enabled,
    }));
  } catch {
    // marketplace not bootstrapped yet — keep empty array.
  }

  // 4. skills + agents — read from the pi-resource loaders. Fail soft.
  let skillsOut: PiNativeInventorySkill[] = [];
  try {
    const skillRows = await skills.listSkills(cwd);
    skillsOut = skillRows.map((row: SkillInfo) => ({
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      ...(row.path ? { path: row.path } : { path: "" }),
      enabled: row.enabled,
    }));
  } catch {
    // skills not bootstrapped yet — keep empty array.
  }

  let agentsOut: PiNativeInventoryAgent[] = [];
  try {
    const agentRows = await agents.listAgents(cwd);
    agentsOut = agentRows.map((row: AgentEntry) => ({
      name: row.name,
      path: row.path,
    }));
  } catch {
    // agents not bootstrapped yet — keep empty array.
  }

  return {
    builtinExtensions,
    userExtensions,
    marketplacePackages,
    skills: skillsOut,
    agents: agentsOut,
    totals: {
      builtin: builtinExtensions.length,
      user: userExtensions.length,
      marketplace: marketplacePackages.length,
      skills: skillsOut.length,
      agents: agentsOut.length,
    },
    schemaVersion: 1,
  };
}