import type { PluginReadinessSnapshot } from "./readiness";

export const pluginSurfaceKinds = ["bundle", "pi", "renderer", "remote", "typert", "cordis"] as const;
export type PluginSurfaceKind = (typeof pluginSurfaceKinds)[number];

export type PluginSnapshotPackageInput = {
  name: string;
  version?: string;
  expected: readonly PluginSurfaceKind[];
  loaded: readonly PluginSurfaceKind[];
  health?: "healthy" | "degraded";
};

export type PluginSnapshotPackage = PluginSnapshotPackageInput & {
  expected: PluginSurfaceKind[];
  loaded: PluginSurfaceKind[];
  missing: PluginSurfaceKind[];
  complete: boolean;
};

export type PluginSnapshotRecovery = {
  pending: number;
  uncertain: number;
  byMethod: Record<string, number>;
};

export type PluginSnapshot = {
  version: 1;
  generation: number;
  updatedAt: string;
  phase: PluginReadinessSnapshot["phase"];
  readiness: PluginReadinessSnapshot;
  surfaces: Record<PluginSurfaceKind, { expected: number; loaded: number; missing: number }>;
  packages: PluginSnapshotPackage[];
  consistency: { complete: boolean; issues: string[] };
  /** Persistent side-effect RPC recovery queue summary (pending + uncertain intents). */
  recovery: PluginSnapshotRecovery;
  /** Last profile/plugin transaction that reached a committed or restored state. */
  commit: {
    generation: number;
    transactionId?: string;
    kind?: string;
    target?: string;
    committedAt?: string;
    rolledBack?: boolean;
    receipts?: Record<string, {
      surface: string;
      preparedAt: string;
      details?: Record<string, unknown>;
    }>;
  };
};

function uniqueKinds(values: readonly PluginSurfaceKind[]): PluginSurfaceKind[] {
  return pluginSurfaceKinds.filter((kind) => values.includes(kind));
}

/** Build the cross-face plugin state used by Main, Renderer and Harness clients. */
export function createPluginSnapshot(input: {
  generation: number;
  readiness: PluginReadinessSnapshot;
  packages: readonly PluginSnapshotPackageInput[];
  updatedAt?: string;
  recovery?: PluginSnapshotRecovery;
  commit?: PluginSnapshot["commit"];
}): PluginSnapshot {
  const packages = input.packages
    .filter((entry) => typeof entry.name === "string" && entry.name.length > 0)
    .map((entry) => {
      const expected = uniqueKinds(entry.expected);
      const loaded = uniqueKinds(entry.loaded);
      const missing = expected.filter((kind) => !loaded.includes(kind));
      return {
        name: entry.name,
        ...(entry.version ? { version: entry.version } : {}),
        expected,
        loaded,
        missing,
        complete: missing.length === 0 && entry.health !== "degraded",
        ...(entry.health ? { health: entry.health } : {}),
      } satisfies PluginSnapshotPackage;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const surfaces = Object.fromEntries(pluginSurfaceKinds.map((kind) => [
    kind,
    {
      expected: packages.filter((entry) => entry.expected.includes(kind)).length,
      loaded: packages.filter((entry) => entry.loaded.includes(kind)).length,
      missing: packages.filter((entry) => entry.missing.includes(kind)).length,
    },
  ])) as PluginSnapshot["surfaces"];
  const issues = packages.flatMap((entry) => entry.missing.map((kind) => `${entry.name}: ${kind} surface is not loaded`));
  if (input.readiness.phase === "failed") issues.unshift("plugin readiness is failed");
  if (input.readiness.phase === "loading") issues.unshift("plugin readiness is still loading");
  return {
    version: 1,
    generation: input.generation,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    phase: input.readiness.phase,
    readiness: input.readiness,
    surfaces,
    packages,
    consistency: { complete: issues.length === 0, issues },
    recovery: input.recovery ?? { pending: 0, uncertain: 0, byMethod: {} },
    commit: input.commit ?? { generation: 0 },
  };
}
