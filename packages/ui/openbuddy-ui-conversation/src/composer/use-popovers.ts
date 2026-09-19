/**
 * composer/use-popovers — mention + slash-command popover state.
 *
 * Goal mu7rpkze-gc769z / phase3-composer-split. The mention picker,
 * slash-command visibility, anchor-rect tracking, and the two
 * pick-handlers used to live inline in `Composer.tsx` (~110 lines). Phase-3
 * split moved them into this hook so the orchestrator file stays under the
 * 800-line cap while preserving exact behavior.
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { OpenBuddyWorkspaceHit } from "@/lib/agent/pi-client";

// The single callsite below uses an inline `import("@/lib/agent/pi-client").OpenBuddyWorkspaceHit`
// in the useCallback signature; re-export the type alias so consumers can pass
// it through without reaching into the module themselves.
type WorkspaceHit = OpenBuddyWorkspaceHit;

export interface UsePopoversArgs {
  /** Textarea element ref (used by the anchor-rect measurement effect). */
  ref: { current: HTMLTextAreaElement | null };
  /** Current text + cursor position (drives slash detection + mention trigger). */
  text: string;
  cursorPos: number;
  apiReady: boolean;
  streaming: boolean;
  disabled?: boolean;
  /** Mutator that also syncs the persisted draft (used by mention select). */
  updateText: (next: string | ((prev: string) => string)) => void;
  /** Cursor setter (used to place the caret after a mention/slash pick). */
  setCursorPos: Dispatch<SetStateAction<number>>;
}

export interface UsePopoversResult {
  /** Mention picker state — null when closed. */
  mention: { start: number; query: string } | null;
  setMention: Dispatch<SetStateAction<{ start: number; query: string } | null>>;
  /** Anchor rect for portal-rendered popovers (R8.61). */
  anchorRect: DOMRect | null;
  /** Pick handler for the mention list (replaces `@query` with `@<path> `). */
  handleMentionSelect: (hit: WorkspaceHit) => void;
  /** Pick handler for slash commands (replaces `/xxx` with `command `). */
  handleSlashPick: (command: string) => void;
  /** Whether the slash menu should be visible (computed from cursor + text). */
  slashVisible: boolean;
}

/**
 * Owns all popover-related state and side effects for the Composer:
 *   - mention state + ref sync
 *   - anchor-rect measurement (resizes, scrolls, resize-observer)
 *   - window-level mention keydown listener
 *   - `@`-mention trigger detection
 *   - `handleMentionSelect` (callback, uses `text` + `cursorPos` + `updateText`)
 *   - `handleSlashPick` (plain function)
 *   - `slashVisible` (computed from cursor + text + apiReady + streaming)
 */
export function usePopovers(args: UsePopoversArgs): UsePopoversResult {
  const { ref, text, cursorPos, apiReady, streaming, disabled, updateText, setCursorPos } = args;

  // Mention picker state + ref mirror (read by the window-level keydown listener).
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const mentionRef = useRef(mention);
  useEffect(() => {
    mentionRef.current = mention;
  }, [mention]);

  // Anchor rect for the @-mention and slash-command popovers (rendered via
  // createPortal at document.body level so they are never clipped by
  // `.wb-composer`'s `overflow: hidden` or covered by sibling toolbars).
  // Recomputed on every text/cursor change, on window resize, and on scroll
  // of any ancestor.
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const anchorRectRef = useRef<DOMRect | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (
        !anchorRectRef.current ||
        Math.abs(r.top - anchorRectRef.current.top) > 0.5 ||
        Math.abs(r.left - anchorRectRef.current.left) > 0.5 ||
        Math.abs(r.width - anchorRectRef.current.width) > 0.5
      ) {
        anchorRectRef.current = r;
        setAnchorRect(r);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      if (ro) ro.disconnect();
    };
  }, [text, cursorPos, disabled]);

  // Window-level keydown listener that delegates to a globally-registered
  // mention keyboard handler if one is set up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!mentionRef.current) return;
      const fn = (
        window as Window & { __openbuddyMentionKeyDown?: (e: KeyboardEvent) => void }
      ).__openbuddyMentionKeyDown;
      if (fn) fn(e);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Slash-command visibility: is the user typing a "/xxx" command at the cursor?
  const wordBeforeCursor = (() => {
    const before = text.slice(0, cursorPos);
    const m = before.match(/\/[\w-]*$/);
    return m ? m[0] : "";
  })();
  const slashVisible = wordBeforeCursor.length > 0 && apiReady && !streaming;

  // Mention trigger detection: an `@` at the start of a token whose query
  // text follows. We intentionally do not depend on `mention` to avoid loops;
  // the effect reads/writes it through the conditional check.
  useEffect(() => {
    if (!apiReady || streaming) {
      if (mention) setMention(null);
      return;
    }
    const before = text.slice(0, cursorPos);
    const m = before.match(/(^|\s)@([\w./\\-]*)$/);
    if (m) {
      const query = m[2];
      const at = before.lastIndexOf("@", cursorPos);
      setMention({ start: at, query });
    } else {
      if (mention) setMention(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, cursorPos, apiReady, streaming]);

  // Mention pick: replace the `@query` token with `@<path> `.
  const handleMentionSelect = useCallback(
    (hit: WorkspaceHit) => {
      if (!mention) return;
      const before = text.slice(0, mention.start);
      const after = text.slice(cursorPos);
      const inserted = `@${hit.path} `;
      const next = before + inserted + after;
      updateText(next);
      const newCursor = before.length + inserted.length;
      setCursorPos(newCursor);
      setMention(null);
      requestAnimationFrame(() => {
        if (ref.current) {
          ref.current.focus();
          ref.current.selectionStart = ref.current.selectionEnd = newCursor;
        }
      });
    },
    [mention, text, cursorPos, updateText, setCursorPos],
  );

  // Slash pick: replace the `/xxx` fragment (up to cursor) with the picked
  // command + " ".
  const handleSlashPick = (command: string) => {
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const newBefore = before.replace(/\/[\w-]*$/, command + " ");
    const next = newBefore + after;
    updateText(next);
    const newPos = newBefore.length;
    setCursorPos(newPos);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = newPos;
    });
  };

  return {
    mention,
    setMention,
    anchorRect,
    handleMentionSelect,
    handleSlashPick,
    slashVisible,
  };
}