/**
 * Plugin state persistence — round-trip plugin enable/disable and config edits
 * across agent restarts.
 *
 * The store maps `id` → override (disabled flag + config patch). `composePatches`
 * merges these into a Harness `PluginPatch[][]` so callers can layer them on
 * top of the default profile via `HarnessPluginLoader.loadProfile()`.
 *
 * The default JSON adapter writes to `~/.pi/agent/openbuddy-plugins.json`
 * (configurable via `PluginStateStoreOptions.path`). The store is intentionally
 * synchronous-ish: callers pass a `read`/`write` adapter if they want atomic
 * file replacement (write-temp-then-rename) or remote storage.
 */
import type { PluginPatch } from "./index";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface PluginStateOverride {
  /** `true` → plugin disabled; `false` or missing → enabled. */
  disabled?: boolean;
  /** Pi extension enable flag; kept separate from Cordis's inverse `disabled`. */
  enabled?: boolean;
  /** Optional config patch merged into the entry's config. */
  config?: unknown;
}

export interface PluginStateSnapshot {
  /** ISO timestamp; lets the UI show "last edited" without a separate stat call. */
  updatedAt: string;
  /** Map from plugin id to override. Unknown ids are ignored at apply time. */
  overrides: Record<string, PluginStateOverride>;
  /** Pi Extension overrides share the same file but are applied by Pi's host. */
  piExtensions?: Record<string, PluginStateOverride>;
  /** Last plugin transaction whose runtime state was committed or restored. */
  commit?: PluginCommitMarker;
}

export interface PluginCommitMarker {
  generation: number;
  transactionId: string;
  kind: string;
  target: string;
  committedAt: string;
  rolledBack?: boolean;
  receipts?: Record<string, {
    surface: string;
    preparedAt: string;
    details?: Record<string, unknown>;
  }>;
}

export interface PluginStateStore {
  read(): Promise<PluginStateSnapshot | null>;
  write(snapshot: PluginStateSnapshot): Promise<void>;
  /** Compose stored overrides into Patch[][] for `HarnessPluginLoader.loadProfile`. */
  composePatches(): Promise<PluginPatch[][]>;
  /** Merge a new override for one plugin id; persists. */
  patch(id: string, override: PluginStateOverride): Promise<PluginStateSnapshot>;
  patchPiExtension(id: string, override: PluginStateOverride): Promise<PluginStateSnapshot>;
  /** Remove a stored override (reset to default behaviour); persists. */
  reset(id: string): Promise<PluginStateSnapshot>;
  resetPiExtension(id: string): Promise<PluginStateSnapshot>;
}

export interface PluginStateStoreOptions {
  /** Filesystem adapter — defaults to `~/.pi/agent/openbuddy-plugins.json`. */
  path?: string;
  /** Custom IO; pass for tests or non-default storage. */
  read?: () => Promise<PluginStateSnapshot | null>;
  write?: (snapshot: PluginStateSnapshot) => Promise<void>;
  /** Time source — defaults to `new Date().toISOString()`. */
  now?: () => string;
}

function defaultPath(): string {
  const agentHome = process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? process.env.HOME ?? homedir(), ".pi", "agent");
  return join(agentHome, "openbuddy-plugins.json");
}

function defaultRead(path: string): () => Promise<PluginStateSnapshot | null> {
  return async () => {
    try {
      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw) as PluginStateSnapshot;
      if (!parsed || typeof parsed !== "object" || !parsed.overrides) return null;
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
}

function defaultWrite(path: string): (snapshot: PluginStateSnapshot) => Promise<void> {
  return async (snapshot) => {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf-8");
    await rename(tmp, path);
  };
}

/** Construct a plugin-state store backed by the default JSON file. */
export function createPluginStateStore(options: PluginStateStoreOptions = {}): PluginStateStore {
  const path = options.path ?? defaultPath();
  const read = options.read ?? defaultRead(path);
  const write = options.write ?? defaultWrite(path);
  const now = options.now ?? (() => new Date().toISOString());

  async function load(): Promise<PluginStateSnapshot> {
    const existing = await read();
    if (existing && existing.overrides) return existing;
    return { updatedAt: now(), overrides: {}, piExtensions: {} };
  }

  return {
    async read() {
      return read();
    },
    async write(snapshot) {
      await write({ ...snapshot, updatedAt: now() });
    },
    async composePatches() {
      const snapshot = await load();
      const patches: PluginPatch[] = [];
      for (const [id, override] of Object.entries(snapshot.overrides)) {
        const patch: PluginPatch = { id };
        if (override.disabled !== undefined) patch.disabled = override.disabled;
        if (override.config !== undefined) patch.config = override.config;
        if (Object.keys(patch).length > 1) patches.push(patch);
      }
      return patches.length ? [patches] : [];
    },
    async patch(id, override) {
      const snapshot = await load();
      const next: PluginStateSnapshot = {
        updatedAt: now(),
        overrides: { ...snapshot.overrides, [id]: { ...snapshot.overrides[id], ...override } },
        piExtensions: snapshot.piExtensions,
        commit: snapshot.commit,
      };
      await write(next);
      return next;
    },
    async patchPiExtension(id, override) {
      const snapshot = await load();
      const next: PluginStateSnapshot = {
        updatedAt: now(),
        overrides: snapshot.overrides,
        piExtensions: { ...(snapshot.piExtensions ?? {}), [id]: { ...snapshot.piExtensions?.[id], ...override } },
        commit: snapshot.commit,
      };
      await write(next);
      return next;
    },
    async reset(id) {
      const snapshot = await load();
      const overrides = { ...snapshot.overrides };
      delete overrides[id];
      const next: PluginStateSnapshot = { updatedAt: now(), overrides };
      next.piExtensions = snapshot.piExtensions;
      next.commit = snapshot.commit;
      await write(next);
      return next;
    },
    async resetPiExtension(id) {
      const snapshot = await load();
      const piExtensions = { ...(snapshot.piExtensions ?? {}) };
      delete piExtensions[id];
      const next: PluginStateSnapshot = { updatedAt: now(), overrides: snapshot.overrides, piExtensions, commit: snapshot.commit };
      await write(next);
      return next;
    },
  };
}
