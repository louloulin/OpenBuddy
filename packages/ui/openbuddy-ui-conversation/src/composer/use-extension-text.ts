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
import { useEffect, type MutableRefObject, type Dispatch, type SetStateAction } from "react";

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
  } = args;

  // 1. Autosize: keep textarea height in lockstep with content (capped at 160px).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [text]);

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
  useEffect(() => {
    if (externalTextNonce === undefined) return;
    const next = externalText ?? "";
    updateText(next);
    setCursorPos(next.length);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = next.length;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTextNonce]);

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