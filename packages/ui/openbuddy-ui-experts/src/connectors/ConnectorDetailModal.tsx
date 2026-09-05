/**
 * Connector detail modal — shown when clicking a connector card.
 * Shows the icon, name, description, example prompts, the bundled mcp.json
 * config (when present), and a "配置连接" button that opens the MCP 管理 modal.
 */
import { useEffect, useRef, useState } from "react";
import type { ConnectorItem } from "@openbuddy/shared-types";
import { connectorsReadMcpConfig } from "@/lib/agent/pi-client";
import { ConnectorIcon } from "../shared/ConnectorIcon";
import { ConfigureIcon } from "@openbuddy/ui-primitives/icons";
import type { ConnectorAuthState } from "./ConnectorsTab";

interface Props {
  connector: ConnectorItem;
  /** Catalog root (needed to read the bundled mcp.json). */
  root: string;
  /** Current authorization state (drives badge + button labels). */
  authState?: ConnectorAuthState;
  onClose: () => void;
  /** Connect / authorize entry point. */
  onConfigure: () => void;
  /** 取消授权 (CLI connectors only). */
  onUnauth?: () => void;
  onToast?: (m: string) => void;
}

const STATE_LABEL: Record<ConnectorAuthState, string | null> = {
  none: null,
  installed: "已连接",
  authed: "已授权",
  "needs-auth": "待授权",
};

export function ConnectorDetailModal({
  connector, root, authState = "none", onClose, onConfigure, onUnauth, onToast,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [mcpConfig, setMcpConfig] = useState<string>("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Load the bundled mcp.json (if any) for the config preview.
  useEffect(() => {
    let disposed = false;
    setMcpConfig("");
    if (!root || !connector.source) return;
    connectorsReadMcpConfig(root, connector.source)
      .then((txt) => { if (!disposed) setMcpConfig(txt); })
      .catch(() => { if (!disposed) setMcpConfig(""); });
    return () => { disposed = true; };
  }, [root, connector.source]);

  const examples = (connector.examplesZh ?? []).filter(Boolean).slice(0, 8);
  const stateLabel = STATE_LABEL[authState];
  const primaryLabel =
    authState === "needs-auth" ? "去授权"
    : authState === "installed" || authState === "authed" ? "重新授权"
    : connector.authMode || connector.kind === "cli" ? "授权连接"
    : "配置连接";

  return (
    <div
      className="ec-modal-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="ec-modal">
        <button className="ec-modal-close" onClick={onClose} aria-label="关闭">×</button>

        <div className="ec-modal-header">
          <ConnectorIcon local={connector.iconLocal} name={connector.name} size={64} shape="square" root={root} />
          <div className="ec-modal-info">
            <div className="ec-modal-title">{connector.name}</div>
            <div className="ec-modal-meta">
              <span>{connector.kind === "unknown" ? "连接器" : connector.kind.toUpperCase()}</span>
              {connector.authMode && <><span className="ec-modal-dot">·</span><span>需授权</span></>}
              {stateLabel && (
                <><span className="ec-modal-dot">·</span>
                <span className={`cn-badge ${authState === "needs-auth" ? "cn-badge--warn" : "cn-badge--ok"}`}>
                  {stateLabel}
                </span></>
              )}
              {connector.nameEn && connector.nameEn !== connector.name && (
                <><span className="ec-modal-dot">·</span><span>{connector.nameEn}</span></>
              )}
            </div>
          </div>
        </div>

        {connector.desc && (
          <div className="ec-modal-section">
            <div className="ec-modal-section-title">能力介绍</div>
            <p className="ec-modal-desc">{connector.desc}</p>
          </div>
        )}

        {examples.length > 0 && (
          <div className="ec-modal-section">
            <div className="ec-modal-section-title">可以这样问我</div>
            <div className="ec-modal-quick-prompts">
              {examples.map((qp, i) => (
                <button
                  key={i}
                  className="ec-modal-qp-btn"
                  onClick={() => {
                    navigator.clipboard?.writeText(qp).then(
                      () => onToast?.("已复制到剪贴板"),
                      () => { /* clipboard blocked — ignore */ },
                    );
                  }}
                >
                  <span className="ec-modal-qp-text">"{qp}"</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {mcpConfig && (
          <div className="ec-modal-section">
            <div className="ec-modal-section-title">MCP 配置</div>
            <pre className="cn-modal-code"><code>{mcpConfig}</code></pre>
          </div>
        )}

        <div className="cn-modal-actions">
          <button className="ec-modal-summon-btn" onClick={onConfigure}>
            <ConfigureIcon size="sm" /><span style={{ marginLeft: 6 }}>{primaryLabel}</span>
          </button>
          {connector.kind === "cli" && authState === "authed" && onUnauth && (
            <button className="um-btn um-btn--grey" onClick={onUnauth}>取消授权</button>
          )}
        </div>
      </div>
    </div>
  );
}
