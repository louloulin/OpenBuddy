import { useCallback, useEffect, useState } from "react";
import { agentSessionInfo, agentSetMode, onSessionModelState, type AgentMode } from "@openbuddy/client/agent-client";
import { friendlyError } from "@openbuddy/chat-core/error-format";

/**
 * 做一做 / 想一想 / 问一问 per session (20261115-ui §5.3; persisted by the host since 20261116-pii W0.5).
 * The host owns the mode: it stores it on the conversation branch and reports it with every model
 * state (session opened, forked, branch switched, mode set). This hook mirrors that, so a session
 * opened again — even after a restart — shows the mode it was left in.
 */
export function useSessionMode(sessionId: string | null | undefined, toast: (message: string) => void) {
  const [modes, setModes] = useState<Record<string, AgentMode>>({});
  const remember = useCallback((id: string, mode: AgentMode) => setModes((m) => (m[id] === mode ? m : { ...m, [id]: mode })), []);
  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    void onSessionModelState((state) => { if (state.mode) remember(state.sessionId, state.mode); })
      .then((unlisten) => { if (disposed) unlisten(); else off = unlisten; })
      .catch(() => { /* no host events (tests): the mode stays local */ });
    return () => { disposed = true; off?.(); };
  }, [remember]);
  // A session that is already live reports nothing new on focus: ask it (null while not loaded yet).
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    agentSessionInfo(sessionId)
      .then((info) => { if (alive && info?.mode) remember(sessionId, info.mode); })
      .catch(() => {});
    return () => { alive = false; };
  }, [sessionId, remember]);
  const mode: AgentMode = (sessionId && modes[sessionId]) || "craft";
  const changeMode = useCallback(async (next: AgentMode) => {
    if (!sessionId) return;
    const id = sessionId;
    try {
      await agentSetMode(id, next);
      remember(id, next);
    } catch (e) { toast(`切换失败：${friendlyError(e)}`); }
  }, [sessionId, remember, toast]);
  return { mode, changeMode };
}
