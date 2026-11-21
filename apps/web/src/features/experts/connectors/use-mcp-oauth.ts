/**
 * MCP 授权尝试 (B3a): owns the per-connector sign-in queue, the attempt id and close=cancel.
 * Several MCP servers from one connector authorize in order; each step waits for the host's
 * `agent://mcp-auth` event instead of blocking a promise, so the modal can count down and cancel.
 */
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { mcpAuthBegin, mcpAuthCancel, onMcpAuthAttempt } from "@openbuddy/client/agent-client";
import type { ConnectorItem, McpAuthAttempt } from "@openbuddy/protocol/dto";

export type ConnectorAuthPhase =
  | { kind: "oauth"; connector: ConnectorItem; error?: string; attempt?: McpAuthAttempt }
  | { kind: "cli"; connector: ConnectorItem; url?: string; qrModal: boolean; logs: string[] };

export function useMcpOauthFlow(options: {
  setPhase: Dispatch<SetStateAction<ConnectorAuthPhase | null>>;
  onToast?: (message: string) => void;
  /** Called when a whole connector finished authorizing (refresh MCP status). */
  onSettled: () => void;
}) {
  const { setPhase, onToast, onSettled } = options;
  const flowRef = useRef<{ sessionId: string; connector: ConnectorItem; names: string[]; index: number } | null>(null);
  const dismissedRef = useRef(false);
  const currentAttemptRef = useRef<string | null>(null);

  const beginNext = useCallback(async () => {
    const flow = flowRef.current;
    if (!flow) return;
    const name = flow.names[flow.index];
    if (!name) {
      flowRef.current = null;
      currentAttemptRef.current = null;
      if (!dismissedRef.current) {
        setPhase(null);
        onToast?.(`「${flow.connector.name}」授权成功`);
      }
      onSettled();
      return;
    }
    try {
      const attempt = await mcpAuthBegin(flow.sessionId, name);
      currentAttemptRef.current = attempt.id;
      setPhase({ kind: "oauth", connector: flow.connector, attempt });
    } catch (e) {
      flowRef.current = null;
      currentAttemptRef.current = null;
      setPhase({ kind: "oauth", connector: flow.connector, error: String(e).replace(/^Error:\s*/, "") });
    }
  }, [onSettled, onToast, setPhase]);

  const start = useCallback(async (connector: ConnectorItem, sessionId: string, names: string[]) => {
    dismissedRef.current = false;
    flowRef.current = { sessionId, connector, names, index: 0 };
    setPhase({ kind: "oauth", connector });
    await beginNext();
  }, [beginNext, setPhase]);

  useEffect(() => {
    let un: (() => void) | undefined;
    onMcpAuthAttempt((attempt) => {
      const flow = flowRef.current;
      setPhase((phase) => {
        if (phase?.kind !== "oauth" || phase.attempt?.id !== attempt.id) return phase;
        if (attempt.status === "pending") return { ...phase, attempt };
        if (attempt.status === "authorized") {
          if (flow) {
            flow.index += 1;
            queueMicrotask(() => { void beginNext(); });
          }
          return { ...phase, attempt };
        }
        flowRef.current = null;
        currentAttemptRef.current = null;
        return { ...phase, attempt, ...(attempt.error ? { error: attempt.error } : {}) };
      });
    }).then((u) => { un = u; }).catch(() => { /* browser preview has no events */ });
    return () => { un?.(); };
  }, [beginNext, setPhase]);

  /** Closing the modal is a real cancellation: abort Pi's sign-in and its loopback listener. */
  const close = useCallback(() => {
    dismissedRef.current = true;
    flowRef.current = null;
    if (currentAttemptRef.current) void mcpAuthCancel(currentAttemptRef.current);
    currentAttemptRef.current = null;
    setPhase(null);
  }, [setPhase]);

  return { start, close };
}
