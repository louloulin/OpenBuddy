/**
 * host-modules/session-store.ts — session facade + rewind + CRUD.
 *
 * Phase 8.3 Batch C: 从 agent-host.ts 抽出 session lifecycle 的 IPC handler
 * (~190 行):
 *   - loadSession (line 4096) — re-bind an existing persisted session
 *   - sessionInfo (line 4139) — context-usage snapshot
 *   - sessionUsage (line 4146) — token stats snapshot
 *   - sessionFile (line 4159) — on-disk path of the active session
 *   - rewindSession (line 4167) — branch walk + optional file rewind
 *   - formatBranchSummaryText (line 4225) — helper for rewindSession
 *   - renameSession (line 4268) — set session title
 *   - deleteSession (line 4279) — drop persisted file
 *
 * 设计:
 *   - state / listAllPiSessions / initialize / dispose / emitPluginEvent /
 *     emitRendererEvent / piSessionDir 通过环形 import 自 ../agent-host 注入
 *   - piSessionDir / initialize / dispose 这次会从 agent-host.ts 顶部
 *     加 export 关键字以支持环形 import
 *   - restoreFileSnapshots 从 sibling ./rewind-snapshot 拿, 避开 agent-host
 *     中心路由 (sibling import pattern 已在 Batch A cordis-runtime ↔
 *     workbench-scope 验证)
 *   - piRuntimeCoordinator 是 module-level singleton, 留在 agent-host.ts
 *     并 export
 *   - collectEntriesForBranchSummary / prepareBranchEntries / formatBranchSummaryText
 *     直接 from @earendil-works/pi-coding-agent + ./branch-summary-format
 */
import { unlink } from "node:fs/promises";

import { SessionManager, collectEntriesForBranchSummary, prepareBranchEntries, type AgentSession } from "@earendil-works/pi-coding-agent";
import { formatBranchSummaryText as formatBranchSummaryTextExport } from "../branch-summary-format";

import { randomUUID } from "node:crypto";
import { readFile, writeFile, open, stat, rm } from "node:fs/promises";

import { generateTraceId } from "@openbuddy/logging-shared";
import { lifecycleEntry, lifecycleEvent, lifecycleRevisionFromEntries, OPENBUDDY_LIFECYCLE_CUSTOM_TYPE, type OpenBuddyLifecycleEvent } from "@openbuddy/core-session/lifecycle";
import { hostReceived as hostReceivedLog, hostDispatched as hostDispatchedLog, hostFailed as hostFailedLog } from "../agent-host-log";
// Phase 8.3 Architectural Refactor — Install Pattern:
//   修复前: 11 个符号 import 自 ../agent-host (reverse dep)
//   修复后: 通过 installSessionStore() 一次性注入, 本模块零 agent-host 导入.
//   `dispose` / `initialize` / `piRuntimeCoordinator` 都是函数引用, 安装后
//   通过 module-level let 访问.
import { piSessionDir as _piSessionDir } from "./_host-paths";
import { type AgentHostState } from "./_state-shape";
import { createDefaultAgentHostState } from "./_default-state";

let state: AgentHostState = createDefaultAgentHostState();
let piSessionDir: (cwd: string) => string;
let emitPluginEvent: (type: string, payload: unknown) => void;
let emitRendererEvent: (channel: string, payload: unknown) => void;
let enqueueLifecycle: <T>(op: () => Promise<T>) => Promise<T>;
let initialize: (opts?: { cwd?: string; sessionPath?: string; force?: boolean }) => Promise<void>;
let rebindSession: (sessionPath: string, cwd: string) => Promise<void>;
let dispose: () => Promise<void>;
let lifecycleAppendQueues: Map<string, Promise<void>>;
let listAllPiSessions: <T = unknown>() => any;
let persistedSessionPath: (id: string | undefined) => Promise<string | undefined>;
let piRuntimeCoordinator: { reload: (reason: string) => Promise<void> };

/**
 * Bind session-store dependencies. Called once from
 * agent-host.ts:initialize(). Idempotent.
 */
export function installSessionStore(deps: {
  state: AgentHostState;
  piSessionDir: (cwd: string) => string;
  emitPluginEvent: (type: string, payload: unknown) => void;
  emitRendererEvent: (channel: string, payload: unknown) => void;
  enqueueLifecycle: <T>(op: () => Promise<T>) => Promise<T>;
  initialize: (opts?: { cwd?: string; sessionPath?: string; force?: boolean }) => Promise<void>;
  rebindSession: (sessionPath: string, cwd: string) => Promise<void>;
  dispose: () => Promise<void>;
  lifecycleAppendQueues: Map<string, Promise<void>>;
  listAllPiSessions: <T = unknown>() => any;
  persistedSessionPath: (id: string | undefined) => Promise<string | undefined>;
  piRuntimeCoordinator: { reload: (reason: string) => Promise<void> };
}): void {
  state = deps.state;
  piSessionDir = deps.piSessionDir;
  emitPluginEvent = deps.emitPluginEvent;
  emitRendererEvent = deps.emitRendererEvent;
  enqueueLifecycle = deps.enqueueLifecycle;
  initialize = deps.initialize;
  rebindSession = deps.rebindSession;
  dispose = deps.dispose;
  lifecycleAppendQueues = deps.lifecycleAppendQueues;
  listAllPiSessions = deps.listAllPiSessions as any;
  persistedSessionPath = deps.persistedSessionPath;
  piRuntimeCoordinator = deps.piRuntimeCoordinator;
}
import { restoreFileSnapshots } from "./rewind-snapshot";

async function loadSession(sessionId: string, cwd: string, options?: { traceId?: string; sessionId?: string }): Promise<void> {
  const traceId = options?.traceId ?? generateTraceId();
  hostReceivedLog("agent:load-session", traceId, sessionId);
  let sessionCwd = cwd || state.cwd || "";
  try {
    const sessions = await listAllPiSessions();
    const session = sessions.find((entry: any) => entry.id === sessionId);
    if (!session) {
      const err = new Error(`Pi session not found: ${sessionId}`);
      hostFailedLog("agent:load-session", traceId, err);
      throw err;
    }
    sessionCwd = session.cwd || sessionCwd;
    await enqueueLifecycle(async () => {
      // Warm-host fast path: PiSessionRuntime.replace() swaps only the
      // AgentSession (plugins / resource loader / typert stay put), turning a
      // ~2.4s full re-boot into a ~50ms rebind. rebindSession itself falls
      // back to initialize() when cwd or agent-preset scope differs.
      if (rebindSession) await rebindSession(session.path, sessionCwd);
      else await initialize({ cwd: sessionCwd, sessionPath: session.path });
      const entries = state.session?.sessionManager.getEntries() ?? [];
      const textOf = (content: unknown): string => {
        if (typeof content === "string") return content;
        if (!Array.isArray(content)) return "";
        return content.map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "").join("");
      };
      // MVP-2 — dispatch per content part so historical messages replay with
      // thought blocks / tool calls / images intact, not just text. Existing
      // renderer case branches already handle each `type`:
      //   - text          → user_message_replay | agent_message_chunk
      //   - thinking      → agent_thought_chunk
      //   - toolCall      → tool_call
      //   - image         → user_message_replay (image part)
      // Zero renderer changes; this is purely main-side replay completeness.
      const emitContentParts = (message: { role?: string }, content: unknown, entryId: string) => {
        if (typeof content === "string") {
          if (!content) return;
          if (message.role === "user") {
            emitRendererEvent("pi://update", { sessionId, type: "user_message_replay", content: [{ type: "text", text: content }] });
          } else if (message.role === "assistant") {
            emitRendererEvent("pi://update", { sessionId, type: "agent_message_chunk", content: [{ type: "text", text: content }] });
            emitRendererEvent("pi://complete", { sessionId, promptId: entryId, stopReason: "end_turn" });
          }
          return;
        }
        if (!Array.isArray(content)) return;
        for (const part of content) {
          if (!part || typeof part !== "object") continue;
          const p = part as { type?: string; text?: unknown; thinking?: unknown; toolCall?: unknown; data?: unknown; mimeType?: unknown };
          if (p.type === "text" && typeof p.text === "string") {
            if (message.role === "user") {
              emitRendererEvent("pi://update", { sessionId, type: "user_message_replay", content: [{ type: "text", text: p.text }] });
            } else if (message.role === "assistant") {
              emitRendererEvent("pi://update", { sessionId, type: "agent_message_chunk", content: [{ type: "text", text: p.text }] });
              emitRendererEvent("pi://complete", { sessionId, promptId: entryId, stopReason: "end_turn" });
            }
          } else if (p.type === "thinking" && typeof p.thinking === "string") {
            emitRendererEvent("pi://update", { sessionId, type: "agent_thought_chunk", content: [{ type: "thinking", text: p.thinking }] });
          } else if (p.type === "toolCall" && p.toolCall && typeof p.toolCall === "object") {
            emitRendererEvent("pi://update", { sessionId, type: "tool_call", toolCall: p.toolCall });
          } else if (p.type === "image") {
            // Pass through image content so the renderer can render it from history.
            if (message.role === "user") {
              emitRendererEvent("pi://update", { sessionId, type: "user_message_replay", content: [{ type: "image", data: p.data, mimeType: p.mimeType }] });
            } else if (message.role === "assistant") {
              emitRendererEvent("pi://update", { sessionId, type: "agent_message_chunk", content: [{ type: "image", data: p.data, mimeType: p.mimeType }] });
              emitRendererEvent("pi://complete", { sessionId, promptId: entryId, stopReason: "end_turn" });
            }
          }
        }
      };
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (entry.type !== "message") continue;
        const message = entry.message as { role?: string; content?: unknown };
        // MVP-2 — prefer part-aware dispatch; fall back to text-only when
        // content is empty array (some old sessions predate parts schema).
        if (Array.isArray(message.content) && message.content.length > 0) {
          emitContentParts(message, message.content, entry.id);
        } else {
          const text = textOf(message.content);
          if (!text) continue;
          if (message.role === "user") {
            emitRendererEvent("pi://update", { sessionId, type: "user_message_replay", content: [{ type: "text", text }] });
          } else if (message.role === "assistant") {
            emitRendererEvent("pi://update", { sessionId, type: "agent_message_chunk", content: [{ type: "text", text }] });
            emitRendererEvent("pi://complete", { sessionId, promptId: entry.id, stopReason: "end_turn" });
          }
        }
        // P1-16: yield to the event loop every 32 entries so the IPC
        // channel isn't starved on long-session loads (200+ messages used
        // to drain the loop in one synchronous burst). `setImmediate`
        // (not setTimeout) keeps the overall latency floor below one
        // macrotask — i.e. the renderer starts receiving events ~16ms
        // sooner than a setTimeout(0) variant, and the wall-clock total
        // for a 200-entry replay is unchanged.
        if ((i & 31) === 31) await new Promise<void>((resolve) => setImmediate(resolve));
      }
    });
    hostDispatchedLog("agent:load-session", traceId, sessionId);
  } catch (error) {
    hostFailedLog("agent:load-session", traceId, error);
    throw error;
  }
}

function sessionInfo(sessionId: string) {
  const session = state.session;
  if (!session || session.sessionId !== sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
  const contextUsage = session.getContextUsage();
  return { sessionId, contextUsage: contextUsage ?? null, model: session.model ?? null };
}

function sessionUsage(sessionId: string) {
  const session = state.session;
  if (!session || session.sessionId !== sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
  const stats = session.getSessionStats();
  return { usage: {
    inputTokens: stats.tokens.input,
    outputTokens: stats.tokens.output,
    totalTokens: stats.tokens.total,
    cachedReadTokens: stats.tokens.cacheRead,
    numTurns: stats.userMessages,
  } };
}

function sessionFile(sessionId: string): string {
  const session = state.session;
  if (!session || session.sessionId !== sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
  const file = session.sessionManager.getSessionFile();
  if (!file) throw new Error(`Pi session has no persisted file: ${sessionId}`);
  return file;
}

async function rewindSession(sessionId: string, targetPromptIndex: number, mode = "conversation"): Promise<void> {
  if (!["conversation", "files", "all"].includes(mode)) throw new Error(`invalid rewind mode: ${mode}`);
  const session = state.session;
  if (!session || session.sessionId !== sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
  if (!Number.isInteger(targetPromptIndex) || targetPromptIndex < 0) throw new Error("invalid rewind prompt index");
  const manager = session.sessionManager;
  const prompts = manager.getEntries().filter((entry) => entry.type === "message" && entry.message.role === "user");
  const target = prompts[targetPromptIndex];
  if (!target) throw new Error(`rewind point not found: ${targetPromptIndex}`);
  const restoreFiles = mode === "files" || mode === "all";
  const restoreResults = restoreFiles
    ? await restoreFileSnapshots(session.sessionId as any, target.id, (session as any).cwd)
    : { restored: 0, skipped: 0 };
  // Capture the abandoned path BEFORE branching so we can summarise it as a
  // branch_summary entry. This mirrors what pi's TUI shows for forked/rewound
  // sessions and gives downstream tooling (F3 telemetry, conversation search)
  // a stable artifact for what was thrown away.
  //
  // We deliberately do NOT call pi's LLM-backed generateBranchSummary here:
  // that helper expects the in-memory Session runtime (findEntriesOnBranch),
  // not the file-backed SessionManager. Wiring the LLM call is a follow-up —
  // for now we write a deterministic local summary so the branch_summary entry
  // exists with the right shape and downstream tooling has a stable target.
  const oldLeafId = manager.getLeafId();
  // Reuse pi's branch-summary walk so we track the same ancestor logic as
  // the official TUI. The SDK runs against the file-backed
  // ReadonlySessionManager directly — no in-memory Session required.
  let abandonedSummary: string | null = null;
  if (target.parentId && oldLeafId && oldLeafId !== target.parentId) {
    const collected = collectEntriesForBranchSummary(manager, oldLeafId, target.parentId);
    // prepareBranchEntries handles the newest-first token budget for us and
    // returns `messages` in chronological order, so we don't have to walk
    // parentId pointers ourselves. The LLM-backed generateBranchSummary call
    // stays out of this path until OpenBuddy's model registry is plumbed.
    const prepared = prepareBranchEntries(collected.entries, 8_000);
    abandonedSummary = formatBranchSummaryText(prepared.messages);
  }
  if (target.parentId) {
    if (abandonedSummary) {
      manager.branchWithSummary(target.parentId, abandonedSummary, { rewoundFromPromptIndex: targetPromptIndex, source: "openbuddy.rewind" }, true);
    } else {
      manager.branch(target.parentId);
    }
  } else {
    manager.resetLeaf();
  }
  await piRuntimeCoordinator.reload("session-rewind");
  emitPluginEvent("session/rewound", {
    sessionId,
    targetPromptIndex,
    mode,
    filesRestored: restoreFiles,
    filesRestoredCount: restoreResults.restored,
    filesRestoreSkipped: restoreResults.skipped,
    abandonedSummary: abandonedSummary ?? undefined,
  });
}

/** Compose a short text summary from `prepareBranchEntries` output.
 *  Walks `AgentMessage[]` (chronological), keeps prompt prefix + truncated
 *  assistant text.  Returns null when nothing usable survives the budget. */
function formatBranchSummaryText(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>,
  options?: { maxTotal?: number; maxUser?: number; maxAssistant?: number },
): string | null {
  return formatBranchSummaryTextExport(messages, options);
}

async function renameSession(sessionId: string, title: string, cwd: string): Promise<void> {
  const sessions = await SessionManager.list(cwd, piSessionDir(cwd));
  const entry = sessions.find((item) => item.id === sessionId);
  if (!entry) throw new Error(`Pi session not found: ${sessionId}`);
  if (state.session?.sessionId === sessionId) state.session.sessionManager.appendSessionInfo(title);
  else {
    const manager = SessionManager.open(entry.path);
    manager.appendSessionInfo(title);
  }
}

async function deleteSession(sessionId: string, cwd: string): Promise<void> {
  const sessions = await SessionManager.list(cwd, piSessionDir(cwd));
  const entry = sessions.find((item) => item.id === sessionId);
  if (!entry) return;
  if (state.session?.sessionId === sessionId) await dispose();
  await unlink(entry.path);
}

export {
  loadSession,
  sessionInfo,
  sessionUsage,
  sessionFile,
  rewindSession,
  formatBranchSummaryText,
  renameSession,
  deleteSession,
};

// ---------------------------------------------------------------------------
// Phase 8.3 Batch H: session-store 写路径 (从 agent-host.ts:1044-1325 抽出)
// 之前 session-store.ts (Batch C) 只覆盖 session facade + rewind + CRUD。
// 这里把 read + append + lifecycle append + create + header persist 全部
// 写入路径搬到同一个 sibling 模块, 让 agent-host.ts 的 aggregate DSH
// bridge (line 2466-2479) 直接引用本模块的 export, 不再依赖 agent-host
// 内部 helper。
// 类型 PersistedSessionHeader / PersistedSessionInfo 跟函数一起搬过来,
// agent-host.ts 通过 `export type { ... } from "./host-modules/session-store"`
// 透传给 DSH bridge (agent-host.ts 内已有的 type re-export 模式)。
// ---------------------------------------------------------------------------

export type PersistedSessionHeader = {
	id: string;
	cwd?: string;
	title?: string;
	name?: string;
	timestamp?: string;
	parentSessionId?: string;
};

export type PersistedSessionInfo = PersistedSessionHeader & {
	path: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
	allMessagesText: string;
};

async function listPersistedSessionInfos(): Promise<PersistedSessionInfo[]> {
	const sessions = await listAllPiSessions();
	const idsByPath = new Map(sessions.map((session: any) => [session.path, session.id]));
	return sessions.map((session: any) => ({
		id: session.id,
		path: session.path,
		...(session.cwd ? { cwd: session.cwd } : {}),
		...(session.name ? { name: session.name, title: session.name } : {}),
		...(session.parentSessionPath && idsByPath.get(session.parentSessionPath)
			? { parentSessionId: idsByPath.get(session.parentSessionPath) }
			: {}),
		timestamp: session.created.toISOString(),
		created: session.created.toISOString(),
		modified: session.modified.toISOString(),
		messageCount: session.messageCount,
		firstMessage: session.firstMessage,
		allMessagesText: session.allMessagesText,
	}));
}

async function listPersistedSessionHeaders(): Promise<PersistedSessionHeader[]> {
	return listPersistedSessionInfos();
}

async function readPersistedSessionHeader(sessionId: string): Promise<PersistedSessionHeader> {
	const header = (await listPersistedSessionInfos()).find((entry) => entry.id === sessionId);
	if (!header) throw new Error(`session '${sessionId}' was not found in Pi session persistence`);
	return header;
}

async function readPersistedSessionEntries(sessionId: string): Promise<unknown[]> {
	const session = (await listPersistedSessionInfos()).find((entry) => entry.id === sessionId);
	if (!session) throw new Error(`session '${sessionId}' was not found in Pi session persistence`);
	return SessionManager.open(session.path).getEntries();
}

async function readPersistedSessionRaw(sessionId: string): Promise<{ path: string; content: string; header: Record<string, unknown> } | undefined> {
	const path = await persistedSessionPath(sessionId);
	if (!path) return undefined;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		let before;
		try {
			before = await stat(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
		const content = await readFile(path, "utf8");
		let after;
		try {
			after = await stat(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) continue;
		const firstLine = content.split(/\r?\n/u, 1)[0] ?? "";
		let parsed: unknown;
		try {
			parsed = JSON.parse(firstLine);
		} catch (error) {
			throw new Error(`corrupt Pi session header in "${path}"`, { cause: error });
		}
		if (!parsed || typeof parsed !== "object" || (parsed as { type?: unknown }).type !== "session" || (parsed as { id?: unknown }).id !== sessionId) {
			throw new Error(`corrupt Pi session header in "${path}": requested id "${sessionId}" does not match the first record`);
		}
		return { path, content, header: parsed as Record<string, unknown> };
	}
	throw new Error(`session "${sessionId}" changed while reading its Pi JSONL artifact`);
}

async function readPersistedSessionRevision(sessionId: string): Promise<{ path: string; revision: string; entryCount: number } | undefined> {
	const path = await persistedSessionPath(sessionId);
	if (!path && state.session?.sessionId === sessionId) {
		const entries = state.session.sessionManager.getEntries();
		return { path: `memory://${sessionId}`, revision: `memory:${entries.length}`, entryCount: entries.length };
	}
	if (!path) return undefined;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const before = await persistedSessionFileRevision(path);
			const entries = state.session?.sessionId === sessionId
				? state.session.sessionManager.getEntries()
				: SessionManager.open(path).getEntries();
			const after = await persistedSessionFileRevision(path);
			if (before !== after) continue;
			return { path, revision: after, entryCount: entries.length };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	}
	throw new Error(`session "${sessionId}" changed while reading its Pi revision`);
}

async function persistedSessionFileRevision(path: string): Promise<string> {
	const file = await stat(path, { bigint: true });
	return [path, file.dev, file.ino, file.size, file.mtimeNs, file.ctimeNs].join(":");
}

const PI_SESSION_LOCK_TTL_MS = 30_000;
const PI_SESSION_LOCK_WAIT_MS = 5_000;

async function withPersistedSessionLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
	const lockPath = `${path}.openbuddy.lock`;
	const owner = randomUUID();
	const deadline = Date.now() + PI_SESSION_LOCK_WAIT_MS;
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		for (;;) {
			try {
				handle = await open(lockPath, "wx", 0o600);
				await handle.writeFile(`${JSON.stringify({ version: 1, owner, pid: process.pid, createdAt: Date.now(), expiresAt: Date.now() + PI_SESSION_LOCK_TTL_MS })}\n`, "utf8");
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				let stale = false;
				try {
					const lock = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: unknown; expiresAt?: unknown };
					if (typeof lock.pid === "number" && lock.pid !== process.pid) {
						try { process.kill(lock.pid, 0); } catch (probeError) { stale = (probeError as NodeJS.ErrnoException).code !== "EPERM"; }
					}
					if (typeof lock.expiresAt === "number" && lock.expiresAt <= Date.now() && stale) await rm(lockPath, { force: true });
				} catch {
					try {
						const metadata = await stat(lockPath);
						if (Date.now() - metadata.mtimeMs > PI_SESSION_LOCK_TTL_MS) await rm(lockPath, { force: true });
					} catch { /* another owner may be creating or releasing the lock */ }
				}
				if (Date.now() >= deadline) throw new Error(`timed out acquiring Pi session lock for "${path}"`);
				await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
			}
		}
		return await operation();
	} finally {
		await handle?.close().catch(() => undefined);
		try {
			const lock = JSON.parse(await readFile(lockPath, "utf8")) as { owner?: unknown };
			if (lock.owner === owner) await rm(lockPath, { force: true });
		} catch { /* the lock was already reclaimed after a crash */ }
	}
}

async function appendPersistedSessionEntries(
	sessionId: string,
	entries: Array<{ customType: string; data: unknown }>,
	options: { expectedRevision?: number; expectedSourceRevision?: string; allowPreparation?: boolean } = {},
): Promise<{ entryIds: string[]; sourceRevision: string; entryCount: number }> {
	const path = await persistedSessionPath(sessionId);
	if (!path && state.session?.sessionId === sessionId) {
		const manager = state.session.sessionManager;
		const beforeCount = manager.getEntries().length;
		const beforeRevision = `memory:${beforeCount}`;
		if (options.expectedSourceRevision !== undefined && options.expectedSourceRevision !== beforeRevision) {
			throw Object.assign(new Error(`source revision conflict for session "${sessionId}"`), {
				code: "revision-conflict",
				expectedSourceRevision: options.expectedSourceRevision,
				actualSourceRevision: beforeRevision,
			});
		}
		if (options.expectedRevision !== undefined && options.expectedRevision !== beforeCount) {
			throw Object.assign(new Error(`revision conflict for session "${sessionId}"`), {
				code: "revision-conflict",
				expectedRevision: options.expectedRevision,
				actualRevision: beforeCount,
			});
		}
		const entryIds = entries.map((entry) => manager.appendCustomEntry(entry.customType, entry.data));
		return { entryIds, sourceRevision: `memory:${manager.getEntries().length}`, entryCount: manager.getEntries().length };
	}
	if (!path) throw new Error(`session '${sessionId}' was not found in Pi session persistence`);
	return withPersistedSessionLock(path, async () => {
		if (!options.allowPreparation) {
			try {
				const lease = JSON.parse(await readFile(`${path}.openbuddy-preparation.lease`, "utf8")) as { expiresAt?: unknown };
				if (typeof lease.expiresAt !== "number" || lease.expiresAt > Date.now()) throw Object.assign(new Error(`session "${sessionId}" has an active preparation`), { code: "preparation-conflict", sessionId });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as { code?: string }).code !== "preparation-conflict") throw error;
				if ((error as { code?: string }).code === "preparation-conflict") throw error;
			}
		}
		const manager = state.session?.sessionId === sessionId ? state.session.sessionManager : SessionManager.open(path);
		const beforeRevision = await persistedSessionFileRevision(path);
		const beforeCount = manager.getEntries().length;
		if (options.expectedSourceRevision !== undefined && options.expectedSourceRevision !== beforeRevision) {
			throw Object.assign(new Error(`source revision conflict for session "${sessionId}"`), {
				code: "revision-conflict",
				expectedSourceRevision: options.expectedSourceRevision,
				actualSourceRevision: beforeRevision,
				expectedRevision: options.expectedRevision,
				actualRevision: beforeCount,
			});
		}
		if (options.expectedRevision !== undefined && options.expectedRevision !== beforeCount) {
			throw Object.assign(new Error(`revision conflict for session "${sessionId}"`), {
				code: "revision-conflict",
				expectedRevision: options.expectedRevision,
				actualRevision: beforeCount,
			});
		}
		const entryIds = entries.map((entry) => manager.appendCustomEntry(entry.customType, entry.data));
		return { entryIds, sourceRevision: await persistedSessionFileRevision(path), entryCount: manager.getEntries().length };
	});
}

async function appendPersistedSessionEntry(sessionId: string, customType: string, data: unknown): Promise<string> {
	if (state.session?.sessionId === sessionId) return state.session.sessionManager.appendCustomEntry(customType, data);
	const session = (await listPersistedSessionInfos()).find((entry) => entry.id === sessionId);
	if (!session) throw new Error(`session '${sessionId}' was not found in Pi session persistence`);
	return SessionManager.open(session.path).appendCustomEntry(customType, data);
}

async function appendLifecycleSessionEntry(sessionId: string, event: OpenBuddyLifecycleEvent): Promise<string> {
  const append = async (): Promise<string> => {
    const appendTo = (manager: SessionManager): string => {
      const revision = lifecycleRevisionFromEntries(manager.getEntries()) + 1;
      return manager.appendCustomEntry(OPENBUDDY_LIFECYCLE_CUSTOM_TYPE, lifecycleEntry(lifecycleEvent({ ...event, revision })));
    };
    if (state.session?.sessionId === sessionId) return appendTo(state.session.sessionManager);
    const session = (await listPersistedSessionInfos()).find((entry) => entry.id === sessionId);
    if (!session) throw new Error(`session '${sessionId}' was not found in Pi session persistence`);
    return appendTo(SessionManager.open(session.path));
  };
  const previous = lifecycleAppendQueues.get(sessionId) ?? Promise.resolve();
  const queued = previous.catch(() => undefined).then(append);
  const marker = queued.then(() => undefined, () => undefined);
  lifecycleAppendQueues.set(sessionId, marker);
  try {
    return await queued;
  } finally {
    if (lifecycleAppendQueues.get(sessionId) === marker) lifecycleAppendQueues.delete(sessionId);
  }
}

async function createPersistedSession(meta: { id: string; cwd?: string; parentSession?: string }): Promise<{ sessionId: string; sessionFile?: string; cwd: string }> {
	const cwd = meta.cwd ?? state.cwd ?? process.cwd();
	const manager = SessionManager.create(cwd, piSessionDir(cwd), {
		id: meta.id,
		...(meta.parentSession ? { parentSession: meta.parentSession } : {}),
	});
	return {
		sessionId: manager.getSessionId(),
		cwd,
		...(manager.getSessionFile() ? { sessionFile: manager.getSessionFile() } : {}),
	};
}

async function persistPiSessionHeader(session: AgentSession): Promise<void> {
  const manager = session.sessionManager;
  const sessionFile = manager.getSessionFile();
  const header = manager.getHeader();
  if (!sessionFile || !header) return;
  let existingHeader: Awaited<ReturnType<typeof stat>> | undefined;
  try {
    existingHeader = await stat(sessionFile);
  } catch {
    existingHeader = undefined;
  }
  if (existingHeader) return;
  try {
    await writeFile(sessionFile, `${JSON.stringify(header)}\n`, "utf8");
  } catch (error) {
    console.warn("[openbuddy] failed to persist Pi session header", error);
    return;
  }
  (manager as unknown as { flushed: boolean }).flushed = true;
}

export {
  listPersistedSessionInfos,
  listPersistedSessionHeaders,
  readPersistedSessionHeader,
  readPersistedSessionEntries,
  readPersistedSessionRaw,
  readPersistedSessionRevision,
  persistedSessionFileRevision,
  withPersistedSessionLock,
  appendPersistedSessionEntries,
  appendPersistedSessionEntry,
  appendLifecycleSessionEntry,
  createPersistedSession,
  persistPiSessionHeader,
};
