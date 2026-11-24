import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { realpath, unlink } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { modelKey } from "@openbuddy/services/providers/providers";
import type { SessionSearchHit } from "@openbuddy/protocol/search";
import type { EngineContext } from "./engine-context.js";
import type { IndexedSession } from "./session-search.js";
import { deriveTitle } from "./titles.js";
import type { SessionRunStatus, Slot } from "./types.js";

export function invalidateList(engine: EngineContext) {
  engine.listCache = undefined;
}
export function ensureTitle(engine: EngineContext, slot: Slot, text: string) {
  // 子代理 (W3.4) are in-memory children: no sidebar title, no agent://summary entry.
  if (slot.subagent) return;
  const meta = engine.settings.config.read().sessions[slot.id];
  if (meta?.title || slot.session.sessionName) return;
  const title = deriveTitle(text);
  if (!title) return;
  engine.metadata(slot.id, { title });
  engine.emit("agent://summary", { sessionId: slot.id, title });
}
export async function all(engine: EngineContext) {
  const now = Date.now();
  if (!engine.listCache || now - engine.listCache.at > 1500)
    engine.listCache = { at: now, items: SessionManager.listAll(engine.sessionDir) };
  return engine.listCache.items;
}
export async function resolve(engine: EngineContext, id: string, cwd?: string): Promise<SessionInfo> {
  const canonicalCwd = cwd ? await engine.validCwd(cwd) : undefined;
  engine.invalidateList();
  const item = (await engine.all()).find(
    (s) => s.id === id && (!canonicalCwd || s.cwd === canonicalCwd),
  );
  if (!item) throw Error("会话不存在");
  const actual = await realpath(item.path),
    root = await realpath(engine.sessionDir),
    rel = relative(root, actual);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw Error("会话路径越界");
  return { ...item, path: actual };
}
export function savedModel(engine: EngineContext, item: SessionInfo) {
  const mtime = item.modified.getTime();
  const cached = engine.modelCache.get(item.path);
  if (cached && cached.mtime === mtime) return cached.model;
  const model = SessionManager.open(item.path, engine.sessionDir).buildSessionContext().model;
  const value = model ? { provider: model.provider, modelId: model.modelId } : undefined;
  engine.modelCache.set(item.path, { mtime, model: value });
  return value;
}
export async function list(engine: EngineContext, cwd: string, includeArchived = false) {
  cwd = await engine.validCwd(cwd);
  const meta = engine.settings.config.read().sessions,
    items = (await engine.all()).filter((s) => s.cwd === cwd);
  const result = items
    .filter((s) => includeArchived || !meta[s.id]?.archived)
    .map((s) => {
      const savedModel = engine.savedModel(s);
      const slot = engine.slots.get(s.id);
      return {
        sessionId: s.id,
        title: meta[s.id]?.title ?? s.name ?? deriveTitle(s.firstMessage ?? "") ?? "新任务",
        updatedAt: s.modified.toISOString(),
        cwd: s.cwd,
        pinned: meta[s.id]?.pinned ?? false,
        archived: meta[s.id]?.archived ?? false,
        currentModelId: savedModel?.modelId,
        currentProviderId: savedModel?.provider,
        currentModelKey: savedModel
          ? modelKey(savedModel.provider, savedModel.modelId)
          : undefined,
        status: listStatus(engine.runStatus(slot)),
      };
    });
  // Sessions created in this run are not on disk until their first exchange. 子代理 (W3.4) are
  // in-memory children owned by their parent: they never become sidebar entries.
  for (const slot of engine.slots.values()) {
    if (slot.subagent || slot.hidden) continue;
    if (slot.session.sessionManager.getCwd() !== cwd || result.some((s) => s.sessionId === slot.id)) continue;
    if (!slot.busy && !meta[slot.id]?.title) continue;
    const model = slot.session.model;
    result.unshift({
      sessionId: slot.id,
      title: meta[slot.id]?.title ?? "新任务",
      updatedAt: new Date(slot.lastActive).toISOString(),
      cwd,
      pinned: meta[slot.id]?.pinned ?? false,
      archived: meta[slot.id]?.archived ?? false,
      currentModelId: model?.id,
      currentProviderId: model?.provider,
      currentModelKey: model ? modelKey(model.provider, model.id) : undefined,
      status: listStatus(engine.runStatus(slot)),
    });
  }
  return result;
}
export async function rename(engine: EngineContext, id: string, title: string) {
  const slot = engine.slots.get(id);
  if (slot) slot.session.setSessionName(title);
  else {
    const item = await engine.resolve(id);
    SessionManager.open(item.path, engine.sessionDir).appendSessionInfo(title);
  }
  engine.metadata(id, { title });
  engine.invalidateList();
  engine.emit("agent://summary", { sessionId: id, title });
}
export function metadata(
  engine: EngineContext,
  id: string,
  patch: {
    title?: string;
    pinned?: boolean;
    archived?: boolean;
    /** 交接到新任务 (W1.7). */
    handoffFrom?: { sessionId: string; title?: string } | null;
  },
) {
  const c = engine.settings.config.read();
  const next: NonNullable<(typeof c.sessions)[string]> = { ...c.sessions[id] };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.pinned !== undefined) next.pinned = patch.pinned;
  if (patch.archived !== undefined) next.archived = patch.archived;
  // `handoffFrom: null` clears the banner; do not persist a nullable field.
  if (patch.handoffFrom === null) delete next.handoffFrom;
  else if (patch.handoffFrom !== undefined) next.handoffFrom = patch.handoffFrom;
  c.sessions[id] = next;
  engine.settings.config.write(c);
}
export async function deleteSession(engine: EngineContext, id: string) {
  engine.lost = engine.lost.filter((entry) => entry.id !== id);
  const slot = engine.slots.get(id);
  const file = slot
    ? slot.session.sessionManager.getSessionFile()
    : (await engine.resolve(id)).path;
  if (slot) await engine.close(id);
  if (file) {
    try {
      await unlink(file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  const c = engine.settings.config.read();
  delete c.sessions[id];
  engine.settings.config.write(c);
  engine.invalidateList();
}
/**
 * `session_search` (pii W1.4): every saved session whose title or messages contain all the
 * terms. The index (session-search.ts) holds each file's message text and re-reads only changed files.
 */
export async function search(
  engine: EngineContext,
  query: string,
  options: { cwd?: string; limit?: number } = {},
): Promise<SessionSearchHit[]> {
  const cwd = options.cwd ? await engine.validCwd(options.cwd) : undefined;
  const meta = engine.settings.config.read().sessions;
  const title = (s: IndexedSession) => meta[s.id]?.title ?? s.name ?? deriveTitle(s.firstMessage ?? "") ?? "新任务";
  const results = await engine.searchIndex.search(query, { cwd, limit: options.limit, title });
  return results.map(({ session, ...hit }) => ({
    sessionId: session.id,
    cwd: session.cwd,
    title: title(session),
    ...hit,
    updatedAt: session.modified.toISOString(),
    archived: meta[session.id]?.archived ?? false,
  }));
}
function listStatus(status: SessionRunStatus) {
  return status === "running" ? "working" : status === "failed" ? "failed" : "completed";
}
