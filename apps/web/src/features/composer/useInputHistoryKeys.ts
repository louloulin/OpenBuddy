import { useRef, type KeyboardEvent, type RefObject } from "react";
import { loadInputHistory, navigateHistory, pushHistory, saveInputHistory, type InputHistory } from "@/features/composer/input-history";

/**
 * 输入历史 arrow-key recall (对齐 WorkBuddy use-input-history), moved out of Composer unchanged:
 * ↑ at the first line (or while already browsing) steps back through sent prompts, ↓ forward;
 * the draft typed before browsing comes back at the end.
 */
export function useInputHistoryKeys(text: string, updateText: (next: string) => void, ref: RefObject<HTMLTextAreaElement>) {
  const histRef = useRef<InputHistory>(loadInputHistory(100));
  const histCursorRef = useRef<number>(histRef.current.items.length);
  const draftRef = useRef<string>("");
  const caretToEnd = (value: string) => requestAnimationFrame(() => {
    const t = ref.current;
    if (t) t.selectionStart = t.selectionEnd = value.length;
  });
  return {
    /** 记入输入历史 after a send. */
    remember(body: string) {
      if (!body || !body.trim()) return;
      histRef.current = pushHistory(loadInputHistory(100), body);
      saveInputHistory(histRef.current);
      histCursorRef.current = histRef.current.items.length;
      draftRef.current = "";
    },
    /** 手动输入时把历史游标重置回末尾(回到「输入框」态)。 */
    resetCursor() {
      histCursorRef.current = histRef.current.items.length;
    },
    onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
      const el = e.target as HTMLTextAreaElement;
      const atFirstLine = el.selectionStart === 0 || text.length === 0;
      const atLastLine = el.selectionStart === text.length;
      // 已在历史导航中(cursor < items.length)时,↑/↓ 持续翻页,不受光标位置约束。
      const navigating = histCursorRef.current < histRef.current.items.length;
      if (e.key === "ArrowUp" && (atFirstLine || navigating)) {
        if (histCursorRef.current === histRef.current.items.length) {
          draftRef.current = text; // 进入历史前暂存当前草稿
          // Another composer (home / another chat) may have added prompts since.
          histRef.current = loadInputHistory(100);
          histCursorRef.current = histRef.current.items.length;
        }
        const r = navigateHistory(histRef.current, histCursorRef.current, "up", draftRef.current);
        if (r.text !== text) {
          e.preventDefault();
          histCursorRef.current = r.cursor;
          updateText(r.text);
          caretToEnd(r.text);
        }
      } else if (e.key === "ArrowDown" && (atLastLine || navigating)) {
        const r = navigateHistory(histRef.current, histCursorRef.current, "down", draftRef.current);
        if (r.cursor !== histCursorRef.current) {
          e.preventDefault();
          histCursorRef.current = r.cursor;
          updateText(r.text);
          caretToEnd(r.text);
        }
      }
    },
  };
}
