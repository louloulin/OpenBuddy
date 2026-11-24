/** 选中回答文字 → 浮动工具条的位置与文本 (plan 20261124 G1-22). */
export interface AnswerSelection {
  text: string;
  top: number;
  left: number;
}

const MAX_SELECTION = 4000;

/**
 * Only assistant answers participate: a selection in the input, a tool card,
 * thinking text or the sidebar never opens the toolbar. Returns null for a
 * collapsed/empty/foreign selection so the caller can clear stale state.
 */
export function answerSelection(root: HTMLElement | null, view: Window = window): AnswerSelection | null {
  if (!root) return null;
  const selection = view.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  if (!anchor || !focus || !root.contains(anchor) || !root.contains(focus)) return null;
  const start = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
  const end = focus.nodeType === Node.ELEMENT_NODE ? (focus as Element) : focus.parentElement;
  if (!start?.closest(".turn__answer") || !end?.closest(".turn__answer")) return null;
  const range = selection.getRangeAt(0);
  const rect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
  const viewWidth = view.innerWidth || 0;
  const rawLeft = rect ? rect.left + rect.width / 2 : 24;
  const rawTop = rect ? rect.top - 44 : 8;
  return {
    text: text.slice(0, MAX_SELECTION),
    // Keep the toolbar on screen; its own transform centres it on the selection.
    left: Math.min(Math.max(24, rawLeft), viewWidth ? viewWidth - 24 : rawLeft),
    top: Math.max(8, rawTop),
  };
}

/** Quote a selection into the composer, keeping the user's existing draft. */
export function quotedAnswerBlock(selected: string, quoteLines: (text: string) => string, source?: string): string {
  const quoted = quoteLines(selected);
  return source ? `${quoted}\n\n—— 来自${source}` : quoted;
}

/** Append a block to the current draft with a blank line between them. */
export function appendDraft(current: string, block: string): string {
  const head = current.trimEnd();
  return head ? `${head}\n\n${block}` : block;
}
