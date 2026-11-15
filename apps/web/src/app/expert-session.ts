import { agentClearSessionExpert, agentSetSessionExpert, type SessionExpertInfo } from "@openbuddy/client/agent-client";
import type { AgentEntry } from "@openbuddy/protocol/dto";
import type { ExpertEntry } from "@openbuddy/protocol/experts";
import { friendlyError } from "@openbuddy/chat-core/error-format";
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

/** Mirror the session's binding (from a load snapshot or a bind call) into its sidebar entry. */
export function showSessionExpert(sessionId: string, expert: SessionExpertInfo | null | undefined) {
  useSessionsStore.getState().upsert({ sessionId, expertId: expert?.id, expertName: expert?.name, expertAvatar: expert?.avatar });
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
    await agentClearSessionExpert(sessionId);
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
