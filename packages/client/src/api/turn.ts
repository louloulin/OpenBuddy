// §5.3 `turn` module: agent_send, agent_steer, agent_follow_up, agent_cancel, agent_get_queue, agent_clear_queue, agent_set_queue.
import { invoke } from "../ipc";

/** Send a user prompt; streamed updates arrive via the events below. */
export async function agentSend(sessionId: string, text: string, attachments?: { path: string }[]): Promise<void> {
  await invoke<void>("agent_send", { sessionId, text, ...(attachments?.length ? { attachments } : {}) });
}

export interface AgentQueue { steering: string[]; followUp: string[] }
export const agentGetQueue = (sessionId: string) => invoke<AgentQueue>("agent_get_queue", { sessionId });
export const agentClearQueue = (sessionId: string) => invoke<AgentQueue>("agent_clear_queue", { sessionId });
/** Replace the pending queue (one item withdrawn, moved, or turned into 插话). */
export const agentSetQueue = (sessionId: string, steering: string[], followUp: string[]) => invoke<AgentQueue>("agent_set_queue", { sessionId, steering, followUp });
export const agentSteer = (sessionId: string, text: string, attachments?: { path: string }[]) => invoke<AgentQueue>("agent_steer", { sessionId, text, ...(attachments?.length ? { attachments } : {}) });
export const agentFollowUp = (sessionId: string, text: string, attachments?: { path: string }[]) => invoke<AgentQueue>("agent_follow_up", { sessionId, text, ...(attachments?.length ? { attachments } : {}) });

export async function agentCancel(sessionId: string): Promise<void> {
  await invoke<void>("agent_cancel", { sessionId });
}
