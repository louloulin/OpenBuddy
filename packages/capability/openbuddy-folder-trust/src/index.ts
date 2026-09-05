import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface FolderTrustEntry {
  cwd: string;
  trusted: boolean;
  decidedAt: string;
}

export interface FolderTrustStore {
  list(): FolderTrustEntry[];
  isTrusted(cwd: string): boolean;
  grant(cwd: string): FolderTrustEntry;
  revoke(cwd: string): FolderTrustEntry;
  respond(cwd: string, trusted: boolean): FolderTrustEntry;
}

interface FolderTrustState {
  version: 1;
  entries: FolderTrustEntry[];
}

export class JsonFolderTrustStore implements FolderTrustStore {
  private entries: Map<string, FolderTrustEntry> = new Map();

  constructor(private readonly path: string) {
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as Partial<FolderTrustState>;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return;
      for (const entry of parsed.entries) {
        if (entry && typeof entry === "object" && typeof entry.cwd === "string" && typeof entry.trusted === "boolean") {
          this.entries.set(entry.cwd, { cwd: entry.cwd, trusted: entry.trusted, decidedAt: typeof entry.decidedAt === "string" ? entry.decidedAt : new Date().toISOString() });
        }
      }
    } catch {
      // Missing or invalid file → start empty.
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const state: FolderTrustState = { version: 1, entries: [...this.entries.values()] };
      writeFileSync(this.path, `${JSON.stringify(state)}\n`, "utf8");
    } catch {
      // Best-effort persistence.
    }
  }

  list(): FolderTrustEntry[] {
    return [...this.entries.values()];
  }

  isTrusted(cwd: string): boolean {
    return this.entries.get(cwd)?.trusted === true;
  }

  grant(cwd: string): FolderTrustEntry {
    const entry: FolderTrustEntry = { cwd, trusted: true, decidedAt: new Date().toISOString() };
    this.entries.set(cwd, entry);
    this.persist();
    return entry;
  }

  revoke(cwd: string): FolderTrustEntry {
    const entry: FolderTrustEntry = { cwd, trusted: false, decidedAt: new Date().toISOString() };
    this.entries.set(cwd, entry);
    this.persist();
    return entry;
  }

  respond(cwd: string, trusted: boolean): FolderTrustEntry {
    return trusted ? this.grant(cwd) : this.revoke(cwd);
  }
}

let store: FolderTrustStore | null = null;
let fallbackPath: string | null = null;

export function mountFolderTrust(options: { storagePath: string }): FolderTrustStore {
  fallbackPath = options.storagePath;
  store = new JsonFolderTrustStore(options.storagePath);
  return store;
}

export function getFolderTrustStore(): FolderTrustStore | null {
  if (!store && fallbackPath) store = new JsonFolderTrustStore(fallbackPath);
  return store;
}

export function setFolderTrustStore(instance: FolderTrustStore): void {
  store = instance;
}

export const folderTrustHandlers = {
  list: () => getFolderTrustStore()?.list() ?? [],
  isTrusted: (cwd: string) => getFolderTrustStore()?.isTrusted(cwd) ?? false,
  grant: (cwd: string) => {
    const store = getFolderTrustStore();
    if (!store) throw new Error("folder trust store is not mounted");
    return store.grant(cwd);
  },
  revoke: (cwd: string) => {
    const store = getFolderTrustStore();
    if (!store) throw new Error("folder trust store is not mounted");
    return store.revoke(cwd);
  },
  respond: (cwd: string, trusted: boolean) => {
    const store = getFolderTrustStore();
    if (!store) throw new Error("folder trust store is not mounted");
    return store.respond(cwd, trusted);
  },
};
