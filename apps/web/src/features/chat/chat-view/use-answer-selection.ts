import { useEffect, useState, type RefObject } from "react";
import { copyText } from "@openbuddy/platform/clipboard";
import { useStableCallback } from "./hooks";
import { quoteLines } from "./annotation";
import { answerSelection, quotedAnswerBlock, type AnswerSelection } from "./selection";

/**
 * Track text selected inside an assistant answer and offer the G1-22 actions.
 * The listeners live at the document level so a drag that starts in the answer
 * and ends elsewhere still resolves; the selection is dropped on outside
 * mousedown, Escape, scroll and when the composer consumes it.
 */
export function useAnswerSelection({
  root,
  insertBlock,
  source,
  onCopied,
  onQuickQa,
}: {
  root: RefObject<HTMLElement | null>;
  insertBlock: (block: string) => void;
  /** Human-readable origin quoted under the selected text. */
  source: string;
  onCopied: (message: string) => void;
  /** G1-31: open the quick-QA sheet for the selected text. */
  onQuickQa?: (text: string) => void;
}) {
  const [pick, setPick] = useState<AnswerSelection | null>(null);
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = answerSelection(root.current);
        setPick((prev) => (prev?.text === next?.text && prev?.top === next?.top && prev?.left === next?.left ? prev : next));
      });
    };
    const onDown = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.(".chatview-selection")) return;
      setPick(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPick(null); return; }
      if (event.shiftKey || event.key.startsWith("Arrow")) sync();
    };
    document.addEventListener("selectionchange", sync);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", sync);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [root]);

  const dismiss = useStableCallback(() => setPick(null));
  const apply = useStableCallback((block: (text: string) => string) => {
    if (!pick) return;
    insertBlock(block(pick.text));
    setPick(null);
    window.getSelection()?.removeAllRanges();
  });
  const ask = useStableCallback(() => apply((text) => `关于回答中的这段：\n${quoteLines(text)}\n\n我的问题：`));
  const quote = useStableCallback(() => apply((text) => quotedAnswerBlock(text, quoteLines, source)));
  const copy = useStableCallback(() => {
    if (!pick) return;
    const text = pick.text;
    setPick(null);
    window.getSelection()?.removeAllRanges();
    void copyText(text).then(() => onCopied("已复制"), () => onCopied("复制失败"));
  });
  /** G1-31: hand the selected text over (the quick-QA sheet asks about it). */
  const quickQa = useStableCallback(() => {
    if (!pick) return;
    const text = pick.text;
    setPick(null);
    window.getSelection()?.removeAllRanges();
    onQuickQa?.(text);
  });
  return { pick, dismiss, ask, quote, copy, quickQa };
}
