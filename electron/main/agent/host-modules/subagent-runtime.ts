/**
 * host-modules/subagent-runtime.ts — subagent + harness task READ surface.
 *
 * Phase 8.3 Batch D (D1): 从 agent-host.ts 抽出 subagent IPC 的 **read** 路径
 * (~175 行, lines 3747-3920):
 *   - listRunningTasks (line 3747) — Map state.runningTasks → public rows
 *   - subagentEvents (line 3784) — filter session event log for subagent events
 *   - listSubagentChildren (line 3792) — already export; reroute via wrapper
 *   - listSessionJobs (line 3854) — combine jobsRegistry + event log + running tasks
 *   - subagentHistory (line 3881) — paginate child session entries
 *   - 3 type aliases (HarnessSubagentEntry / HarnessJobView / HostJobRecord)
 *     moved with the functions that own them; agent-host.ts re-exports via
 *   `export type { ... } from "./host-modules/subagent-runtime"`
 *
 * 设计:
 *   - state / listAllPiSessions / emitPluginEvent 通过环形 import 自
 *     ../agent-host 注入
 *   - SessionManager 直接 from @earendil-works/pi-coding-agent (无 module-level
 *     singleton 依赖)
 *   - paginateHistoryEntries from sibling ./pagination (已落地)
 *   - **write 路径** (ensureContinuableSubagent / createDeepSeekAgentRuntime /
 *     promptSubagent / interruptSubagent / killTask / inspirationGenerate)
 *     留在 agent-host.ts — 它们 touches state 在 initialize / execute 主流程
 *     (lines 3451-3461, 3572-3680), 抽离需要同时迁移 initialize(), 风险太高
 *     留给后续 Batch D2/D3
 */
import { randomUUID } from "node:crypto";

import { SessionManager, createAgentSession } from "@earendil-works/pi-coding-agent";
// Phase 8.3 Architectural Refactor — Install Pattern:
//   修复前: 7 个符号 import 自 ../agent-host (reverse dep)
//   修复后: 通过 installSubagentRuntime() 一次性注入, 本模块零 agent-host 导入.
//   PiPromptContentPart 改从 ./agent-prompt 拿 (它也通过 install 暴露类型).
import { piHome as _piHome } from "./_host-paths";
import { type AgentHostState } from "./_state-shape";
import { createDefaultAgentHostState } from "./_default-state";
import type { HostJobRecord, PiPromptContentPart } from "./_state-shape";

let state: AgentHostState = createDefaultAgentHostState();
let piHome: () => string;
let emitPluginEvent: (type: string, payload: unknown) => void;
let emitRendererEvent: (channel: string, payload: unknown) => void;
let ensureContinuableSubagent: (
  parentSessionId: string,
  childSessionId: string,
) => Promise<unknown>;
let listAllPiSessions: <T = unknown>() => any;

/**
 * Bind subagent-runtime dependencies. Called once from
 * agent-host.ts:initialize(). Idempotent.
 */
export function installSubagentRuntime(deps: {
  state: AgentHostState;
  piHome: () => string;
  emitPluginEvent: (type: string, payload: unknown) => void;
  emitRendererEvent: (channel: string, payload: unknown) => void;
  ensureContinuableSubagent: (
    parentSessionId: string,
    childSessionId: string,
  ) => Promise<unknown>;
  listAllPiSessions: <T = unknown>() => any;
}): void {
  state = deps.state;
  piHome = deps.piHome;
  emitPluginEvent = deps.emitPluginEvent;
  emitRendererEvent = deps.emitRendererEvent;
  ensureContinuableSubagent = deps.ensureContinuableSubagent;
  listAllPiSessions = deps.listAllPiSessions as any;
}
type SessionEventRecord = any;
import { paginateHistoryEntries } from "./pagination";

export type HarnessSubagentEntry = {
  kind: "child";
  id: string;
  mode: "one-shot" | "continuable";
  activity: "running" | "inactive";
  label?: string;
  hasChildren: boolean;
};

export type HarnessJobView = {
  id: string;
  kind: string;
  label: string;
  sessionId?: string;
  status: "running" | "stopping" | "completed" | "killed" | "failed";
  startedAt: number;
  finishedAt?: number;
  detail?: string;
};

export type { HostJobRecord };

function listRunningTasks() {
  return [...state.runningTasks.values()].map(({ id, kind, description, status, sessionId }) => ({
    id,
    kind,
    description,
    status,
    sessionId,
  }));
}

function subagentEvents(parentSessionId?: string): SessionEventRecord[] {
  return (state.sessionEventLog?.snapshot() ?? []).filter((event) => {
    if (event.type !== "subagent/start" && event.type !== "subagent/end") return false;
    const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
    return parentSessionId === undefined || payload.parentSessionId === parentSessionId;
  });
}

async function listSubagentChildren(parentSessionId: string): Promise<HarnessSubagentEntry[]> {
  const byId = new Map<string, HarnessSubagentEntry>();
  for (const event of subagentEvents(parentSessionId)) {
    const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
    const id = typeof payload.id === "string" ? payload.id : typeof payload.agentId === "string" ? payload.agentId : undefined;
    if (!id) continue;
    const previous = byId.get(id);
    const ended = event.type === "subagent/end";
    byId.set(id, {
      kind: "child",
      id,
      mode: "one-shot",
      activity: ended ? "inactive" : "running",
      ...(typeof payload.role === "string" ? { label: payload.role } : previous?.label ? { label: previous.label } : {}),
      hasChildren: false,
    });
  }
  for (const child of state.continuableSubagents.values()) {
    if (child.parentSessionId !== parentSessionId) continue;
    byId.set(child.id, {
      kind: "child",
      id: child.id,
      mode: child.mode,
      activity: child.session.isStreaming ? "running" : "inactive",
      label: child.role,
      hasChildren: false,
    });
  }
  try {
    const sessions = await listAllPiSessions();
    const byPath = new Map<any, any>(sessions.map((session: any) => [session.path, session]));
    const parent = sessions.find((session: any) => session.id === parentSessionId);
    if (parent) {
      for (const session of sessions as any[]) {
        if (session.parentSessionPath !== parent.path || byId.has(session.id)) continue;
        let mode: "one-shot" | "continuable" = "one-shot";
        let label = session.name;
        try {
          const entries = SessionManager.open(session.path).getEntries();
          const marker = entries.find((entry) => entry.type === "custom" && (entry as { customType?: unknown }).customType === "openbuddy/subagent") as { data?: unknown } | undefined;
          const data = marker?.data && typeof marker.data === "object" ? marker.data as Record<string, unknown> : undefined;
          if (data?.mode === "continuable") mode = "continuable";
          if (!label && typeof data?.role === "string") label = data.role;
        } catch {
          // A malformed child remains visible as a conservative one-shot row.
        }
        byId.set(session.id, {
          kind: "child",
          id: session.id,
          mode,
          activity: "inactive",
          ...(label ? { label } : {}),
          hasChildren: sessions.some((candidate: any) => candidate.parentSessionPath === session.path),
        });
      }
    }
  } catch {
    // A transient session-directory read failure leaves the live catalog usable.
  }
  return [...byId.values()];
}

function listSessionJobs(sessionId: string): HarnessJobView[] {
  const jobs: HarnessJobView[] = [...state.jobsRegistry.values()]
    .filter((job: any) => job.sessionId === sessionId)
    .map(({ controller, stop, output, error, ...job }: any) => ({ ...job }));
  for (const event of subagentEvents(sessionId)) {
    const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
    const producerJobId = typeof payload.memberId === "string" && state.jobsRegistry.has(payload.memberId)
      ? payload.memberId
      : undefined;
    if (producerJobId) continue;
    const id = typeof payload.runId === "string" ? payload.runId : typeof payload.id === "string" ? payload.id : undefined;
    if (!id) continue;
    const existing = jobs.find((job) => job.id === id);
    if (event.type === "subagent/start") {
      if (!existing) jobs.push({ id, kind: "subagent", label: typeof payload.role === "string" ? payload.role : "Subagent", status: "running", startedAt: Date.parse(event.timestamp) || Date.now() });
    } else if (existing) {
      existing.status = payload.stopReason === "cancelled" ? "killed" : payload.stopReason === "failed" ? "failed" : "completed";
      existing.finishedAt = Date.parse(event.timestamp) || Date.now();
    }
  }
  for (const task of state.runningTasks.values()) {
    if (task.sessionId !== sessionId) continue;
    if (!jobs.some((job) => job.id === task.id)) jobs.push({ id: task.id, kind: task.kind, label: task.description, sessionId, status: task.status === "failed" ? "failed" : task.status === "completed" ? "completed" : "running", startedAt: task.startedAt });
  }
  return jobs;
}

async function subagentHistory(
  parentSessionId: string,
  childSessionId: string,
  mode: "one-shot" | "continuable",
  beforeSeq?: number,
  maxMessages?: number,
): Promise<{ entries: unknown[]; hasMore: boolean }> {
  const child = state.continuableSubagents.get(childSessionId);
  if (child && (child.parentSessionId !== parentSessionId || child.mode !== mode)) throw Object.assign(new Error("subagent address does not match"), { code: "session-not-found" });
  let persistedManager: SessionManager | undefined;
  if (!child) {
    const sessions = await listAllPiSessions();
    const session = sessions.find((entry: any) => entry.id === childSessionId);
    const parent = session ? sessions.find((entry: any) => entry.path === session.parentSessionPath) : undefined;
    if (!session || parent?.id !== parentSessionId) throw Object.assign(new Error(`subagent not found: ${childSessionId}`), { code: "lookup-not-found" });
    persistedManager = SessionManager.open(session.path);
    const marker = persistedManager.getEntries().find((entry: any) => entry.type === "custom" && (entry as { customType?: unknown }).customType === "openbuddy/subagent") as { data?: unknown } | undefined;
    const data = marker?.data && typeof marker.data === "object" ? marker.data as Record<string, unknown> : undefined;
    if (data?.mode !== undefined && data.mode !== mode) throw Object.assign(new Error("subagent mode does not match"), { code: "session-not-found" });
  }
  const query = state.context?.get("sessionQuery") as { listEvents?: (sessionId: string) => Promise<unknown[]> } | undefined;
  if (query?.listEvents) {
    try {
      const entries = await query.listEvents(childSessionId);
      if (entries.length > 0 || child !== undefined) return paginateHistoryEntries(entries as Array<Record<string, unknown>>, beforeSeq, maxMessages);
    } catch {
      // Fall back to direct Pi inspection for a cold child or a partially loaded runtime.
    }
  }
  const liveSession = child?.session;
  let entries: unknown[];
  if (liveSession) {
    entries = liveSession.sessionManager.getEntries().map((entry, seq) => ({ ...entry, seq, sequence: seq }));
  } else {
    const manager = persistedManager;
    if (!manager) throw Object.assign(new Error(`subagent not found: ${childSessionId}`), { code: "lookup-not-found" });
    entries = manager.getEntries().map((entry, seq) => ({ ...entry, seq, sequence: seq }));
  }
  return paginateHistoryEntries(entries as Array<Record<string, unknown>>, beforeSeq, maxMessages);
}

export {
  listRunningTasks,
  listSubagentChildren,
  listSessionJobs,
  subagentHistory,
  promptSubagent,
  interruptSubagent,
  killTask,
  inspirationGenerate,
};

// ---------------------------------------------------------------------------
// Phase 8.3 Batch D4: write-side subagent surface extracted. Read-side
// (listRunningTasks / listSubagentChildren / listSessionJobs / subagentHistory)
// already lived here from D1. ensureContinuableSubagent stays in agent-host.ts
// — it is also called from initialize() at lines 3538-3598 to spin up the
// initial continuable child, so we keep its body local and re-export it for
// circular import here.
// ---------------------------------------------------------------------------

async function promptSubagent(
  parentSessionId: string,
  childSessionId: string,
  content: readonly PiPromptContentPart[],
): Promise<{ messageId: string }> {
  const child = await ensureContinuableSubagent(parentSessionId, childSessionId);
  const messageId = randomUUID();
  const parts = content.map((part) => part.type === "text"
    ? { type: "text" as const, text: part.text }
    : { type: "image" as const, data: part.data, mimeType: part.mediaType });
  void (child as any).session.sendUserMessage(parts).then(
    () => emitPluginEvent("subagent/settled", { sessionId: parentSessionId, parentSessionId, childSessionId, messageId, status: "completed" }),
    (error: any) => emitPluginEvent("subagent/settled", { sessionId: parentSessionId, parentSessionId, childSessionId, messageId, status: (child as any).controller.signal.aborted ? "cancelled" : "failed", error: String(error) }),
  );
  emitPluginEvent("subagent/prompt", { sessionId: parentSessionId, parentSessionId, childSessionId, messageId });
  return { messageId };
}

async function interruptSubagent(parentSessionId: string, childSessionId: string): Promise<{ accepted: true }> {
  const child = state.continuableSubagents.get(childSessionId);
  if (child?.parentSessionId === parentSessionId) {
    child.controller.abort();
    await child.session.abort().catch(() => undefined);
    emitPluginEvent("subagent/settled", { sessionId: parentSessionId, parentSessionId, childSessionId, status: "cancelled" });
  }
  return { accepted: true };
}

async function killTask(taskId: string): Promise<void> {
  const task = state.runningTasks.get(taskId);
  if (!task) return;
  state.runningTasks.delete(taskId);
  task.abortController?.abort();
  if (!state.toolRegistry.list().some((tool) => tool.name === task.kind)) await state.session?.abort();
}

async function inspirationGenerate(category: string, count: number, cwd?: string): Promise<{ sessionId: string; category: string; count: number }> {
  const runtime = state.modelRuntime;
  const model = state.model;
  const sessionId = `inspiration-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const request = `Return a JSON array with exactly ${count} short idea cards for the category "${category}". Each item must have title, summary, takeaway, and prompt. Do not use markdown fences.`;
  if (!runtime || !model) {
    emitPluginEvent("session/error", { sessionId, operation: "inspiration", error: "no model is configured" });
    emitRendererEvent("pi://error", { sessionId, error: "no model is configured" });
    emitRendererEvent("pi://complete", { sessionId, promptId: "", stopReason: "error" });
    return { sessionId, category, count: 0 };
  }
  const { session } = await createAgentSession({
    cwd: cwd ?? state.cwd ?? process.cwd(),
    agentDir: piHome(),
    model,
    modelRuntime: runtime,
    sessionManager: SessionManager.inMemory(),
  });
  session.subscribe((event) => {
    const payload = event as unknown as Record<string, any>;
    if (payload.type === "message_update" && payload.assistantMessageEvent?.type === "text_delta") {
      emitRendererEvent("pi://update", { sessionId, type: "agent_message_chunk", content: [{ type: "text", text: payload.assistantMessageEvent.delta }] });
    }
    if (payload.type === "agent_end" || payload.type === "agent_settled") {
      emitRendererEvent("pi://complete", { sessionId, promptId: "", stopReason: "end_turn" });
    }
  });
  void session.prompt(request).catch((error: any) => {
    emitPluginEvent("session/error", { sessionId, operation: "inspiration", error: String(error) });
    emitRendererEvent("pi://error", { sessionId, error: String(error) });
    emitRendererEvent("pi://complete", { sessionId, promptId: "", stopReason: "error" });
  }).finally(() => session.dispose());
  return { sessionId, category, count };
}