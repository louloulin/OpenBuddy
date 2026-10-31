/**
 * useComposerPaste — owns the textarea's `onPaste` callback.
 *
 *   1. Clipboard contains a file (image/* or a supported document):
 *      read it and add it as an attachment chip. Nothing is written into the
 *      prompt text (this used to inject a literal `![pasted image]()`).
 *   2. Text: prefer Electron's `clipboard.readText` (keeps very large pastes
 *      intact), falling back to the DOM text. The result is spliced into the
 *      textarea's live value and selection — the old path spliced into a
 *      render-time snapshot and dropped keystrokes typed during the IPC read.
 *      Insertion uses `execCommand("insertText")` when available so the
 *      paste stays on the native undo stack.
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
          if (att) setImages((prev) => [...prev, att]);
        });
        return;
      }
      const domText = e.clipboardData.getData("text/plain");
      const nativeReadText = electronApi?.clipboard?.readText;
      if (!domText && typeof nativeReadText !== "function") return;
      e.preventDefault();
      // Splice into the live value/selection, not the render-time snapshot,
      // so keystrokes typed while the IPC read is in flight are kept.
      const insert = (pasted: string) => {
        const el = ref.current;
        const current = el?.value ?? text;
        const start = el?.selectionStart ?? current.length;
        const end = el?.selectionEnd ?? current.length;
        const caret = start + pasted.length;
        // insertText goes through the browser's edit stack, so Cmd+Z undoes
        // the paste; its input event drives the controlled onChange.
        if (el && typeof el.setSelectionRange === "function" && typeof document.execCommand === "function") {
          el.focus();
          el.setSelectionRange(start, end);
          if (document.execCommand("insertText", false, pasted)) {
            setCursorPos(caret);
            return;
          }
        }
        updateText(current.slice(0, start) + pasted + current.slice(end));
        setCursorPos(caret);
        requestAnimationFrame(() => {
          if (ref.current) {
            ref.current.focus();
            ref.current.selectionStart = ref.current.selectionEnd = caret;
          }
        });
      };
      if (typeof nativeReadText !== "function") {
        insert(domText);
        return;
      }
      // Electron's clipboard keeps very large text intact; DOM text is the fallback.
      void nativeReadText()
        .then((pasted) => insert(pasted || domText))
        .catch(() => {
          if (domText) insert(domText);
        });
    },
    [ref, text, setImages, updateText, setCursorPos, onToast, electronApi],
  );
}
