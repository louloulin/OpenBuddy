/**
 * OAuth-waiting modal — shown while pi drives the MCP browser OAuth flow
 * (x.ai/mcp/auth_trigger). pi opens the system browser itself; this modal
 * is the in-app "正在跳转授权" companion (mirrors workbuddy's redirect toast +
 * polling state), and surfaces the failure reason if the flow doesn't
 * complete.
 */
import { useEffect, useRef } from "react";
import type { ConnectorItem } from "@openbuddy/shared-types";
import { ConnectorIcon } from "../shared/ConnectorIcon";

interface Props {
  connector: ConnectorItem;
  root?: string;
  /** Failure detail from a completed-but-failed attempt. */
  error?: string;
  onClose: () => void;
}

export function ConnectorAuthModal({ connector, root, error, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="ec-modal-overlay" ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="ec-modal">
        <button type="button" className="ec-modal-close" onClick={onClose} aria-label="关闭">×</button>

        <div className="ec-modal-header">
          <ConnectorIcon local={connector.iconLocal} name={connector.name} size={48} shape="square" root={root} />
          <div className="ec-modal-info">
            <div className="ec-modal-title">{connector.name} 授权</div>
            <p className="ec-modal-desc">
              {error ? "授权未完成" : "已在系统浏览器中打开授权页面，请在浏览器中完成登录授权…"}
            </p>
          </div>
        </div>

        {error ? (
          <div className="cn-auth-error">
            <p>{error}</p>
            <p className="cn-auth-error-hint">
              该服务可能不支持标准 OAuth。你可以在「MCP 服务管理 → 配置 MCP」中手动填入凭证。
            </p>
          </div>
        ) : (
          <div className="cn-auth-waiting">
            <span className="cn-spinner" aria-hidden />
            <span>等待浏览器授权完成…</span>
          </div>
        )}

        <button type="button" className="um-btn um-btn--grey cn-auth-cancel" onClick={onClose}>
          {error ? "关闭" : "取消"}
        </button>
      </div>
    </div>
  );
}
