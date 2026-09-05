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
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";

// Phase 8.3 Architectural Refactor — Install Pattern:
//   修复前: `import { emitPluginEvent, listAllPiSessions, piHome, piSessionDir, state, workspaceRegistry } from "../agent-host"` (reverse dep)
//   修复后: 通过 installSessionMetadata() 一次性注入, 本模块零 agent-host 导入.
//   listAllPiSessions / piSessionDir 来自 _state-shape (types) 或 _host-paths (runtime).
import { piHome as _piHome, piSessionDir as _piSessionDir } from "./_host-paths";
import { type AgentHostState } from "./_state-shape";
import { createDefaultAgentHostState } from "./_default-state";

let state: AgentHostState = createDefaultAgentHostState();
let piHome: () => string;
let piSessionDir: (cwd: string) => string;
let emitPluginEvent: (type: string, payload: unknown) => void;
let listAllPiSessions: <T = unknown>() => any;
let workspaceRegistry: () => unknown;

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
  state = deps.state;
  piHome = deps.piHome;
  piSessionDir = deps.piSessionDir;
  emitPluginEvent = deps.emitPluginEvent;
  listAllPiSessions = deps.listAllPiSessions as any;
  workspaceRegistry = deps.workspaceRegistry;
}

export async function listSessions(cwd: string) {
  const stateFile = join(piHome(), "openbuddy-state.json");
  let metadata: { pinned?: string[]; archived?: string[]; experts?: Record<string, { expertId: string; expertName: string; avatarLocal?: string }> } = {};
  try { metadata = JSON.parse(await readFile(stateFile, "utf8")); } catch { /* first run */ }
  const pinned = new Set(metadata.pinned ?? []);
  const archived = new Set(metadata.archived ?? []);
  const registryArchived = new Set((state.context?.get("workspaceRegistry") as { archivedSessionIds?: readonly string[] } | undefined)?.archivedSessionIds ?? []);
  const scopedSessions = await SessionManager.list(cwd, piSessionDir(cwd));
  const allSessions = await listAllPiSessions();
  const sessions = [...new Map([
    ...scopedSessions,
    ...allSessions.filter((entry: any) => resolve(entry.cwd ?? cwd) === resolve(cwd)),
  ].map((entry: any) => [entry.path, entry])).values()];
  const idsByPath = new Map(allSessions.map((entry: any) => [entry.path, entry.id]));
  const childModes = new Map<string, "one-shot" | "continuable">();
  for (const entry of allSessions) {
    if (!entry.parentSessionPath) continue;
    try {
      const marker = SessionManager.open(entry.path).getEntries()
        .find((candidate) => candidate.type === "custom" && (candidate as { customType?: unknown }).customType === "openbuddy/subagent") as { data?: unknown } | undefined;
      const data = marker?.data && typeof marker.data === "object" ? marker.data as Record<string, unknown> : undefined;
      childModes.set(entry.id, data?.mode === "continuable" ? "continuable" : "one-shot");
    } catch {
      childModes.set(entry.id, "one-shot");
    }
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
    const expert = metadata.experts?.[entry.id];
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

async function updateSessionMetadata(sessionId: string, update: (metadata: {
  pinned: string[];
  archived: string[];
  experts: Record<string, { expertId: string; expertName: string; avatarLocal?: string }>;
}) => void): Promise<void> {
  const stateFile = join(piHome(), "openbuddy-state.json");
  let metadata: {
    pinned?: string[];
    archived?: string[];
    experts?: Record<string, { expertId: string; expertName: string; avatarLocal?: string }>;
  } = {};
  try { metadata = JSON.parse(await readFile(stateFile, "utf8")); } catch { /* first run */ }
  const normalized = {
    pinned: Array.isArray(metadata.pinned) ? metadata.pinned.filter((id): id is string => typeof id === "string") : [],
    archived: Array.isArray(metadata.archived) ? metadata.archived.filter((id): id is string => typeof id === "string") : [],
    experts: metadata.experts && typeof metadata.experts === "object" ? metadata.experts : {},
  };
  update(normalized);
  await mkdir(piHome(), { recursive: true });
  const temporary = `${stateFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, stateFile);
  if (state.session?.sessionId === sessionId) emitPluginEvent("session/metadata-updated", { sessionId });
}

async function clearSessionMetadata(): Promise<void> {
  const stateFile = join(piHome(), "openbuddy-state.json");
  await rm(stateFile, { force: true });
  emitPluginEvent("session/metadata-cleared", {});
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
