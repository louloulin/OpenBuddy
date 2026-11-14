import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile, utimes } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/**
 * File checkpoints (20261115-ui §5.6): the content of a file right before the
 * agent (or the user, from the artifact panel) changes it, and right after.
 * Pi only rewinds the conversation; this is what lets files be restored too.
 * Content-addressed blobs + one index per session under `<root>/<sessionId>/`.
 */
export interface CheckpointRecord {
  id: string;
  toolCallId?: string;
  path: string;
  /** sha256 of the content before; null = the file did not exist. */
  before: string | null;
  /** sha256 of the content after; null = the file is gone. */
  after: string | null;
  at: number;
  /** apply: a code block from an answer written with 「应用」 (20261115-ui U1.7). */
  source: "tool" | "user" | "restore" | "apply";
  skipped?: "too_large";
}

export interface RevertResult {
  restored: string[];
  conflicts: { path: string; reason: "changed_since" | "missing_snapshot" }[];
}

const MAX_FILE = 20 * 1024 * 1024;
const QUOTA = 500 * 1024 * 1024;
const TRACKED = new Set(["write", "edit"]);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export class CheckpointStore {
  /** One load per session even when parallel tool calls finish together (a second load would replace the array and drop records). */
  private indexes = new Map<string, Promise<CheckpointRecord[]>>();
  /** Index writes are serialized per session. */
  private writes = new Map<string, Promise<void>>();
  /** Snapshots taken in `tool_call`, committed at `tool_execution_end`. */
  private pending = new Map<string, { sessionId: string; record: CheckpointRecord }>();

  constructor(
    private root: string,
    private trash: (path: string) => Promise<void>,
    private limits = { maxFile: MAX_FILE, quota: QUOTA },
  ) {}

  /** Never blocks: snapshots the target of write/edit before it runs. Register after the permission gate. */
  extension(sessionId: string, cwd: () => string): ExtensionFactory {
    return (pi) => {
      pi.on("tool_call", async (event) => {
        if (!TRACKED.has(event.toolName)) return undefined;
        const input = (event.input ?? {}) as Record<string, unknown>;
        const raw = typeof input.path === "string" ? input.path : typeof input.file_path === "string" ? input.file_path : undefined;
        if (!raw) return undefined;
        const path = isAbsolute(raw) ? raw : resolve(cwd(), raw);
        try { await this.begin(sessionId, event.toolCallId, path); } catch { /* a failed snapshot must never block the tool */ }
        return undefined;
      });
    };
  }

  async begin(sessionId: string, toolCallId: string, path: string, source: CheckpointRecord["source"] = "tool") {
    const snap = await this.capture(sessionId, path);
    this.pending.set(toolCallId, {
      sessionId,
      record: { id: randomUUID(), toolCallId: source === "tool" ? toolCallId : undefined, path, before: snap.hash, after: null, at: Date.now(), source, ...(snap.skipped ? { skipped: snap.skipped } : {}) },
    });
  }

  /** Commit a pending snapshot once the tool finished. Unchanged files leave no record. */
  async finish(toolCallId: string): Promise<CheckpointRecord | undefined> {
    const entry = this.pending.get(toolCallId);
    if (!entry) return undefined;
    this.pending.delete(toolCallId);
    const { sessionId, record } = entry;
    const now = await this.capture(sessionId, record.path);
    if (!record.skipped && now.hash === record.before) return undefined;
    const done: CheckpointRecord = { ...record, after: now.hash, at: Date.now(), ...(now.skipped ? { skipped: now.skipped } : {}) };
    const index = await this.index(sessionId);
    index.push(done);
    await this.persist(sessionId);
    void this.enforceQuota().catch(() => {});
    return done;
  }

  /** Drop a pending snapshot (the call was blocked or never ran). */
  discard(toolCallId: string) { this.pending.delete(toolCallId); }

  async list(sessionId: string, path?: string): Promise<CheckpointRecord[]> {
    const index = await this.index(sessionId);
    return path ? index.filter((r) => r.path === path) : [...index];
  }

  async read(sessionId: string, hash: string): Promise<{ text?: string; binary: boolean; size: number }> {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("invalid_payload: hash");
    const bytes = await readFile(join(this.dir(sessionId), "blobs", hash));
    const binary = bytes.subarray(0, 8000).includes(0);
    return binary ? { binary, size: bytes.length } : { text: bytes.toString("utf8"), binary, size: bytes.length };
  }

  /** User edit from the panel: snapshot, write, snapshot. */
  async userSave(sessionId: string, path: string, content: string, source: "user" | "apply" = "user"): Promise<void> {
    const id = `${source}:${randomUUID()}`;
    await this.begin(sessionId, id, path, source);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    await this.finish(id);
  }

  private persist(sessionId: string): Promise<void> {
    const loaded = this.indexes.get(sessionId);
    if (!loaded) return Promise.resolve();
    const run = (this.writes.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const index = await loaded;
      await mkdir(this.dir(sessionId), { recursive: true });
      await writeFile(join(this.dir(sessionId), "index.json"), JSON.stringify(index));
    });
    this.writes.set(sessionId, run);
    return run;
  }

  /** Put a file back to a snapshot (null = it did not exist: move it to the trash). The current content is kept first. */
  async restore(sessionId: string, path: string, hash: string | null): Promise<void> {
    const id = `restore:${randomUUID()}`;
    await this.begin(sessionId, id, path, "restore");
    if (hash === null) {
      try { await stat(path); await this.trash(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    } else {
      const bytes = await readFile(join(this.dir(sessionId), "blobs", hash));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    }
    await this.finish(id);
  }

  /** Undo what the given tool calls did to files, oldest state first; detect later edits. */
  async revert(sessionId: string, toolCallIds: string[], opts: { skip?: string[]; force?: boolean } = {}): Promise<RevertResult> {
    const ids = new Set(toolCallIds);
    const records = (await this.index(sessionId)).filter((r) => r.source === "tool" && r.toolCallId && ids.has(r.toolCallId)).sort((a, b) => a.at - b.at);
    const byPath = new Map<string, CheckpointRecord[]>();
    for (const r of records) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r]);
    const result: RevertResult = { restored: [], conflicts: [] };
    for (const [path, list] of byPath) {
      if (opts.skip?.includes(path)) continue;
      const first = list[0];
      const last = list[list.length - 1];
      if (first.skipped || list.some((r) => r.skipped)) { result.conflicts.push({ path, reason: "missing_snapshot" }); continue; }
      const current = (await this.capture(sessionId, path, false)).hash;
      if (!opts.force && current !== last.after) { result.conflicts.push({ path, reason: "changed_since" }); continue; }
      await this.restore(sessionId, path, first.before);
      result.restored.push(path);
    }
    return result;
  }

  private dir(sessionId: string) {
    if (!/^[\w.-]+$/.test(sessionId)) throw Error("invalid_payload: sessionId");
    return join(this.root, sessionId);
  }

  private index(sessionId: string): Promise<CheckpointRecord[]> {
    const cached = this.indexes.get(sessionId);
    if (cached) return cached;
    const dir = this.dir(sessionId);
    const load = readFile(join(dir, "index.json"), "utf8").then((text) => JSON.parse(text) as CheckpointRecord[], () => [] as CheckpointRecord[]);
    this.indexes.set(sessionId, load);
    return load;
  }

  /** Hash (and store) the current content; null when the file does not exist. */
  private async capture(sessionId: string, path: string, store = true): Promise<{ hash: string | null; skipped?: "too_large" }> {
    let info;
    try { info = await stat(path); } catch { return { hash: null }; }
    if (!info.isFile()) return { hash: null };
    if (info.size > this.limits.maxFile) return { hash: `size:${info.size}:${info.mtimeMs}`, skipped: "too_large" };
    const bytes = await readFile(path);
    const hash = sha(bytes);
    if (store) {
      const blob = join(this.dir(sessionId), "blobs", hash);
      try { await stat(blob); } catch {
        await mkdir(dirname(blob), { recursive: true });
        await writeFile(blob, bytes);
      }
      const now = new Date();
      await utimes(this.dir(sessionId), now, now).catch(() => {});
    }
    return { hash };
  }

  /** Keep the store under the quota by dropping least-recently-used sessions. */
  async enforceQuota() {
    let sessions: { dir: string; id: string; size: number; used: number }[] = [];
    try {
      for (const id of await readdir(this.root)) {
        const dir = join(this.root, id);
        let size = 0;
        try { for (const f of await readdir(join(dir, "blobs"))) size += (await stat(join(dir, "blobs", f))).size; } catch { /* empty */ }
        sessions.push({ dir, id, size, used: (await stat(dir)).mtimeMs });
      }
    } catch { return; }
    let total = sessions.reduce((n, s) => n + s.size, 0);
    sessions = sessions.sort((a, b) => a.used - b.used);
    while (total > this.limits.quota && sessions.length > 1) {
      const victim = sessions.shift()!;
      await rm(victim.dir, { recursive: true, force: true });
      this.indexes.delete(victim.id);
      total -= victim.size;
    }
  }
}
