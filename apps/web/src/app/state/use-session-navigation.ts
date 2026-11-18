import { useEffect, useState } from "react";
import { useSessionsStore } from "@/features/sessions/state/sessions-store";
import { useSessionStore } from "@/features/chat/state/session-store";
import { agentRenameSession } from "@openbuddy/client/agent-client";
import { friendlyError } from "@openbuddy/chat-core/error-format";

export interface HandoffOrigin {
  sessionId: string;
  title?: string;
}

/**
 * 分叉与交接 (pii W1.7): both open a new session in the engine and then navigate the
 * renderer to it. Fork renames the copy; handoff pre-fills a self-contained draft and
 * remembers where it came from so the transcript can show the banner.
 */
export function useSessionNavigation(options: {
  getCwd: () => string | undefined;
  getSourceTitle?: () => string | undefined;
  setPlaceholderView: (view: string | null) => void;
  openSession: (id: string, cwd?: string, force?: boolean) => Promise<unknown>;
}) {
  const [handoffFrom, setHandoffFrom] = useState<HandoffOrigin | null>(null);
  const go = async (newId: string, title: string, draft?: string) => {
    const cwd = options.getCwd();
    options.setPlaceholderView(null);
    useSessionsStore.getState().setCurrent(newId);
    useSessionsStore.getState().upsert({ sessionId: newId, title, cwd, updatedAt: new Date().toISOString() });
    if (draft) useSessionsStore.getState().setDraft(newId, draft);
    useSessionStore.getState().setSession(newId);
    try { await options.openSession(newId, cwd, true); }
    catch (error) { useSessionStore.getState().setError(friendlyError(error), newId); }
  };
  const openForked = async (newId: string) => {
    const source = options.getSourceTitle?.();
    await go(newId, source ? `${source}（分叉）` : "分叉任务");
    await agentRenameSession(newId, source ? `${source}（分叉）` : "分叉任务", options.getCwd()).catch(() => {});
  };
  const openHandoff = (newId: string, prompt: string) => go(newId, "交接任务", prompt);
  return { handoffFrom, setHandoffFrom, openForked, openHandoff };
}

/**
 * 独立会话窗口 (pii W7.1): the main process opens `#/session/<id>`; open that session
 * once the app has initialized.
 */
export function useSessionRoute(ready: boolean, open: (sessionId: string) => void): void {
  useEffect(() => {
    if (!ready) return;
    const match = window.location.hash.match(/^#\/session\/([^/?#]+)$/);
    if (match) open(decodeURIComponent(match[1]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}
