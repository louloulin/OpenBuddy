
import { useEffect, useRef, useState } from "react";
import type { ConnectorItem } from "@openbuddy/protocol/dto";
import type { McpAuthAttempt } from "@openbuddy/protocol/dto";
import { copyText } from "@openbuddy/platform/clipboard";
import { useFocusTrap } from "@/shared/ui/use-focus-trap";
import { ConnectorIcon } from "../shared/ConnectorIcon";

interface Props {
  connector: ConnectorItem;
  /** Failure detail from a completed-but-failed attempt. */
  error?: string;
  /** Host-held attempt (B3a): id, expiry and live status. */
  attempt?: McpAuthAttempt;
  onClose: () => void;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function ConnectorAuthModal({ connector, error, attempt, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const pending = !attempt || attempt.status === "pending";

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);

  const remaining = attempt ? Math.max(0, attempt.expiresAt - now) : 0;
  const status = error || attempt?.status === "failed"
    ? "failed"
    : attempt?.status === "expired"
      ? "expired"
      : attempt?.status === "cancelled"
        ? "cancelled"
        : "pending";
  const detail = error ?? attempt?.error;
  const copyId = () => {
    if (!attempt) return;
    void copyText(attempt.id).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }, () => undefined);
  };

  return (
    <div className="ec-modal-overlay" ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="ec-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={`${connector.name} 授权`}>
        <button type="button" className="ec-modal-close" onClick={onClose} aria-label="关闭">×</button>

        <div className="ec-modal-header">
          <ConnectorIcon local={connector.iconLocal} name={connector.name} size={48} shape="square" />
          <div className="ec-modal-info">
            <div className="ec-modal-title">{connector.name} 授权</div>
            <p className="ec-modal-desc">
              {status === "pending" && "已在系统浏览器中打开授权页面，请在浏览器中完成登录授权…"}
              {status === "failed" && "授权未完成"}
              {status === "expired" && "授权已过期，请重新发起"}
              {status === "cancelled" && "已取消授权"}
            </p>
          </div>
        </div>

        {attempt && status === "pending" && (
          <div className="cn-auth-attempt">
            <div className="cn-auth-attempt__row">
              <span className="cn-auth-attempt__label">剩余时间</span>
              <span className="cn-auth-attempt__clock" role="timer" aria-live="off">{clock(remaining)}</span>
            </div>
            <div className="cn-auth-attempt__row">
              <span className="cn-auth-attempt__label">尝试 ID</span>
              <code className="cn-auth-attempt__id" title={attempt.id}>{attempt.id.slice(0, 8)}</code>
              <button type="button" className="ec-source-btn" onClick={copyId} title="复制尝试 ID">{copied ? "已复制" : "复制"}</button>
            </div>
          </div>
        )}

        {status === "failed" ? (
          <div className="cn-auth-error">
            <p>{detail ?? "授权失败"}</p>
            <p className="cn-auth-error-hint">
              该服务可能不支持标准 OAuth。你可以在「MCP 服务管理 → 配置 MCP」中手动填入凭证。
            </p>
          </div>
        ) : status === "pending" ? (
          <div className="cn-auth-waiting">
            <span className="cn-spinner" aria-hidden />
            <span>等待浏览器授权完成…</span>
          </div>
        ) : null}

        <button type="button" className="um-btn um-btn--grey cn-auth-cancel" onClick={onClose}>
          {status === "pending" ? "取消授权" : "关闭"}
        </button>
      </div>
    </div>
  );
}
