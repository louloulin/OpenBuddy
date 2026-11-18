import { create } from "zustand";

/** One pending annotation on a file quote, waiting for the next prompt (pii W1.9). */
export interface Annotation {
  id: number;
  path: string;
  /** Ready-to-send block: `关于 \`path\` 中的这段：` + quoted lines. */
  text: string;
}

export const EMPTY_ANNOTATIONS: Annotation[] = [];
let nextId = 1;

interface AnnotationState {
  bySession: Record<string, Annotation[]>;
  add: (sessionId: string, path: string, text: string) => void;
  remove: (sessionId: string, id: number) => void;
  clear: (sessionId: string) => void;
  /** Drain the tray; the caller sends the blocks with the next prompt. */
  take: (sessionId: string) => Annotation[];
  restore: (sessionId: string, annotations: Annotation[]) => void;
}

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  bySession: {},
  add: (sessionId, path, text) =>
    set((state) => ({
      bySession: { ...state.bySession, [sessionId]: [...(state.bySession[sessionId] ?? []), { id: nextId++, path, text }] },
    })),
  remove: (sessionId, id) =>
    set((state) => ({
      bySession: { ...state.bySession, [sessionId]: (state.bySession[sessionId] ?? []).filter((item) => item.id !== id) },
    })),
  clear: (sessionId) => set((state) => ({ bySession: { ...state.bySession, [sessionId]: [] } })),
  take: (sessionId) => {
    const current = get().bySession[sessionId] ?? EMPTY_ANNOTATIONS;
    set((state) => ({ bySession: { ...state.bySession, [sessionId]: [] } }));
    return current;
  },
  restore: (sessionId, annotations) =>
    set((state) => ({ bySession: { ...state.bySession, [sessionId]: [...annotations, ...(state.bySession[sessionId] ?? [])] } })),
}));
