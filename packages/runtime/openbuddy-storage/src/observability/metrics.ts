export interface StorageMetrics {
  writes: number;
  busy: number;
  rollbacks: number;
  totalLatencyMs: number;
  maxLatencyMs: number;
  lastWriteAt?: string;
}

export interface StorageMetricsSnapshot extends StorageMetrics {
  queueDepth: number;
  schemaVersion: number;
  migrationIssues: number;
  lastBackupAt?: string;
}

export class StorageMetricsRegistry {
  private readonly history: StorageMetricsSnapshot[] = [];

  recordSnapshot(snapshot: StorageMetricsSnapshot, limit = 32): void {
    this.history.push(snapshot);
    while (this.history.length > limit) this.history.shift();
  }

  recentHistory(limit = 8): StorageMetricsSnapshot[] {
    if (limit <= 0 || this.history.length === 0) return [];
    return this.history.slice(-limit);
  }

  clearHistory(): void {
    this.history.length = 0;
  }

  private readonly writes = new Map<string, StorageMetrics>();

  recordWrite(key: string, latencyMs: number, status: "ok" | "rollback" | "busy", timestamp: string): void {
    const current = this.writes.get(key) ?? { writes: 0, busy: 0, rollbacks: 0, totalLatencyMs: 0, maxLatencyMs: 0 };
    current.writes += 1;
    current.totalLatencyMs += latencyMs;
    current.maxLatencyMs = Math.max(current.maxLatencyMs, latencyMs);
    current.lastWriteAt = timestamp;
    if (status === "rollback") current.rollbacks += 1;
    if (status === "busy") current.busy += 1;
    this.writes.set(key, current);
  }

  snapshot(key: string, queueDepth: number, schemaVersion: number, migrationIssues: number, lastBackupAt?: string): StorageMetricsSnapshot {
    const metrics = this.writes.get(key) ?? { writes: 0, busy: 0, rollbacks: 0, totalLatencyMs: 0, maxLatencyMs: 0 };
    return {
      ...metrics,
      queueDepth,
      schemaVersion,
      migrationIssues,
      ...(lastBackupAt ? { lastBackupAt } : {}),
    };
  }

  reset(key: string): void {
    this.writes.delete(key);
  }
}
