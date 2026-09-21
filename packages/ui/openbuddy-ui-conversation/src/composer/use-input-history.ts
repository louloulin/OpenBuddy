/**
 * composer/use-input-history — arrow-key recall for the Composer textarea.
 *
 * Goal mu7rpkze-gc769z / phase3-composer-split. The arrow-key recall
 * logic (↑/↓ to walk through the in-memory input history, draft
 * preservation on entry, caret reset on navigate) used to live inline
 * in `Composer.tsx` (~45 lines inside the textarea onKeyDown handler).
 * Phase-3 split moved it into this hook so the orchestrator file
 * stays under the 800-line cap.
 *
 * Behaviour contract:
 *  - On ArrowUp at the first line (or while already navigating), walk the
 *    history one step back. The current draft is stashed in `draftRef`
 *    on first entry so the user can return to it with ArrowDown.
 *  - On ArrowDown at the last line (or while already navigating), walk the
 *    history one step forward. When the cursor passes the end, restore
 *    the stashed draft.
 *  - `slashVisible` (from usePopovers) suppresses the recall so the
 *    slash-command menu keeps keyboard focus.
 *  - `isComposing` (Chinese IME) suppresses the recall so composition is
 *    not interrupted.
 *
 * The hook returns a stable `onKeyDown` handler suitable for passing to
 * `<textarea onKeyDown={onKeyDown}>`.
 */
import { useCallback, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject } from "react";
import { navigateHistory, type InputHistory } from "@/lib/ui/input-history";

export interface UseInputHistoryArgs {
  /** Textarea element ref (used to read selection and place caret). */
  ref: { current: HTMLTextAreaElement | null };
  /** Current text + cursor position (drives "at first/last line" detection). */
  text: string;
  cursorPos: number;
  /** Mutator that also syncs the persisted draft. */
  updateText: (next: string | ((prev: string) => string)) => void;
  /** When true (slash-command menu open or IME composing), suppress recall. */
  slashVisible: boolean;
  /** History refs from ComposerInner (kept loose-typed to avoid a cycle). */
  histRef: MutableRefObject<InputHistory>;
  histCursorRef: MutableRefObject<number>;
  draftRef: MutableRefObject<string>;
}

export interface UseInputHistoryResult {
  /** Stable onKeyDown handler — handles Enter (send) + ↑/↓ (recall). */
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
}

/**
 * Compose the textarea onKeyDown handler that wires Enter → send() and
 * ArrowUp/ArrowDown → history recall. The actual `send()` function is
 * captured by the caller via closure (see `onSend` below).
 */
export function useInputHistory(
  args: UseInputHistoryArgs & { onSend: () => void },
): UseInputHistoryResult {
  const { ref, text, cursorPos, updateText, slashVisible, histRef, histCursorRef, draftRef, onSend } = args;

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      // Enter → send (unless IME composing or slash menu visible)
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        if (slashVisible) return;
        e.preventDefault();
        onSend();
        return;
      }
      // ArrowUp / ArrowDown → history recall
      // Suppress during IME composition (Chinese input) and when slash menu is open.
      if (!slashVisible && !e.nativeEvent.isComposing) {
        const el = e.target as HTMLTextAreaElement;
        const atFirstLine = el.selectionStart === 0 || text.length === 0;
        const atLastLine = el.selectionStart === text.length;
        // Already navigating (cursor < items.length) → ↑/↓ keep paging
        // regardless of caret position (WorkBuddy use-input-history parity).
        const navigating = histCursorRef.current < histRef.current.items.length;
        if (e.key === "ArrowUp" && (atFirstLine || navigating)) {
          if (histCursorRef.current === histRef.current.items.length) {
            draftRef.current = text; // stash current draft on entry
          }
          const r = navigateHistory(histRef.current, histCursorRef.current, "up", draftRef.current);
          if (r.text !== text) {
            e.preventDefault();
            histCursorRef.current = r.cursor;
            updateText(r.text);
            requestAnimationFrame(() => {
              const t = ref.current;
              if (t) t.selectionStart = t.selectionEnd = r.text.length;
            });
          }
        } else if (e.key === "ArrowDown" && (atLastLine || navigating)) {
          const r = navigateHistory(histRef.current, histCursorRef.current, "down", draftRef.current);
          if (r.cursor !== histCursorRef.current) {
            e.preventDefault();
            histCursorRef.current = r.cursor;
            updateText(r.text);
            requestAnimationFrame(() => {
              const t = ref.current;
              if (t) t.selectionStart = t.selectionEnd = r.text.length;
            });
          }
        }
      }
    },
    [slashVisible, text, updateText, ref, histRef, histCursorRef, draftRef, onSend],
  );

  return { onKeyDown };
}