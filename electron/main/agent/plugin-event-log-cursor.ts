export type PluginEventLogCursorErrorCode = "unknown-session" | "already-attached" | "not-attached" | "frozen" | "cleared" | "generation-mismatch" | "gap";
export interface PluginEventLogCursorError { ok: false; code: PluginEventLogCursorErrorCode; message: string; }
export interface PluginEventLogCursorLease { ok: true; sessionId: string; surfaceId: string; generation: number; cursor: string | null; }
export type PluginEventLogCursorResult = PluginEventLogCursorLease | PluginEventLogCursorError;
export interface PluginEventLogCursorState { sessionId: string; generation: number; frozen: boolean; cursors: Record<string, string | null>; }
type CursorRecord = { generation: number; frozen: boolean; archived: boolean; cursors: Map<string, string | null>; events: Array<{ eventId: string; event: unknown }> };
const error = (code: PluginEventLogCursorErrorCode, message: string): PluginEventLogCursorError => ({ ok: false, code, message });

export class PluginEventLogCursorRegistry {
  private readonly records = new Map<string, CursorRecord>();
  private readonly cleared = new Set<string>();
  attachSurface(sessionId: string, surfaceId: string): PluginEventLogCursorResult {
    const session = sessionId.trim(), surface = surfaceId.trim();
    if (!session || !surface) return error("unknown-session", "sessionId and surfaceId are required");
    if (this.cleared.has(session)) return error("cleared", `cursor for ${session} was cleared`);
    const record = this.records.get(session);
    if (record?.frozen) return error("frozen", `cursor for ${session} is frozen`);
    const active = record ?? { generation: 1, frozen: false, archived: false, cursors: new Map<string, string | null>(), events: [] as Array<{ eventId: string; event: unknown }> };
    if (active.cursors.has(surface)) return error("already-attached", `surface ${surface} is already attached`);
    active.cursors.set(surface, null); this.records.set(session, active);
    return { ok: true, sessionId: session, surfaceId: surface, generation: active.generation, cursor: null };
  }
  advance(sessionId: string, surfaceId: string, eventId: string, generation?: number): PluginEventLogCursorResult {
    const record = this.records.get(sessionId);
    if (!record) return error("unknown-session", `cursor for ${sessionId} is not attached`);
    if (record.archived || this.cleared.has(sessionId)) return error("cleared", `cursor for ${sessionId} was cleared`);
    if (record.frozen) return error("frozen", `cursor for ${sessionId} is frozen`);
    if (!record.cursors.has(surfaceId)) return error("not-attached", `surface ${surfaceId} is not attached`);
    if (generation !== undefined && generation !== record.generation) return error("generation-mismatch", `generation ${generation} does not match ${record.generation}`);
    if (!eventId.trim()) return error("unknown-session", "eventId is required");
    record.cursors.set(surfaceId, eventId);
    return { ok: true, sessionId, surfaceId, generation: record.generation, cursor: eventId };
  }
  detachSurface(sessionId: string, surfaceId: string, generation?: number): PluginEventLogCursorResult {
    const record = this.records.get(sessionId);
    if (!record) return error("unknown-session", `cursor for ${sessionId} is not attached`);
    if (record.archived || this.cleared.has(sessionId)) return error("cleared", `cursor for ${sessionId} was cleared`);
    if (generation !== undefined && generation !== record.generation) return error("generation-mismatch", `generation ${generation} does not match ${record.generation}`);
    if (!record.cursors.has(surfaceId)) return error("not-attached", `surface ${surfaceId} is not attached`);
    record.cursors.delete(surfaceId); if (record.cursors.size === 0) record.frozen = true;
    return { ok: true, sessionId, surfaceId, generation: record.generation, cursor: null };
  }
  append(sessionId: string, eventId: string, event: unknown): void {
    const record = this.records.get(sessionId);
    if (!record || record.archived) return;
    record.events.push({ eventId, event });
    if (record.events.length > 2000) record.events.splice(0, record.events.length - 2000);
  }
  readSince(sessionId: string, surfaceId: string, sinceEventId?: string, limit = 2000): { ok: true; events: unknown[]; nextCursor: string | null; truncated: boolean } | PluginEventLogCursorError {
    const record = this.records.get(sessionId);
    if (this.cleared.has(sessionId)) return error("cleared", `cursor for ${sessionId} was cleared`);
    if (!record) return error("unknown-session", `cursor for ${sessionId} is not attached`);
    if (record.archived || this.cleared.has(sessionId)) return error("cleared", `cursor for ${sessionId} was cleared`);
    if (record.frozen) return error("frozen", `cursor for ${sessionId} is frozen`);
    if (!record.cursors.has(surfaceId)) return error("not-attached", `surface ${surfaceId} is not attached`);
    const start = sinceEventId ? record.events.findIndex((entry) => entry.eventId === sinceEventId) + 1 : 0;
    if (sinceEventId && start === 0) return error("gap", `event ${sinceEventId} is outside the retained ring buffer`);
    const selected = record.events.slice(start, start + Math.max(1, Math.min(limit, 2000)));
    const nextCursor = selected.at(-1)?.eventId ?? sinceEventId ?? null;
    record.cursors.set(surfaceId, nextCursor);
    return { ok: true, events: selected.map((entry) => entry.event), nextCursor, truncated: start + selected.length < record.events.length };
  }
  disposeOwner(sessionId: string): { ok: true; archived: true } {
    const record = this.records.get(sessionId); if (record) { record.archived = true; record.cursors.clear(); this.records.delete(sessionId); }
    this.cleared.add(sessionId); return { ok: true, archived: true };
  }
  snapshot(sessionId?: string): PluginEventLogCursorState[] {
    const entries = sessionId ? [[sessionId, this.records.get(sessionId)] as const] : [...this.records.entries()];
    return entries.flatMap(([id, record]) => record ? [{ sessionId: id, generation: record.generation, frozen: record.frozen, cursors: Object.fromEntries(record.cursors) }] : []);
  }
}
export const pluginEventLogCursor = new PluginEventLogCursorRegistry();
