import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";
import { friendlyError, rawErrorText } from "@openbuddy/chat-core/error-format";
import type { ProviderTestResult } from "@openbuddy/client/agent-client";

export type TestState = { running: true } | ({ running: false } & ProviderTestResult);
export const errorText = (e: unknown) => rawErrorText(e) || friendlyError(e);

export function TestLine({ result }: { result: ProviderTestResult }) {
  const time = result.latencyMs >= 1000 ? `${(result.latencyMs / 1000).toFixed(1)}s` : `${result.latencyMs}ms`;
  if (!result.ok) return <div className="ms-test ms-test--fail" role="alert"><X size={12} />连接失败：{result.error}</div>;
  return (
    <div className="ms-test ms-test--ok" role="status">
      <Check size={12} />连接正常 · {time}
      {result.modelCount !== undefined && ` · ${result.modelCount} 个模型`}
      {result.reply !== undefined && ` · 回复：${result.reply || "（只有思考内容）"}`}
      {result.usage && ` · ${result.usage.input}/${result.usage.output} tokens`}
    </div>
  );
}

export function Dialog({ title, note, onClose, children, footer, wide }: { title: string; note?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input:not([disabled]), select")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="ms-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={"ms-dialog" + (wide ? " ms-dialog--wide" : "")} role="dialog" aria-modal="true" aria-label={title}>
        <header className="ms-dialog__head">
          <div>
            <div className="ms-dialog__title">{title}</div>
            {note && <div className="ms-dialog__note">{note}</div>}
          </div>
          <button type="button" className="ms-icon-btn" aria-label="关闭" onClick={onClose}><X size={14} /></button>
        </header>
        <div className="ms-dialog__body">{children}</div>
        <footer className="ms-dialog__foot">{footer}</footer>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="ms-field">
      <span className="ms-field__label">{label}</span>
      {children}
      {hint && <span className="ms-field__hint">{hint}</span>}
    </label>
  );
}
