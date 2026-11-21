import { agentClearSessionExpert, agentSetSessionExpert, type SessionExpertInfo } from "@openbuddy/client/agent-client";
import type { AgentEntry, PiMessage } from "@openbuddy/protocol/dto";
import type { ExpertEntry } from "@openbuddy/protocol/experts";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import { parseUserText } from "@openbuddy/chat-core/user-text";
import { useSessionsStore } from "../features/sessions/state/sessions-store";
import { usePendingExpertStore } from "../features/experts";

/**
 * Task ↔ expert glue for the shell (20261116-pii W2.2/W2.3). The engine owns the binding (a session
 * entry: persona, model, thinking level, tools); the sidebar entry only mirrors it for the header badge.
 */
const WARNINGS: Record<string, string> = {
  model_unavailable: "专家指定的模型不可用，已沿用当前模型",
  model_auth_missing: "专家指定的模型尚未认证，已沿用当前模型",
};
const notice = (bound: SessionExpertInfo) => bound.warnings.map((w) => WARNINGS[w]).filter(Boolean).join("；") || undefined;

/**
 * Old-style sessions (before W2.2) had the persona injected into their first prompt; the engine
 * reports no binding for them, but their badge stays (sessionId → the badge it shows).
 */
const legacy = new Map<string, { name: string; avatar?: string }>();

/** The expert an old-style session's first prompt carries (`parseUserText`), if any. */
function legacyExpert(messages: readonly PiMessage[]): string | undefined {
  const first = messages.find((m) => m.role === "user");
  if (!first) return undefined;
  const text = typeof first.content === "string" ? first.content : first.content.map((p) => (p.type === "text" ? p.text ?? "" : "")).join("");
  return parseUserText(text).expert;
}

/**
 * Mirror the session's binding (from a load snapshot, a bind call or a model-state event, which
 * follows branch switches) into its sidebar entry. Without a binding, an old-style session keeps
 * the expert its first prompt carried.
 */
export function showSessionExpert(sessionId: string, expert: SessionExpertInfo | null | undefined) {
  const kept = expert ? undefined : legacy.get(sessionId);
  useSessionsStore.getState().upsert({ sessionId, expertId: expert?.id, expertName: expert?.name ?? kept?.name, expertAvatar: expert?.avatar ?? kept?.avatar });
}

/** A session was (re)loaded: remember an old-style injected expert, then mirror the binding. */
export function showLoadedExpert(sessionId: string, snapshot: { expert?: SessionExpertInfo | null; messages: readonly PiMessage[] }) {
  const injected = snapshot.expert ? undefined : legacyExpert(snapshot.messages);
  // A role preamble names the expert; the hidden persona block does not, so keep the badge shown so far.
  const state = useSessionsStore.getState();
  const shown = [...state.independent, ...Object.values(state.workspaceSessions).flat()].find((s) => s.sessionId === sessionId);
  const badge = injected === "persona" ? (shown?.expertName ? { name: shown.expertName, avatar: shown.expertAvatar } : undefined) : injected ? { name: injected } : undefined;
  if (badge) legacy.set(sessionId, badge);
  else if (!snapshot.expert) legacy.delete(sessionId);
  showSessionExpert(sessionId, snapshot.expert);
}

/** A new task was just created: bind the summoned (pending) expert before its first prompt. Returns a toast, if any. */
export async function bindPendingExpert(sessionId: string): Promise<string | undefined> {
  const pending = usePendingExpertStore.getState().expert;
  if (!pending) return undefined;
  usePendingExpertStore.getState().clear();
  try {
    const bound = await agentSetSessionExpert(sessionId, pending.expertId);
    showSessionExpert(sessionId, bound);
    return notice(bound);
  } catch (e) {
    return `专家「${pending.name}」未能应用：${friendlyError(e)}`;
  }
}

/** The header badge's ×: unbind and restore the task's own model, thinking level and tools. */
export async function clearSessionExpert(sessionId: string): Promise<string> {
  try {
    // Nothing bound in the engine: the × removes an old-style badge.
    if (!(await agentClearSessionExpert(sessionId))) legacy.delete(sessionId);
    showSessionExpert(sessionId, null);
    return "已移除专家，任务恢复原来的设置";
  } catch (e) {
    return `移除专家失败：${friendlyError(e)}`;
  }
}

/**
 * An expert picked from the composer's + menu (or the assistant rail): in an open task it is bound
 * right away; otherwise it becomes the pending expert of the next new task. Returns a toast.
 */
export async function selectExpert(agent: AgentEntry, sessionId: string | undefined): Promise<string | undefined> {
  const expert = agent as AgentEntry & Partial<ExpertEntry>;
  const id = expert.id ?? agent.name;
  if (sessionId) {
    try {
      const bound = await agentSetSessionExpert(sessionId, id);
      showSessionExpert(sessionId, bound);
      return notice(bound) ?? `已切换专家：${bound.name}`;
    } catch (e) {
      return `切换专家失败：${friendlyError(e)}`;
    }
  }
  usePendingExpertStore.getState().set({
    name: agent.name, prompt: "", description: agent.description ?? agent.name, expertId: id, source: agent.scope,
    avatarLocal: expert.image ?? expert.emoji,
  });
  return undefined;
}
