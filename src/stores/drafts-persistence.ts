/**
 * R2.4 — Per-session Composer draft persistence.
 *
 * Mirrors the in-memory `sessions-store.drafts` map to localStorage so
 * unsent text survives a renderer reload / app restart. Restores on store
 * initialization; writes debounced to avoid thrash during fast typing.
 */
import { useSessionsStore } from "./sessions-store";

const STORAGE_KEY = "openbuddy.drafts.v1";
const WRITE_DEBOUNCE_MS = 250;
const MAX_ENTRIES = 200;
const MAX_VALUE_BYTES = 64 * 1024;

function readStored(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function writeStored(drafts: Record<string, string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    // Bound the size so a runaway draft doesn't blow past the 5MB quota.
    // Drop the oldest entries (insertion order = key insertion order in JS
    // objects, which is deterministic enough for "anything is better than
    // throwing on quota exceeded").
    const keys = Object.keys(drafts);
    let toPersist: Record<string, string> = drafts;
    if (keys.length > MAX_ENTRIES) {
      toPersist = {};
      for (const k of keys.slice(-MAX_ENTRIES)) toPersist[k] = drafts[k];
    }
    // Skip writes that exceed per-entry cap; the in-memory copy still works.
    for (const k of Object.keys(toPersist)) {
      if (typeof toPersist[k] !== "string") {
        delete toPersist[k];
        continue;
      }
      if (toPersist[k].length > MAX_VALUE_BYTES) {
        delete toPersist[k];
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
  } catch (error) {
    // Quota or serialization error — drop silently. The in-memory draft is
    // still usable; we just won't survive a renderer reload.
    if (typeof console !== "undefined") {
      console.warn("[openbuddy] failed to persist drafts", error);
    }
  }
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let lastSerialized: string | null = null;

/** Schedule a debounced write — coalesces rapid typing into one localStorage hit. */
function scheduleWrite(drafts: Record<string, string>): void {
  if (typeof localStorage === "undefined") return;
  const serialized = JSON.stringify(drafts);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    writeStored(drafts);
  }, WRITE_DEBOUNCE_MS);
}

let unsubscribe: (() => void) | null = null;
let booted = false;
// P1-05: track the previous drafts reference so the subscriber can skip
// notifications about unrelated state changes (e.g. session list updates,
// plan state, etc.). Without this guard, every store mutation triggered
// scheduleWrite() which JSON-serialized the entire drafts map just to
// compare against lastSerialized. With it, we skip everything except
// actual drafts map mutations — typically a handful per minute while
// typing, vs. dozens per second otherwise.
let lastDraftsRef: Record<string, string> | null = null;

/**
 * Wire draft persistence. Reads existing drafts from localStorage and seeds
 * the store, then subscribes to changes and persists on every mutation.
 * Idempotent: subsequent calls return the existing disposer.
 */
export function bootDraftsPersistence(): () => void {
  if (booted) {
    return unsubscribe ?? (() => {});
  }
  booted = true;
  const stored = readStored();
  if (Object.keys(stored).length > 0) {
    useSessionsStore.setState((state) => {
      // Merge stored drafts over in-memory defaults — localStorage wins
      // because it survived the previous renderer.
      const drafts = { ...state.drafts, ...stored };
      return { drafts };
    });
  }
  unsubscribe = useSessionsStore.subscribe((state) => {
    // P1-05: skip notifications about state changes that don't touch drafts.
    // Reference equality is sufficient — the store always assigns a new
    // object to state.drafts when a draft is mutated, and the same object
    // is reused across unrelated state changes.
    if (state.drafts === lastDraftsRef) return;
    lastDraftsRef = state.drafts;
    scheduleWrite(state.drafts);
  });
  // Kick off an initial write so any drafts that existed before boot (e.g.
  // setDraft calls during module init that ran ahead of subscribe) end up
  // persisted. The debounce coalesces this with the seed read above.
  scheduleWrite(useSessionsStore.getState().drafts);
  // Flush any pending write on page unload so a fast quit doesn't lose the
  // most recent keystrokes.
  if (typeof window !== "undefined") {
    const flush = () => {
      if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
        writeStored(useSessionsStore.getState().drafts);
      }
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
  }
  return () => {
    unsubscribe?.();
    unsubscribe = null;
    booted = false;
  };
}

/** Test helper — wipe localStorage draft cache + reset module state. */
export function __resetDraftsPersistenceForTests(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  lastSerialized = null;
  if (unsubscribe) {
    try { unsubscribe(); } catch {}
    unsubscribe = null;
  }
  booted = false;
}