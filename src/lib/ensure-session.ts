import { agentGetModelState, agentNewSession } from "./agent-client";
import { useSessionStore } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useAgentModelStore } from "@/stores/agent-model-store";

let creating: Promise<string> | undefined;
export async function ensureSession(): Promise<string> {
  const existing = useSessionStore.getState().sessionId;
  if (existing) return existing;
  if (creating) return creating;
  const cwd = useSessionsStore.getState().homeCwd;
  if (!cwd) throw new Error("会话尚未就绪（缺少工作目录），请先发起一个任务");
  creating = (async () => {
    const sessionId = await agentNewSession(cwd, useAgentModelStore.getState().homeModelKey);
    const state = await agentGetModelState(sessionId);
    useAgentModelStore.getState().apply(state);
    useSessionsStore.getState().setCurrent(sessionId);
    useSessionsStore.getState().upsert({ sessionId, title: "新任务", cwd, status: "completed" });
    useSessionStore.getState().setSession(sessionId);
    return sessionId;
  })();
  try { return await creating; } finally { creating = undefined; }
}
