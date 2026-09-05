/**
 * CLI-connector authorization modal — mirrors workbuddy's
 * `ConnectorQrModalHost`. While `connectors_cli_auth` runs, the backend
 * streams the auth URL it scraped from the CLI's stdout; we render it as a
 * QR code (when the connector sets `authQrModal`, e.g. 企业微信) or as a
 * link + "open in browser" row otherwise. Closing the modal kills the
 * in-flight auth process.
 */
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Copy as CopyIcon } from "lucide-react";
import type { ConnectorItem } from "@openbuddy/shared-types";
import { openUrl } from "@/lib/agent/pi-client";
import { OpenExternalIcon } from "@openbuddy/ui-primitives/icons";
import { ConnectorIcon } from "../shared/ConnectorIcon";

interface Props {
  connector: ConnectorItem;
  root?: string;
  /** Auth URL scraped from the CLI output (empty until the CLI prints it). */
  url?: string;
  /** Render the URL as a QR code (cli.json `authQrModal`). */
  showQr: boolean;
  /** Log tail lines from the CLI (install progress, hints). */
  logs: string[];
  onCancel: () => void;
  onToast?: (m: string) => void;
}

export function ConnectorQrModal({ connector, root, url, showQr, logs, onCancel, onToast }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  useEffect(() => {
    setQrDataUrl("");
    if (!url || !showQr) return;
    let disposed = false;
    QRCode.toDataURL(url, { margin: 1, width: 220 })
      .then((d) => { if (!disposed) setQrDataUrl(d); })
      .catch(() => { /* fall back to the plain link row */ });
    return () => { disposed = true; };
  }, [url, showQr]);

  const copyUrl = () => {
    if (!url) return;
    navigator.clipboard?.writeText(url).then(
      () => onToast?.("已复制授权链接"),
      () => { /* clipboard blocked — ignore */ },
    );
  };

  return (
    <div className="ec-modal-overlay" ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onCancel(); }}>
      <div className="ec-modal">
        <button type="button" className="ec-modal-close" onClick={onCancel} aria-label="关闭">×</button>

        <div className="ec-modal-header">
          <ConnectorIcon local={connector.iconLocal} name={connector.name} size={48} shape="square" root={root} />
          <div className="ec-modal-info">
            <div className="ec-modal-title">{connector.name} 授权</div>
            <p className="ec-modal-desc">
              {url
                ? (showQr ? "请使用手机扫码完成授权" : "请打开以下链接完成授权")
                : "正在准备授权…"}
            </p>
          </div>
        </div>

        {url && showQr && qrDataUrl && (
          <div className="cn-qr-wrap">
            <img className="cn-qr-img" src={qrDataUrl} alt="授权二维码" />
          </div>
        )}

        {url && (
          <div className="cn-qr-linkrow">
            <span className="cn-qr-url" title={url}>{url}</span>
            <button type="button" className="ec-source-btn" onClick={copyUrl} title="复制链接">
              <CopyIcon size={14} />
            </button>
            <button type="button" className="ec-source-btn" onClick={() => openUrl(url)} title="在浏览器打开">
              <OpenExternalIcon size="sm" />
            </button>
          </div>
        )}

        {!url && (
          <div className="cn-auth-waiting">
            <span className="cn-spinner" aria-hidden />
            <span>{logs.length > 0 ? logs[logs.length - 1] : "正在启动授权命令…"}</span>
          </div>
        )}

        <button type="button" className="um-btn um-btn--grey cn-auth-cancel" onClick={onCancel}>
          取消授权
        </button>
      </div>
    </div>
  );
}
