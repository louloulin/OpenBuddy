import { Copy, MessageCircleQuestion, Quote, Zap } from "lucide-react";
import type { AnswerSelection } from "./selection";

/**
 * Floating actions for text selected inside an assistant answer (G1-22).
 * Position is fixed by the caller; the buttons keep the DOM selection alive
 * on mousedown so copying/quoting sees the same range.
 */
export function SelectionToolbar({
  selection,
  onAsk,
  onQuote,
  onCopy,
  onQuickQa,
  onDismiss,
}: {
  selection: AnswerSelection;
  onAsk: () => void;
  onQuote: () => void;
  onCopy: () => void;
  /** G1-31: ask about this fragment in a throwaway session. */
  onQuickQa?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="chatview-selection"
      role="toolbar"
      aria-label="选中文字操作"
      aria-keyshortcuts="Escape"
      style={{ top: selection.top, left: selection.left }}
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onDismiss(); } }}
    >
      <button type="button" className="chatview-selection__btn" onClick={onAsk} aria-label="问这段">
        <MessageCircleQuestion size={13} aria-hidden /> 问这段
      </button>
      <button type="button" className="chatview-selection__btn" onClick={onQuote} aria-label="引用到输入框">
        <Quote size={13} aria-hidden /> 引用
      </button>
      <button type="button" className="chatview-selection__btn" onClick={onCopy} aria-label="复制选中文字">
        <Copy size={13} aria-hidden /> 复制
      </button>
      {onQuickQa && (
        <button type="button" className="chatview-selection__btn" onClick={onQuickQa} aria-label="快速问答">
          <Zap size={13} aria-hidden /> 快速问答
        </button>
      )}
    </div>
  );
}
