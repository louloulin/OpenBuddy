/**
 * useComposerPaste — owns the textarea's `onPaste` callback.
 *
 * Two paths:
 *   1. Clipboard contains a file (image/* or document/* per
 *      `readImageFile`'s whitelist):
 *      - Read the file via `readImageFile(file, onToast)`.
 *      - Push into the images state (image attachments).
 *      - For image (kind !== "file") also synthesize a Markdown
 *        placeholder so the user sees a marker in the textarea.
 *      - Documents ship through `piSendContent` as `type:"file"` parts
 *        without an inline placeholder.
 *   2. Clipboard contains text:
 *      - Prefer Electron's native `clipboard.readText` (so cross-platform
 *        variants of "rich-text-as-plain-text" work); fall back to
 *      `event.clipboardData.getData("text/plain")`.
 *      - Insert at the caret (selectionStart/selectionEnd), restore focus
 *        + caret on next frame.
 *
 * Why a hook (not inline in Composer):
 *   - Composer.tsx is 700+ lines already and the onPaste block alone is
 *     ~80 lines; lifting it out drops Composer by a comparable amount
 *     and lets us unit-test the paste branch directly (planned).
 *   - Both inputs (`text`, `setImages`, `updateText`, `setCursorPos`,
 *     `ref`) are already stabilized by Composer's useCallback / useState,
 *     so wiring through them as props is cheap.
 */
import { useCallback, type ClipboardEvent, type RefObject } from "react";
import type { ImageAttachment } from "./types";
import { readImageFile } from "./send-payload";

const FILE_TYPE_RE =
  /^(application\/pdf|text\/(plain|markdown|csv|html|xml)|application\/(json|xml|yaml)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))$/i;

type PasteArgs = {
  /** Textarea ref (for focus + caret restoration). */
  ref: RefObject<HTMLTextAreaElement>;
  /** Current text state (used to splice the inserted snippet). */
  text: string;
  /** Push a new image attachment into the composer. */
  setImages: (updater: (prev: ImageAttachment[]) => ImageAttachment[]) => void;
  /** Splice the new text into state + raise the draft change callback. */
  updateText: (next: string) => void;
  /** Mirror the caret position so popovers / slash menu stay aligned. */
  setCursorPos: (pos: number) => void;
  /** Optional toast sink. */
  onToast?: (msg: string) => void;
  /** Optional Electron preload API; when absent, fall back to DOM event data. */
  electronApi?: { clipboard?: { readText?: () => Promise<string> } };
};

export function useComposerPaste({
  ref,
  text,
  setImages,
  updateText,
  setCursorPos,
  onToast,
  electronApi,
}: PasteArgs) {
  return useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const fileItem = Array.from(e.clipboardData.items ?? []).find(
        (it) =>
          it.kind === "file" &&
          (it.type.startsWith("image/") || FILE_TYPE_RE.test(it.type)),
      );
      if (fileItem) {
        e.preventDefault();
        const file = fileItem.getAsFile();
        if (!file) return;
        void readImageFile(file, onToast).then((att) => {
          if (!att) return;
          setImages((prev) => [...prev, att]);
          if (att.kind !== "file") {
            const ph = att.name ? `![pasted image: ${att.name}]()` : "![pasted image]()";
            const start = ref.current?.selectionStart ?? text.length;
            const end = ref.current?.selectionEnd ?? text.length;
            const next = text.slice(0, start) + ph + text.slice(end);
            updateText(next);
            const caret = start + ph.length;
            setCursorPos(caret);
            requestAnimationFrame(() => {
              if (ref.current) {
                ref.current.focus();
                ref.current.selectionStart = ref.current.selectionEnd = caret;
              }
            });
          }
        });
        return;
      }
      const eventText = e.clipboardData.getData("text/plain");
      const el = e.currentTarget;
      const start = el.selectionStart ?? text.length;
      const end = el.selectionEnd ?? text.length;
      e.preventDefault();
      const insert = (pasted: string) => {
        if (pasted.length === 0) return;
        const next = text.slice(0, start) + pasted + text.slice(end);
        updateText(next);
        const caret = start + pasted.length;
        setCursorPos(caret);
        requestAnimationFrame(() => {
          if (ref.current) {
            ref.current.focus();
            ref.current.selectionStart = ref.current.selectionEnd = caret;
          }
        });
      };
      const nativeReadText = electronApi?.clipboard?.readText;
      if (typeof nativeReadText !== "function") {
        insert(eventText);
        return;
      }
      void nativeReadText()
        .then((nativeText) => insert(nativeText || eventText))
        .catch(() => insert(eventText));
    },
    [ref, text, setImages, updateText, setCursorPos, onToast, electronApi],
  );
}
