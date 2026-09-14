export interface MultiSurfaceSessionState {
  sessionId: string;
  surfaces: string[];
  refCount: number;
  generation: number;
}
export interface MultiSurfaceSessionLease { sessionId: string; surfaceId: string; generation: number; release(): void; }
type OnRelease = (sessionId: string, generation: number) => void;
export class MultiSurfaceSessionRegistry {
  private readonly sessions = new Map<string, { surfaces: Set<string>; generation: number }>();
  private readonly generations = new Map<string, number>();
  constructor(private readonly onLastRelease: OnRelease = () => undefined) {}
  acquire(sessionId: string, surfaceId: string): MultiSurfaceSessionLease {
    const id = sessionId.trim(), surface = surfaceId.trim();
    if (!id || !surface) throw new Error("multi-surface session requires sessionId and surfaceId");
    let record = this.sessions.get(id);
    if (!record) { const generation = (this.generations.get(id) ?? 0) + 1; this.generations.set(id, generation); record = { surfaces: new Set(), generation }; this.sessions.set(id, record); }
    record.surfaces.add(surface); let released = false;
    return { sessionId: id, surfaceId: surface, generation: record.generation, release: () => { if (released) return; released = true; this.release(id, surface, record!.generation); } };
  }
  release(sessionId: string, surfaceId: string, generation?: number): boolean {
    const record = this.sessions.get(sessionId); if (!record || (generation !== undefined && generation !== record.generation)) return false;
    const removed = record.surfaces.delete(surfaceId);
    if (record.surfaces.size === 0) { this.sessions.delete(sessionId); if (removed) this.onLastRelease(sessionId, record.generation); }
    return removed;
  }
  snapshot(sessionId?: string): MultiSurfaceSessionState[] {
    const records = sessionId ? [[sessionId, this.sessions.get(sessionId)] as const] : [...this.sessions.entries()];
    return records.flatMap(([id, record]) => record ? [{ sessionId: id, surfaces: [...record.surfaces], refCount: record.surfaces.size, generation: record.generation }] : []);
  }
  reset(): void { this.sessions.clear(); }
}
