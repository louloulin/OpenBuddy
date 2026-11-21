import { useState } from "react";
import { McpIcon, CloseIcon } from "@openbuddy/ui/icon/icons/index";
import { agentSend, mcpAuthTrigger } from "@openbuddy/client/agent-client";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import { useConnectorNeededStore } from "./state/connector-needed-store";

/**
 * 即时连接卡 (pii W2.5 / U7.4): shown above the composer while the session's last turn hit an MCP
 * server that is not authorized. 连接 starts OAuth right here (no need to open 连接器), then posts
 * 「已连接 X，继续」 so the turn can pick up where it stopped; × dismisses it.
 */
export function ConnectorNeededBar({ sessionId, onToast }: { sessionId?: string; onToast?: (m: string) => void }) {
  const need = useConnectorNeededStore((s) => (sessionId ? s.pending[sessionId] : undefined));
  const dismiss = useConnectorNeededStore((s) => s.dismiss);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!sessionId || !need) return null;

  const connect = async () => {
    setBusy(true); setError("");
    try {
      const result = await mcpAuthTrigger("", need.server);
      if (result.status === "authenticated") {
        dismiss(sessionId);
        await agentSend(sessionId, `已连接 ${need.server}，继续。`);
      } else if (result.status === "cancelled") {
        setError("授权已取消，可重试。");
      } else {
        setError(result.error ?? "授权失败，请检查该 MCP 的 OAuth 配置。");
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return <div className="connector-needed" role="status" aria-label={`需要连接 ${need.server}`}>
    <McpIcon size="sm" className="connector-needed__icon" />
    <span className="connector-needed__text">
      需要连接 <strong>{need.server}</strong>{need.tool ? ` 才能调用 ${need.tool}` : ""}
    </span>
    <button type="button" className="connector-needed__connect" disabled={busy} onClick={() => { void connect(); }}>
      {busy ? "授权中…" : "连接"}
    </button>
    <button type="button" className="connector-needed__close" title="忽略" onClick={() => { dismiss(sessionId); onToast?.("已忽略，可在连接器里手动授权"); }}>
      <CloseIcon size="sm" />
    </button>
    {error && <p className="connector-needed__error" role="alert">{error}</p>}
  </div>;
}
