export interface MultiSurfaceSessionState {
  sessionId: string;
  surfaces: string[];
  refCount: number;
  generation: number;
}
export interface MultiSurfaceSessionError { ok: false; code: "disposed" | "generation-mismatch" | "duplicate-release" | "unknown-session"; message: string; }
export type MultiSurfaceSessionReleaseResult = { ok: true; released: boolean } | MultiSurfaceSessionError;
export interface MultiSurfaceSessionLease { ok: true; sessionId: string; surfaceId: string; generation: number; release(): MultiSurfaceSessionReleaseResult; }
export type MultiSurfaceSessionAcquireResult = MultiSurfaceSessionLease | MultiSurfaceSessionError;
type OwnerDispose = () => void | Promise<void>;
type OnRelease = (sessionId: string, generation: number) => void | Promise<void>;
type SessionRecord = { surfaces: Set<string>; generation: number; disposed: boolean };

export class MultiSurfaceSessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly generations = new Map<string, number>();
  private readonly disposedSessions = new Set<string>();
  constructor(private readonly onLastRelease: OnRelease = () => undefined) {}
  acquire(sessionId: string, surfaceId: string): MultiSurfaceSessionAcquireResult {
    const id = sessionId.trim(), surface = surfaceId.trim();
    if (!id || !surface) throw new Error("multi-surface session requires sessionId and surfaceId");
    const existing = this.sessions.get(id);
    if (existing?.disposed || this.disposedSessions.has(id)) return { ok: false, code: "disposed", message: `session ${id} is already disposed` };
    let record = existing;
    if (!record) {
      const generation = (this.generations.get(id) ?? 0) + 1;
      this.generations.set(id, generation);
      record = { surfaces: new Set(), generation, disposed: false };
      this.sessions.set(id, record);
    }
    record.surfaces.add(surface);
    let released = false;
    return { ok: true, sessionId: id, surfaceId: surface, generation: record.generation, release: () => {
      if (released) return { ok: false, code: "duplicate-release", message: `surface ${surface} was already released` };
      released = true;
      return this.release(id, surface, record!.generation);
    } };
  }
  release(sessionId: string, surfaceId: string, generation?: number, ownerDispose?: OwnerDispose): MultiSurfaceSessionReleaseResult {
    const record = this.sessions.get(sessionId);
    if (!record) return { ok: false, code: "unknown-session", message: `session ${sessionId} is not active` };
    if (record.disposed) return { ok: false, code: "disposed", message: `session ${sessionId} is already disposed` };
    if (generation !== undefined && generation !== record.generation) return { ok: false, code: "generation-mismatch", message: `generation ${generation} does not match ${record.generation}` };
    if (!record.surfaces.has(surfaceId)) return { ok: false, code: "duplicate-release", message: `surface ${surfaceId} was already released` };
    record.surfaces.delete(surfaceId);
    if (record.surfaces.size === 0) {
      record.disposed = true;
      this.sessions.delete(sessionId);
      this.disposedSessions.add(sessionId);
      try {
        const result = ownerDispose ? ownerDispose() : this.onLastRelease(sessionId, record.generation);
        void Promise.resolve(result).catch(() => undefined);
      } catch { /* disposal failures never restore a lease */ }
    }
    return { ok: true, released: true };
  }
  snapshot(sessionId?: string): MultiSurfaceSessionState[] {
    const records = sessionId ? [[sessionId, this.sessions.get(sessionId)] as const] : [...this.sessions.entries()];
    return records.flatMap(([id, record]) => record && !record.disposed ? [{ sessionId: id, surfaces: [...record.surfaces], refCount: record.surfaces.size, generation: record.generation }] : []);
  }
  reset(): void { this.sessions.clear(); this.disposedSessions.clear(); }
}
