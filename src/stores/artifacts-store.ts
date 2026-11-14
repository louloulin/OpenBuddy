import { create } from "zustand";
import { artifactsList, type ArtifactInfo } from "@/lib/agent-client";

/**
 * Per-session artifact index from the main process (20261115-ui U1.1).
 * Refreshed on `agent://artifacts` and when a session opens; `version` bumps
 * on every refresh so open previews reload.
 */
interface ArtifactsState {
  bySession: Record<string, { list: ArtifactInfo[]; version: number }>;
  refresh: (sessionId: string) => Promise<void>;
  drop: (sessionId: string) => void;
}

const EMPTY: ArtifactInfo[] = [];
const inflight = new Map<string, Promise<void>>();
const again = new Set<string>();

export const useArtifactsStore = create<ArtifactsState>((set, get) => ({
  bySession: {},
  refresh: (sessionId) => {
    // Coalesce bursts (several writes in a row): one request in flight, one queued.
    const running = inflight.get(sessionId);
    if (running) { again.add(sessionId); return running; }
    const task = (async () => {
      try {
        const list = await artifactsList(sessionId);
        const prev = get().bySession[sessionId];
        set({ bySession: { ...get().bySession, [sessionId]: { list, version: (prev?.version ?? 0) + 1 } } });
      } catch { /* session not loaded yet: keep what we had */ }
      finally {
        inflight.delete(sessionId);
        if (again.delete(sessionId)) void get().refresh(sessionId);
      }
    })();
    inflight.set(sessionId, task);
    return task;
  },
  drop: (sessionId) => {
    const next = { ...get().bySession };
    delete next[sessionId];
    set({ bySession: next });
  },
}));

export const selectArtifacts = (sessionId: string | null | undefined) => (s: ArtifactsState) => (sessionId ? s.bySession[sessionId]?.list ?? EMPTY : EMPTY);
export const selectArtifactsVersion = (sessionId: string | null | undefined) => (s: ArtifactsState) => (sessionId ? s.bySession[sessionId]?.version ?? 0 : 0);
