export type PluginReadinessPhase = "idle" | "loading" | "ready" | "degraded" | "failed";

export interface PluginReadinessCounts {
  loaded: number;
  pending: number;
  failed: number;
  disabled: number;
  degraded: number;
}

export interface PluginReadinessSnapshot {
  version: 1;
  phase: PluginReadinessPhase;
  generation: number;
  updatedAt: string;
  main: PluginReadinessCounts;
  pi: PluginReadinessCounts;
  transaction?: {
    id: string;
    kind: string;
    target: string;
    phase?: string;
    surface?: string;
  };
  error?: string;
}

export interface PluginReadinessEntry {
  state: string;
  health?: string;
}

export function readinessCounts(entries: readonly PluginReadinessEntry[]): PluginReadinessCounts {
  return entries.reduce<PluginReadinessCounts>((counts, entry) => {
    if (entry.state === "disabled") counts.disabled += 1;
    else if (entry.state === "failed" || entry.health === "failed") counts.failed += 1;
    else if (entry.state === "pending" || entry.state === "loading" || entry.state === "unloading") counts.pending += 1;
    else {
      counts.loaded += 1;
      if (entry.health === "degraded") counts.degraded += 1;
    }
    return counts;
  }, { loaded: 0, pending: 0, failed: 0, disabled: 0, degraded: 0 });
}

export function createPluginReadinessSnapshot(input: {
  phase: PluginReadinessPhase;
  generation: number;
  main: readonly PluginReadinessEntry[];
  pi: readonly PluginReadinessEntry[];
  transaction?: PluginReadinessSnapshot["transaction"];
  error?: string;
  updatedAt?: string;
}): PluginReadinessSnapshot {
  const main = readinessCounts(input.main);
  const pi = readinessCounts(input.pi);
  const failed = main.failed + pi.failed;
  const pending = main.pending + pi.pending;
  const degraded = main.degraded + pi.degraded;
  const phase = input.phase === "idle"
    ? "idle"
    : failed > 0 || input.phase === "failed"
    ? "failed"
    : pending > 0 || input.phase === "loading"
    ? "loading"
    : degraded > 0
    ? "degraded"
    : "ready";
  return {
    version: 1,
    phase,
    generation: input.generation,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    main,
    pi,
    ...(input.transaction ? { transaction: { ...input.transaction } } : {}),
    ...(input.error ? { error: input.error } : {}),
  };
}
