/**
 * host-modules/session-metadata.ts — session list + JSON-mirror metadata.
 *
 * Phase 8.3 Batch C: 从 agent-host.ts 抽出 session metadata 维护的 6 个函数 +
 * JSON mirror (~150 行):
 *   - listSessions (line 4449) — already exported; re-exported through wrapper
 *   - updateSessionMetadata (line 4509) — write fn used by other ops
 *   - clearSessionMetadata (line 4534) — nuclear reset
 *   - setSessionArchived (line 4585) — single session archive flag
 *   - setAllArchived (line 4601) — bulk archive/unarchive (R2.5)
 *   - setSessionExpert (line 4630) — assign / clear expert persona
 *
 * Phase 8.3 P0 perf: the original `SessionManager.list / .listAll / .open().getEntries()`
 * pipeline read every JSONL line via readline + JSON.parse, then concatenated every
 * message text via `allMessages.join(" ")`. With 1146 files (54 MB) on this dev box
 * that produced ~140 % main-process CPU. Replaced with a lightweight scanner
 * (`peekSessionHeader` / `peekSubagentMode`) using fs.open + fs.read with fixed
 * buffers (no readline, no per-line JSON.parse). `listSessions` is cached for 5 s
 * and `listAllPiSessions` for 30 s with single-flight coalescing so the
 * App.tsx:937 debounced effect doesn't stampede the disk.
 *
 * 设计:
 *   - state / listAllPiSessions / workspaceRegistry 通过环形 import 自
 *     ../agent-host 注入 (workspaceRegistry 来自 workbench-scope.ts, 也是
 *     agent-host.ts 重新 export)
 *   - emitPluginEvent 同样从 agent-host 环形 import
 *   - JSON mirror 用 piHome() 路径, 也从 agent-host 拿
 *   - sessionBaselines / sessionProjectionBaseline (line 4745+) 留在
 *     agent-host.ts, 它们还要被 plugin-state (Batch D) 用, 那里再决定是否
 *     搬走
 */
import { readdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { SessionMetadataStore, type SessionMetadataSnapshot } from "./session-metadata-store";

// Phase 8.3 Architectural Refactor — Install Pattern:
//   修复前: `import { emitPluginEvent, listAllPiSessions, piHome, piSessionDir, state, workspaceRegistry } from "../agent-host"` (reverse dep)
//   修复后: 通过 installSessionMetadata() 一次性注入, 本模块零 agent-host 导入.
//   listAllPiSessions / piSessionDir 来自 _state-shape (types) 或 _host-paths (runtime).
import { cachedListSessions, invalidateSessionsCache } from "./_cache";
import { createDefaultAgentHostState } from "./_default-state";
import { type AgentHostState } from "./_state-shape";

// Vite/Rollup ESM disambiguation fix (piHome$1 is not a function):
// 之前 import piHome from _host-paths 但不调用, 只存为 module-level let, 然后在
// install 时被覆盖. 问题是 vite/rollup 编译时给不同 import path 加 $N 后缀, 一些
// 路径在 tree-shake 后没 resolve 到 export, 编译产物里 `let piHome$1;` 是
// undefined, 调用时 throw. 修复: 给所有 module-level let 默认 inline lambda,
// 既不需要 install 也能工作, install 后会被覆盖.
let state: AgentHostState = createDefaultAgentHostState();
let piHome: () => string = () => process.env.PI_CODING_AGENT_DIR ?? process.env.PI_HOME ?? join(homedir(), ".pi", "agent");
let piSessionDir: (cwd: string) => string = (cwd) => "";
let emitPluginEvent: (type: string, payload: unknown) => void = () => undefined;
let listAllPiSessions: <T = unknown>() => any = async () => [];
let workspaceRegistry: () => unknown = () => undefined;
let metadataStore = new SessionMetadataStore();

/**
 * Bind session-metadata dependencies. Called once from
 * agent-host.ts:initialize(). Idempotent.
 */
export function installSessionMetadata(deps: {
  state: AgentHostState;
  piHome: () => string;
  piSessionDir: (cwd: string) => string;
  emitPluginEvent: (type: string, payload: unknown) => void;
  listAllPiSessions: () => Promise<unknown>;
  workspaceRegistry: () => unknown;
}): void {
  if (deps.state) state = deps.state;
  if (deps.piHome) piHome = deps.piHome;
  if (deps.piSessionDir) piSessionDir = deps.piSessionDir;
  if (deps.emitPluginEvent) emitPluginEvent = deps.emitPluginEvent;
  listAllPiSessions = deps.listAllPiSessions as any;
  if (deps.workspaceRegistry) workspaceRegistry = deps.workspaceRegistry;
  metadataStore = new SessionMetadataStore({
    databasePath: join(deps.piHome(), "openbuddy.sqlite"),
    legacyJsonPath: join(deps.piHome(), "openbuddy-state.json"),
  });
}

// ---------------------------------------------------------------------------
// P0 perf scanner — replaces SessionManager.list / .listAll / .open().getEntries()
// in the listing path. No readline, no per-line JSON.parse, no allMessages.join.
// ---------------------------------------------------------------------------

/** Summary shape returned by peekSessionHeader. Matches the fields of
 *  pi-coding-agent's `SessionInfo` that OpenBuddy's listing actually uses. */
export interface SessionHeaderSummary {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
}

/** Read the whole file when small enough, otherwise peek head + tail. */
const PEEK_MAX_BYTES = 4 * 1024 * 1024; // 4 MB cap per file
const PEEK_HEAD_BYTES = 2 * 1024 * 1024; // 2 MB head peek
const PEEK_TAIL_BYTES = 64 * 1024; // 64 KB tail peek
const SUBAGENT_PEEK_BYTES = 256 * 1024; // 256 KB — marker usually appears near start
const SCAN_CONCURRENCY = 10; // matches MAX_CONCURRENT_SESSION_INFO_LOADS in pi-coding-agent

/** Cheap scan of one JSONL file. Returns null on missing/corrupt header. */
export async function peekSessionHeader(filePath: string): Promise<SessionHeaderSummary | null> {
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(filePath, "r");
    const fileStat = await fh.stat();
    const size = fileStat.size;
    const mtime = fileStat.mtime;
    if (size === 0) return null;

    let text: string;
    let truncated = false;
    if (size <= PEEK_MAX_BYTES) {
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, 0);
      text = buf.toString("utf8");
    } else {
      truncated = true;
      const headBuf = Buffer.alloc(PEEK_HEAD_BYTES);
      await fh.read(headBuf, 0, PEEK_HEAD_BYTES, 0);
      const tailBuf = Buffer.alloc(PEEK_TAIL_BYTES);
      await fh.read(tailBuf, 0, PEEK_TAIL_BYTES, size - PEEK_TAIL_BYTES);
      // Bridge with a newline so the last head line and first tail line stay separate.
      text = headBuf.toString("utf8") + "\n" + tailBuf.toString("utf8");
    }
    return parseHeaderText(text, filePath, mtime, truncated);
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => undefined);
  }
}

/** Walk lines and extract header / name / first user message / message count.
 *  Cheap: only JSON.parse the header line, the session_info line with a name,
 *  and the first user-role message line. All other message lines are counted
 *  via a substring match. */
function parseHeaderText(text: string, filePath: string, mtime: Date, truncated: boolean): SessionHeaderSummary | null {
  let header: { type?: string; id?: string; cwd?: string; parentSession?: string; timestamp?: string } | null = null;
  let name: string | undefined;
  let firstMessage = "";
  let messageCount = 0;
  let lineStart = 0;

  while (lineStart <= text.length) {
    const nl = text.indexOf("\n", lineStart);
    const lineEnd = nl === -1 ? text.length : nl;
    let line = text.slice(lineStart, lineEnd);
    if (line.endsWith("\r")) line = line.slice(0, -1);

    if (line.length > 0) {
      if (!header) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type !== "session") return null;
          header = parsed;
        } catch {
          return null;
        }
      } else {
        // Cheap substring gates before any JSON.parse
        if (line.indexOf("session_info") !== -1) {
          try {
            const entry = JSON.parse(line);
            if (entry && entry.type === "session_info") {
              const raw = typeof entry.name === "string" ? entry.name.trim() : "";
              if (raw) name = raw;
            }
          } catch {
            /* skip malformed line */
          }
        } else if (line.indexOf('"type":"message"') !== -1 || line.indexOf('"type": "message"') !== -1) {
          messageCount += 1;
          if (!firstMessage && (line.indexOf('"role":"user"') !== -1 || line.indexOf('"role": "user"') !== -1)) {
            try {
              const entry = JSON.parse(line);
              const text2 = extractFirstUserText(entry?.message);
              if (text2) firstMessage = text2;
            } catch {
              /* skip malformed line */
            }
          }
        }
      }
    }

    if (nl === -1) break;
    lineStart = nl + 1;
  }

  if (!header || !header.id) return null;

  const headerTs = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN;
  const created = Number.isNaN(headerTs) ? mtime : new Date(headerTs);

  return {
    path: filePath,
    id: header.id,
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    name,
    parentSessionPath: header.parentSession,
    created,
    modified: mtime,
    // When the file was truncated and we found no message in the head peek,
    // assume the file has at least one message (rare edge case for huge files).
    messageCount: truncated && messageCount === 0 ? 1 : messageCount,
    firstMessage: firstMessage || "(no messages)",
  };
}

/** Mirror of pi-coding-agent's extractTextContent (not exported from the package). */
function extractFirstUserText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as { role?: unknown; content?: unknown };
  if (typeof m.role !== "string") return "";
  const content = m.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
      const t = (block as { text?: unknown }).text;
      if (typeof t === "string") parts.push(t);
    }
  }
  return parts.join(" ");
}

/** Read first ~256 KB of a session file and look for an openbuddy/subagent custom
 *  entry. Returns "continuable" only when the marker explicitly carries that mode.
 *  Anything missing or unparseable falls back to "one-shot", matching the original
 *  SessionManager.open().getEntries().find(...) behavior. */
export async function peekSubagentMode(filePath: string): Promise<"one-shot" | "continuable"> {
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(filePath, "r");
    const fileStat = await fh.stat();
    const size = fileStat.size;
    if (size === 0) return "one-shot";

    const peekSize = Math.min(size, SUBAGENT_PEEK_BYTES);
    const buf = Buffer.alloc(peekSize);
    await fh.read(buf, 0, peekSize, 0);
    const text = buf.toString("utf8");

    const markerIdx = text.indexOf("openbuddy/subagent");
    if (markerIdx === -1) return "one-shot";

    // Find the surrounding JSON object — walk back to the previous '{' on the line.
    const openIdx = text.lastIndexOf("{", markerIdx);
    if (openIdx === -1) return "one-shot";
    const lineStart = text.lastIndexOf("\n", openIdx) + 1;
    const nlIdx = text.indexOf("\n", markerIdx);
    const lineEnd = nlIdx === -1 ? text.length : nlIdx;
    const line = text.slice(lineStart, lineEnd);

    try {
      const entry = JSON.parse(line);
      if (entry && entry.type === "custom" && entry.customType === "openbuddy/subagent") {
        const data = entry.data && typeof entry.data === "object" ? entry.data : null;
        return data && data.mode === "continuable" ? "continuable" : "one-shot";
      }
    } catch {
      /* fall through to one-shot */
    }
    return "one-shot";
  } catch {
    return "one-shot";
  } finally {
    if (fh) await fh.close().catch(() => undefined);
  }
}

/** Scan a single directory of .jsonl files with bounded concurrency. */
export async function scanSessionDir(dir: string): Promise<SessionHeaderSummary[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(dir, entry.name));

  if (files.length === 0) return [];
  const results: (SessionHeaderSummary | null)[] = new Array(files.length).fill(null);
  const inFlight = new Set<Promise<void>>();
  let nextIndex = 0;

  const startNext = (): void => {
    const index = nextIndex++;
    if (index >= files.length) return;
    const file = files[index];
    const task = peekSessionHeader(file)
      .then((info) => {
        results[index] = info;
      })
      .catch(() => {
        results[index] = null;
      })
      .finally(() => {
        inFlight.delete(task);
      });
    inFlight.add(task);
  };

  while (nextIndex < files.length || inFlight.size > 0) {
    while (nextIndex < files.length && inFlight.size < SCAN_CONCURRENCY) {
      startNext();
    }
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }
  return results.filter((entry): entry is SessionHeaderSummary => entry !== null);
}

// ---------------------------------------------------------------------------
// Public listSessions
// ---------------------------------------------------------------------------

export async function listSessions(cwd: string) {
  return cachedListSessions(cwd, () => loadSessionsImpl(cwd));
}

async function loadSessionsImpl(cwd: string) {
  const metadata = await metadataStore.snapshot();
  const pinned = new Set(metadata.pinned);
  const archived = new Set(metadata.archived);
  const registryArchived = new Set((state.context?.get("workspaceRegistry") as { archivedSessionIds?: readonly string[] } | undefined)?.archivedSessionIds ?? []);
  const scopedSessions = await scanSessionDir(piSessionDir(cwd));
  const allSessions = await listAllPiSessions();
  const sessions = [...new Map([
    ...scopedSessions,
    ...allSessions.filter((entry: any) => resolve(entry.cwd ?? cwd) === resolve(cwd)),
  ].map((entry: any) => [entry.path, entry])).values()];
  const idsByPath = new Map(allSessions.map((entry: any) => [entry.path, entry.id]));
  const childModes = new Map<string, "one-shot" | "continuable">();
  for (const entry of allSessions) {
    if (!entry.parentSessionPath) continue;
    // Use the lightweight peek (fs.open + small fs.read) instead of
    // SessionManager.open(path).getEntries(), which parsed the entire file.
    const mode = await peekSubagentMode(entry.path);
    childModes.set(entry.id, mode);
  }
  // R2.5 — surface archived sessions too. The previous implementation dropped
  // them entirely, which made historical sessions invisible once any cleanup
  // pass or accidental bulk archive marked them as archived. Returning the
  // `archived: true` flag lets the sidebar render a dedicated "已归档" group
  // with a one-click 恢复 action instead of forcing the user to hand-edit
  // ~/.pi/openbuddy-state.json.
  //
  // registryArchived (DeepSeek workspace registry) is still honoured: it's
  // an intentional "removed from this workspace" tombstone and shouldn't be
  // resurfaced here.
  // Drop zero-message shells (created by an unsent 新建任务 click) so the
  // sidebar doesn't fill with untitled "OpenBuddy" rows. The currently loaded
  // session stays visible even when empty — it was just created and will get
  // its first message imminently.
  const currentSessionId = state.session?.sessionId;
  return sessions.filter((entry: any) => !registryArchived.has(entry.id))
    .filter((entry: any) => entry.messageCount > 0 || entry.id === currentSessionId)
    .map((entry: any) => {
    const expert = metadata.experts[entry.id];
    return {
      sessionId: entry.id,
      title: entry.name ?? (entry.firstMessage || "Pi 会话").slice(0, 80),
      updatedAt: entry.modified.toISOString(),
      cwd: entry.cwd || cwd,
      pinned: pinned.has(entry.id),
      archived: archived.has(entry.id),
      ...(expert ? { expertId: expert.expertId, expertName: expert.expertName, ...(expert.avatarLocal ? { expertAvatar: expert.avatarLocal } : {}) } : {}),
      ...(entry.parentSessionPath && idsByPath.get(entry.parentSessionPath)
        ? { parentSessionId: idsByPath.get(entry.parentSessionPath), origin: "subagent" as const, subagentMode: childModes.get(entry.id) ?? "one-shot" as const }
        : {}),
    };
  }).sort((a, b) => {
    // Archived sessions sink to the bottom so the live list stays scannable;
    // within each tier, pinned first then most-recently-active.
    const archivedRank = Number(!!a.archived) - Number(!!b.archived);
    if (archivedRank !== 0) return archivedRank;
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
}

async function updateSessionMetadata(
  sessionId: string,
  update: (metadata: SessionMetadataSnapshot) => void,
): Promise<void> {
  await metadataStore.updateMetadata(update);
  if (state.session?.sessionId === sessionId) {
    emitPluginEvent("session/metadata-updated", { sessionId });
  }
  // P0: drop the cached list so the next listSessions / listAllPiSessions sees
  // the metadata change immediately instead of after the TTL window.
  invalidateSessionsCache();
}

async function clearSessionMetadata(): Promise<void> {
  await metadataStore.clearAll();
  emitPluginEvent("session/metadata-cleared", {});
  invalidateSessionsCache();
}

async function setSessionArchived(sessionId: string, archived: boolean): Promise<boolean> {
  const sessions = await listAllPiSessions();
  if (!sessions.some((entry: any) => entry.id === sessionId)) throw new Error(`Pi session not found: ${sessionId}`);
  await updateSessionMetadata(sessionId, (metadata) => {
    metadata.archived = metadata.archived.filter((id: string) => id !== sessionId);
    if (archived) metadata.archived.push(sessionId);
  });
  const registry: any = workspaceRegistry();
  if (registry) await registry.archiveSession(sessionId, archived);
  return archived;
}

// R2.5 — bulk archive/unarchive. Updates the legacy JSON mirror in a single
// read-modify-write cycle and also forwards each id to the workspace registry
// so DeepSeek-style workspace tombstones stay in sync. With 70+ archived
// sessions on a fresh install this turns a 70-click recovery into one click.
async function setAllArchived(archived: boolean): Promise<{ updated: number }> {
  const sessions = await listAllPiSessions();
  const knownIds = new Set<string>(sessions.map((entry: any) => entry.id));
  const result = { updated: 0 };
  await updateSessionMetadata("__bulk__", (metadata) => {
    const beforeSet = new Set(metadata.archived);
    if (archived) {
      // Archive every known session that's not already archived.
      let updated = 0;
      for (const id of knownIds) if (!beforeSet.has(id)) updated += 1;
      result.updated = updated;
      metadata.archived = Array.from(new Set([...beforeSet, ...Array.from(knownIds)]));
    } else {
      // Restore every previously-archived session that's still known.
      let updated = 0;
      for (const id of beforeSet) if (knownIds.has(id)) updated += 1;
      result.updated = updated;
      metadata.archived = [];
    }
  });
  const registry: any = workspaceRegistry();
  if (registry) {
    for (const id of Array.from(knownIds)) {
      try { await registry.archiveSession(id, archived); } catch { /* tombstone write failed, continue */ }
    }
  }
  return result;
}

async function setSessionExpert(sessionId: string, expert: { expertId: string; expertName: string; avatarLocal?: string } | null): Promise<void> {
  const sessions = await listAllPiSessions();
  const activeSession = state.session?.sessionId === sessionId;
  if (!activeSession && !sessions.some((entry: any) => entry.id === sessionId)) throw new Error(`Pi session not found: ${sessionId}`);
  await updateSessionMetadata(sessionId, (metadata) => {
    if (expert) metadata.experts[sessionId] = expert;
    else delete metadata.experts[sessionId];
  });
}

// piSessionDir lives in agent-host.ts (line 891) and is re-exported so the
// listSessions implementation can resolve per-cwd session directories
// through the same circular-import pattern as state / piHome / etc.

export {
  updateSessionMetadata,
  clearSessionMetadata,
  setSessionArchived,
  setAllArchived,
  setSessionExpert,
};

/**
 * Phase 8.3 Batch C 收尾 — setSessionPinned moved from agent-host.ts.
 *
 * Toggles a session's pinned status. Mirrors `setSessionArchived`:
 *   - read metadata JSON
 *   - apply the diff via the in-memory update callback
 *   - re-emit `session/metadata-updated` for renderer/UI sync
 *
 * Throws if `sessionId` is not in the persisted session list (no silent
 * no-op — callers want to surface a meaningful IPC error).
 */
export async function setSessionPinned(sessionId: string, pinned: boolean): Promise<boolean> {
  const sessions = await listAllPiSessions();
  if (!sessions.some((entry: { id?: string }) => entry.id === sessionId)) {
    throw new Error(`Pi session not found: ${sessionId}`);
  }
  await updateSessionMetadata(sessionId, (metadata) => {
    metadata.pinned = metadata.pinned.filter((id: string) => id !== sessionId);
    if (pinned) metadata.pinned.push(sessionId);
  });
  return pinned;
}