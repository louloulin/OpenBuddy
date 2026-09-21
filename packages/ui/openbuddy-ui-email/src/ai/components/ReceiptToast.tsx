/**
 * ReceiptToast — AI 行动回执浮层。
 *
 * 设计意图:把 useAiLoop 的 receipts 翻译成可视回执 + 30s 撤销按钮。
 * 与现有 Toast 系统并行 — 通过 `toast` 接口注册到 toast store。
 *
 * 视觉规则:
 *   - 已执行 + 0 失败 → 绿色,展示 "已执行 X 项 · 撤销"
 *   - 已执行 + N 失败 → 琥珀色,展示 "已执行 X · 失败 Y · 撤销"
 *   - 全失败 → 红色,展示 "失败 Y 项"
 */
import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { AiActionReceipt, UndoEntry } from "../types";

export interface ReceiptToastProps {
  receipts: AiActionReceipt[];
  undoEntry: UndoEntry | null;
  undoWindowMs?: number;
  onUndo: () => void;
  onDismiss: () => void;
  /** 自动消失时间(默认 = 撤销窗口)。 */
  autoHideMs?: number;
}

export function ReceiptToast({
  receipts,
  undoEntry,
  undoWindowMs = 30_000,
  onUndo,
  onDismiss,
  autoHideMs,
}: ReceiptToastProps): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, { enabled: receipts.length > 0 });
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  /** 当 toast 出现时,把焦点移到撤销按钮(30s 撤销窗口需要键盘可达)。 */
  useEffect(() => {
    if (receipts.length === 0) return;
    if (!undoEntry) return;
    const handle = window.setTimeout(() => undoButtonRef.current?.focus(), 60);
    return () => window.clearTimeout(handle);
  }, [receipts.length, undoEntry]);
  const executed = receipts.filter((r) => r.status === "executed");
  const failed = receipts.filter((r) => r.status === "failed");
  const tone: "success" | "warning" | "error" = failed.length === 0 ? "success" : executed.length === 0 ? "error" : "warning";
  const title = failed.length === 0
    ? `已执行 ${executed.length} 项`
    : executed.length === 0
    ? `失败 ${failed.length} 项`
    : `已执行 ${executed.length} 项 · 失败 ${failed.length}`;

  const hideAfter = autoHideMs ?? undoWindowMs;
  const [remaining, setRemaining] = useState<number>(() =>
    undoEntry ? Math.max(0, Math.ceil((undoWindowMs - (Date.now() - undoEntry.createdAt)) / 1000)) : 0,
  );

  useEffect(() => {
    if (!undoEntry) {
      setRemaining(0);
      return;
    }
    const handle = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((undoWindowMs - (Date.now() - undoEntry.createdAt)) / 1000));
      setRemaining(next);
      if (next <= 0) window.clearInterval(handle);
    }, 250);
    return () => window.clearInterval(handle);
  }, [undoEntry, undoWindowMs]);

  useEffect(() => {
    if (hideAfter <= 0) return;
    const handle = window.setTimeout(() => onDismiss(), hideAfter);
    return () => window.clearTimeout(handle);
  }, [hideAfter, onDismiss, receipts]);

  if (receipts.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="ai-receipt-toast"
      data-tone={tone}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="ai-receipt-toast__title">{title}</div>
      <div className="ai-receipt-toast__actions">
        {undoEntry && remaining > 0 ? (
          <button
            ref={undoButtonRef}
            type="button"
            className="ai-receipt-toast__undo"
            onClick={onUndo}
            data-testid="receipt-undo"
          >
            ↶ 撤销（{remaining}s）
          </button>
        ) : null}
        <button type="button" className="ai-receipt-toast__dismiss" onClick={onDismiss} aria-label="关闭回执">
          ✕
        </button>
      </div>
    </div>
  );
}
