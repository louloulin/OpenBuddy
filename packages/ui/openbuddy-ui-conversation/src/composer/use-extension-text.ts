/**
 * composer/use-extension-text — hook owning the 5 useEffects that sync
 * the Composer textarea with externally-driven text sources.
 *
 * Goal mu7rpkze-gc769z / phase3-composer-split. The effects used to live
 * inline in `Composer.tsx` (autosize / extensionText / initialText /
 * externalText / draft). Extracting them into a single hook keeps
 * Composer's main file under the 800-line cap while preserving exact
 * behavior.
 */
import { useEffect, useRef, type MutableRefObject, type Dispatch, type SetStateAction } from "react";

/** Window event the host fires to put unsent text back into the composer. */
export const COMPOSER_RESTORE_EVENT = "openbuddy:composer-restore";

export function restoreComposerText(text: string): void {
  if (typeof window === "undefined" || !text.trim()) return;
  window.dispatchEvent(new CustomEvent(COMPOSER_RESTORE_EVENT, { detail: { text } }));
}

export interface UseExtensionTextArgs {
  ref: MutableRefObject<HTMLTextAreaElement | null>;
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  setCursorPos: (n: number) => void;
  /** One-shot seed: when `initialText` is set, fill the textarea and focus. */
  initialText?: string;
  onInitialTextConsumed?: () => void;
  /** Extension-driven text (nonce-keyed so repeated identical updates fire). */
  extensionText?: string;
  extensionTextNonce?: number;
  /** Controlled fill from external templates (nonce-keyed). */
  externalText?: string;
  externalTextNonce?: number;
  /** C1:展开态(不设高度上限)。 */
  expanded?: boolean;
  /** Persisted draft hydration: when draftKey changes, restore the draft. */
  draft?: string;
  draftKey?: string | number;
  updateText: (next: string | ((prev: string) => string)) => void;
}

/**
 * Owns the 5 useEffects:
 *   1. autosize — keep the textarea's height in lockstep with content (≤160px)
 *   2. extensionText — when a Pi extension writes through the bridge
 *   3. initialText — one-shot seed from a HomePage chip click
 *   4. externalText — controlled fill from a template
 *   5. draftKey — restore persisted draft when the active session changes
 *
 * Returning `void` keeps the call shape identical to inlining the
 * effects: Composer just invokes the hook between its other hooks.
 */
export function useExtensionText(args: UseExtensionTextArgs): void {
  const {
    ref,
    text,
    setText,
    setCursorPos,
    initialText,
    onInitialTextConsumed,
    extensionText,
    extensionTextNonce,
    externalText,
    externalTextNonce,
    draft,
    draftKey,
    updateText,
    /** C1:展开态 —— 不设上限,内容多高编辑区就多高(外层滚动接管)。 */
    expanded = false,
  } = args;

  // 1. Autosize: keep textarea height in lockstep with content.
  //    Cap 320px = CSS max-height(min(320px, 46vh))的 JS 侧对应值(原 160px
  //    与 CSS 不一致,"写长文被压扁");展开态不设上限。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = (expanded ? el.scrollHeight : Math.min(el.scrollHeight, 320)) + "px";
  }, [text, expanded]);

  const textRef = useRef(text);
  textRef.current = text;

  // 2. Extension-driven text. The nonce deliberately controls repeated
  //    identical extension updates so callers can re-emit without dedup.
  useEffect(() => {
    if (extensionTextNonce === undefined) return;
    updateText(extensionText ?? "");
    setCursorPos((extensionText ?? "").length);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    });
    // The nonce deliberately controls repeated identical extension updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensionTextNonce]);

  // 3. One-shot seed: when the parent supplies initialText, fill the
  //    textarea and focus it so the user can immediately edit/send.
  useEffect(() => {
    if (initialText !== undefined && initialText !== null) {
      updateText(initialText);
      setCursorPos(initialText.length);
      onInitialTextConsumed?.();
      requestAnimationFrame(() => ref.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);

  // 4. Controlled fill: clicking a template / switching a tag drives the
  //    parent component to write the content into the textarea and focus
  //    it. The nonce (not the text itself) is the dep so re-clicking the
  //    same template still re-fires.
  //    计划 2.1:不再无声覆盖用户自己写的草稿。输入框为空、或内容仍是上一次
  //    模板原样(没改过)时照旧替换,这样连点几个模板只保留最后一个;否则插到
  //    光标处,草稿原样保留。
  const lastInjectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (externalTextNonce === undefined) return;
    const injected = externalText ?? "";
    const { next, caret } = mergeInjectedText(textRef.current, injected, lastInjectedRef.current, ref.current?.selectionStart);
    lastInjectedRef.current = injected;
    updateText(next);
    setCursorPos(caret);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = caret;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTextNonce]);

  // 6. Send-failure restore: the host clears the composer optimistically on
  //    send; when the send then fails it dispatches COMPOSER_RESTORE_EVENT so
  //    the user's text comes back instead of being lost. Never clobbers
  //    something the user already started typing again.
  useEffect(() => {
    const onRestore = (event: Event) => {
      const restored = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (!restored || textRef.current.trim()) return;
      updateText(restored);
      setCursorPos(restored.length);
    };
    window.addEventListener(COMPOSER_RESTORE_EVENT, onRestore);
    return () => window.removeEventListener(COMPOSER_RESTORE_EVENT, onRestore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 5. Persisted draft hydration: when switching to another session
  //    (draftKey change), write the saved draft back to the textarea.
  //    Note: we use setText rather than updateText because this is a
  //    "restore", not user input — it must not trigger onDraftChange.
  useEffect(() => {
    if (draftKey === undefined) return;
    const next = draft ?? "";
    setText(next);
    setCursorPos(next.length);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el || el.disabled) return;
      el.focus();
      el.selectionStart = el.selectionEnd = next.length;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
}

/**
 * 把模板文本并入输入框(计划 2.1)。返回新内容与光标位置。
 *  - 输入框为空,或仍是上一次注入的原文(用户没改过):整体替换;
 *  - 否则在光标处插入(无光标信息时接在末尾),前后用空行隔开。
 */
export function mergeInjectedText(
  current: string,
  injected: string,
  lastInjected: string | null,
  selectionStart?: number | null,
): { next: string; caret: number } {
  if (!current.trim() || current === lastInjected) return { next: injected, caret: injected.length };
  if (!injected) return { next: current, caret: selectionStart ?? current.length };
  const at = Math.min(Math.max(selectionStart ?? current.length, 0), current.length);
  const before = current.slice(0, at);
  const after = current.slice(at);
  const lead = before && !before.endsWith("\n") ? "\n\n" : "";
  const tail = after && !after.startsWith("\n") ? "\n\n" : "";
  const next = `${before}${lead}${injected}${tail}${after}`;
  return { next, caret: before.length + lead.length + injected.length };
}

