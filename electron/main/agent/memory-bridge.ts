/**
 * pi-memory bridge — wire pi's `@amaster.ai/pi-memory-mem0` / `pi-memory`
 * semantic recall results into OpenBuddy's authoritative `Memory` service
 * without clobbering Markdown storage.
 *
 * Design:
 *   1. `Memory` (openbuddy-memory) is the source of truth — every write
 *      hits Markdown + SQLite FTS5. Reads default to FTS5 ranking.
 *   2. When a pi-memory package is detected in node_modules and the
 *      active session opts in (`OPENBUDDY_MEMORY_BRIDGE=1` or the
 *      `memoryBridge` config flag), the bridge wraps the canonical
 *      `search()` query with a semantic pre-filter: it asks the pi
 *      package for top-N candidates by embedding similarity and merges
 *      them with the FTS5 hits, deduplicating by id and tagging every
 *      result with `source: "semantic" | "fts" | "both"`.
 *   3. Writes never go to the pi package — OpenBuddy remains authoritative
 *      for persistence. This matches the architecture chosen for
 *      `pi-telemetry-bridge.ts`: bridge forwards observations, never
 *      owns state.
 *
 * The bridge is intentionally schema-light: it only depends on the
 * `MemoryIndex.search()` signature plus a `SemanticRecallAdapter`
 * interface that callers wire in. We avoid hard-coding any single
 * pi-memory package's API so the bridge is reusable across
 * `pi-memory`, `@amaster.ai/pi-memory-mem0`, or future drops.
 */

import { isPiPackageInstalled } from "./pi-package-installed";

/** A single memory hit returned by the canonical search. */
export interface MemoryHit {
  id: string;
  title: string;
  body: string;
  tags: string[];
  source: "fts" | "semantic" | "both";
  score: number;
}

/** Adapter the caller wires in to ask the pi-memory package for hits. */
export interface SemanticRecallAdapter {
  /** Stable identifier so logs can attribute recall to a specific package. */
  readonly kind: string;
  /**
   * Query the semantic store. Implementations should be best-effort:
   * any thrown error must propagate so the bridge can fall back to FTS.
   */
  recall(query: string, options?: { limit?: number }): Promise<
    Array<{ id: string; score: number; title?: string; body?: string }>
  >;
}

/** Configuration for the bridge. */
export interface MemoryBridgeConfig {
  /** Hard cap on the merged result set. Defaults to 20. */
  limit?: number;
  /** When true, the bridge is forced on even if the env flag is unset. */
  enabled?: boolean;
}

const DEFAULT_LIMIT = 20;
const ENV_FLAG = "OPENBUDDY_MEMORY_BRIDGE";

/**
 * Returns true when:
 *   - any of the known pi-memory packages is installed, AND
 *   - either `OPENBUDDY_MEMORY_BRIDGE=1` or `enabled: true` is set.
 * This is the gate the canonical `Memory.search()` consults before
 * delegating to the bridge.
 */
export function isMemoryBridgeActive(config?: MemoryBridgeConfig): boolean {
  if (config?.enabled === true) {
    return isAnyPiMemoryPackageInstalled();
  }
  if (process.env[ENV_FLAG] !== "1") return false;
  return isAnyPiMemoryPackageInstalled();
}

function isAnyPiMemoryPackageInstalled(): boolean {
  return (
    isPiPackageInstalled("pi-memory") ||
    isPiPackageInstalled("@amaster.ai/pi-memory-mem0") ||
    isPiPackageInstalled("pi-hermes-memory") ||
    isPiPackageInstalled("@remnic/plugin-pi")
  );
}

/**
 * Merge FTS hits and semantic hits, deduplicating by `id` and tagging
 * each entry with its provenance. FTS scores dominate ties so the
 * canonical ordering stays predictable for the UI.
 */
export function mergeMemoryHits(
  ftsHits: Array<Omit<MemoryHit, "source">>,
  semanticHits: Array<Omit<MemoryHit, "source">>,
  limit: number,
): MemoryHit[] {
  const byId = new Map<string, MemoryHit>();
  for (const hit of ftsHits) {
    byId.set(hit.id, { ...hit, source: "fts" });
  }
  for (const hit of semanticHits) {
    const existing = byId.get(hit.id);
    if (existing) {
      byId.set(hit.id, {
        ...existing,
        body: hit.body && existing.body ? `${existing.body}\n---\n${hit.body}` : existing.body || hit.body,
        score: Math.max(existing.score, hit.score),
        source: "both",
      });
    } else {
      byId.set(hit.id, { ...hit, source: "semantic" });
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * High-level entry point: takes the canonical FTS hits, runs the
 * semantic adapter, and returns the merged set. The adapter is only
 * consulted when the bridge is active.
 */
export async function bridgeMemorySearch(
  query: string,
  ftsHits: Array<Omit<MemoryHit, "source">>,
  adapter: SemanticRecallAdapter | undefined,
  config: MemoryBridgeConfig = {},
): Promise<MemoryHit[]> {
  const limit = config.limit ?? DEFAULT_LIMIT;
  if (!adapter || !isMemoryBridgeActive(config)) {
    return ftsHits.slice(0, limit).map((hit) => ({ ...hit, source: "fts" as const }));
  }
  let semantic: Array<Omit<MemoryHit, "source">> = [];
  try {
    semantic = (await adapter.recall(query, { limit })) as Array<Omit<MemoryHit, "source">>;
  } catch {
    // Adapter failures must never break search — fall back to FTS only.
    return ftsHits.slice(0, limit).map((hit) => ({ ...hit, source: "fts" as const }));
  }
  return mergeMemoryHits(ftsHits, semantic, limit);
}

export const MEMORY_BRIDGE_KIND = "openbuddy.memory-bridge";
export const MEMORY_BRIDGE_ENV_FLAG = ENV_FLAG;
