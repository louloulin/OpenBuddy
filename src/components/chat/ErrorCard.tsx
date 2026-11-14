import { useState } from "react";
import { describeError } from "@/lib/error-format";
import { copyText } from "@openbuddy/platform/clipboard";
import { AlertGlyph, ChevronGlyph } from "./icons";

/** Open 设置 at a section (App listens for this event). */
export function openSettings(section?: string) {
  window.dispatchEvent(new CustomEvent("openbuddy:open-settings", { detail: { section } }));
}

/** Inline error inside the turn that failed: one friendly sentence, raw detail on demand. */
export function ErrorCard({ error, onRetry, onToast }: { error: string; onRetry?: () => void; onToast?: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const d = describeError(error);
  return (
    <div className="turn-error" role="alert">
      <div className="turn-error__head">
        <span className="turn-error__icon"><AlertGlyph /></span>
        <div className="turn-error__text">
          <div className="turn-error__title">{d.title}</div>
          {d.hint && <div className="turn-error__hint">{d.hint}</div>}
        </div>
      </div>
      {open && <pre className="turn-error__raw">{d.raw}</pre>}
      <div className="turn-error__actions">
        {d.raw && d.raw !== d.title && (
          <button type="button" className="turn-error__link" onClick={() => setOpen((v) => !v)}>
            <ChevronGlyph open={open} /> {open ? "收起原始错误" : "查看原始错误"}
          </button>
        )}
        <span className="turn-error__spacer" />
        <button type="button" className="turn-error__btn" onClick={() => copyText(d.raw).then(() => onToast?.("已复制错误信息"), () => onToast?.("复制失败"))}>复制</button>
        {(d.action === "settings" || d.action === "model") && (
          <button type="button" className="turn-error__btn" onClick={() => openSettings("model")}>{d.action === "model" ? "切换模型" : "去设置"}</button>
        )}
        {onRetry && d.action !== "settings" && (
          <button type="button" className="turn-error__btn turn-error__btn--primary" onClick={onRetry}>重试</button>
        )}
      </div>
    </div>
  );
}
