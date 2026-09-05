/**
 * ensureSession — return the live sessionId, creating a session lazily when
 * none exists yet.
 *
 * Several pi extension methods (`x.ai/mcp/upsert`, `x.ai/mcp/auth_trigger`,
 * …) are session-scoped, but sessions are normally only created when the
 * user sends their first prompt. Connector authorization needs one earlier,
 * so we create it on demand — same pattern as App.tsx `handleSendNew`.
 */
import { piNewSession } from "./pi-client";
import { useSessionStore } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";

export async function ensureSession(): Promise<string> {
  const existing = useSessionStore.getState().sessionId;
  if (existing) return existing;

  const cwd = useSessionsStore.getState().homeCwd;
  if (!cwd) throw new Error("会话尚未就绪（缺少工作目录），请先发起一个任务");

  const sessionId = await piNewSession(cwd);
  useSessionsStore.getState().setCurrent(sessionId);
  useSessionsStore.getState().upsert({ sessionId, title: "新任务", cwd, status: "completed" });
  useSessionStore.getState().setSession(sessionId);
  return sessionId;
}
