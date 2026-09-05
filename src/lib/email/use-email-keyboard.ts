import { useEffect } from "react";
import type { EmailThread, EmailThreadPreview } from "@/lib/agent/pi-client";

export type EmailUpdateKind =
  | "archive"
  | "trash"
  | "spam"
  | "star"
  | "mark-read"
  | "mark-unread"
  | "label-add"
  | "label-remove";

export type EmailFolder =
  | "inbox"
  | "sent"
  | "drafts"
  | "scheduled"
  | "pending"
  | "snoozed"
  | "starred"
  | "important"
  | "archive"
  | "trash"
  | "spam";

export interface EmailComposerInitial {
  accountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  threadId?: string;
  messageId?: string;
}

export interface EmailConfirmRequest {
  title: string;
  description: string;
  tone?: "danger" | "warning" | "info";
  confirmLabel?: string;
}

export interface EmailKeyboardIntent {
  /** Current selected thread, or null when in list view. */
  selected: EmailThread | null;
  /** Whether the composer modal is currently open. */
  composerOpen: boolean;
  /** Current search query text. */
  query: string;
  /** Whether the advanced search filters panel is open. */
  searchFiltersOpen: boolean;
  /** Whether the registry "add connection" modal is open. */
  registryAddOpen: boolean;
  /** Whether the user is mid-way through a c+e / c+r / c+a chord. */
  composeChord: boolean;
  /** Currently focused row index in the list. */
  focusedIndex: number;
  /** Visible threads in the list view. */
  visibleThreads: EmailThreadPreview[];
  /** Currently focused message index in the thread detail. */
  messageIndex: number;

  // ── Actions (called by the hook) ──────────────────────────────────────────
  /** Close the thread detail and clear bulk selection. */
  clearSelection: () => void;
  /** Move focus to the next/previous row. */
  setFocusedIndex: (updater: (current: number) => number) => void;
  /** Move focus to the next/previous message within a thread. */
  setMessageIndex: (updater: (current: number) => number) => void;
  /** Open the keyboard-help modal. */
  showKeyboardHelp: () => void;
  /** Close the composer modal. */
  closeComposer: () => void;
  /** Clear the search query and reload the list. */
  clearQuery: () => Promise<void>;
  /** Open or close the advanced search filters panel. */
  setSearchFiltersOpen: (open: boolean) => void;
  /** Open or close the registry add-connection modal. */
  setRegistryAddOpen: (open: boolean) => void;
  /** Switch the folder/tab being viewed. */
  setFolder: (folder: EmailFolder) => void;
  /** Open the composer with optional draft seed. */
  startCompose: (initial?: EmailComposerInitial) => void;
  /** Open a thread by id. */
  openThread: (thread: EmailThreadPreview) => Promise<void>;
  /** Send a reply (alt: reply-all). */
  reply: (all: boolean) => Promise<void>;
  /** Update a thread attribute (archive/star/etc.). */
  update: (kind: EmailUpdateKind, force?: boolean) => Promise<void>;
  /** Show a confirmation dialog and return whether the user confirmed. */
  requestConfirm: (opts: EmailConfirmRequest) => Promise<boolean>;
  /** Set / clear the compose chord state. */
  setComposeChord: (active: boolean) => void;
  /** Toggle the AI action center (g+a chord). */
  toggleActionCenter: () => void;
}

const CHORD_TIMEOUT_MS = 800;
const COMPOSE_CHORD_TIMEOUT_MS = 1200;

/**
 * Macro-style keyboard workflow hook. Attaches a single keydown listener to
 * the window and dispatches to the intent object. Keeps EmailPanel focused
 * on rendering, while this hook owns the keyboard-state machine.
 */
export function useEmailKeyboard(intent: EmailKeyboardIntent): void {
  useEffect(() => {
    let pendingG: ReturnType<typeof setTimeout> | undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;

      if (key === "Escape") {
        if (intent.selected) {
          event.preventDefault();
          intent.clearSelection();
          return;
        }
        if (intent.composerOpen) {
          event.preventDefault();
          intent.closeComposer();
          return;
        }
        if (intent.query) {
          event.preventDefault();
          void intent.clearQuery();
          return;
        }
        if (intent.searchFiltersOpen) {
          event.preventDefault();
          intent.setSearchFiltersOpen(false);
          return;
        }
        if (intent.registryAddOpen) {
          event.preventDefault();
          intent.setRegistryAddOpen(false);
          return;
        }
        if (pendingG) {
          clearTimeout(pendingG);
          pendingG = undefined;
          return;
        }
      }

      if (key === "/" && !intent.selected) {
        event.preventDefault();
        const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索邮件"]');
        if (input) input.focus();
        return;
      }

      if (key === "?") {
        event.preventDefault();
        intent.showKeyboardHelp();
        return;
      }

      if (key === "j") {
        event.preventDefault();
        intent.setFocusedIndex((index) => Math.min(index + 1, intent.visibleThreads.length - 1));
        return;
      }
      if (key === "k") {
        event.preventDefault();
        intent.setFocusedIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (key === "J" && intent.selected) {
        event.preventDefault();
        intent.setMessageIndex((index) => Math.min(index + 1, intent.selected!.messages.length - 1));
        return;
      }
      if (key === "K" && intent.selected) {
        event.preventDefault();
        intent.setMessageIndex((index) => Math.max(index - 1, 0));
        return;
      }

      if (key === "Enter" && intent.visibleThreads[intent.focusedIndex]) {
        event.preventDefault();
        void intent.openThread(intent.visibleThreads[intent.focusedIndex]);
        return;
      }

      if (key === "g" && !pendingG) {
        pendingG = setTimeout(() => {
          pendingG = undefined;
        }, CHORD_TIMEOUT_MS);
        return;
      }
      if (key === "i" && pendingG) {
        event.preventDefault();
        clearTimeout(pendingG);
        pendingG = undefined;
        intent.setFolder("inbox");
        return;
      }
      if (key === "s" && pendingG) {
        event.preventDefault();
        clearTimeout(pendingG);
        pendingG = undefined;
        intent.setFolder("sent");
        return;
      }
      if (key === "d" && pendingG) {
        event.preventDefault();
        clearTimeout(pendingG);
        pendingG = undefined;
        intent.setFolder("drafts");
        return;
      }
      if (key === "t" && pendingG) {
        event.preventDefault();
        clearTimeout(pendingG);
        pendingG = undefined;
        intent.setFolder("starred");
        return;
      }
      if (key === "a" && pendingG) {
        event.preventDefault();
        clearTimeout(pendingG);
        pendingG = undefined;
        intent.toggleActionCenter();
        return;
      }

      if (key === "c" && !intent.composeChord) {
        event.preventDefault();
        intent.setComposeChord(true);
        window.setTimeout(() => intent.setComposeChord(false), COMPOSE_CHORD_TIMEOUT_MS);
        return;
      }
      if (key === "e" && intent.composeChord) {
        event.preventDefault();
        intent.startCompose();
        intent.setComposeChord(false);
        return;
      }

      if (key === "e" && intent.selected) {
        event.preventDefault();
        void intent.update("archive");
        return;
      }
      if (key === "u" && intent.selected) {
        event.preventDefault();
        const hasUnread = intent.selected.messages.some((message) => message.unread);
        void intent.update(hasUnread ? "mark-read" : "mark-unread");
        return;
      }
      if (key === "s" && intent.selected) {
        event.preventDefault();
        void intent.update("star");
        return;
      }
      if (key === "#" && intent.selected) {
        event.preventDefault();
        void intent
          .requestConfirm({
            title: "移入垃圾箱",
            description: "确认将此线程移入垃圾箱？此操作会改变远端邮箱状态。",
            tone: "danger",
            confirmLabel: "移入垃圾箱",
          })
          .then((ok) => {
            if (ok) void intent.update("trash", true);
          });
        return;
      }
      if (key === "r" && intent.selected) {
        event.preventDefault();
        void intent.reply(event.altKey);
        return;
      }
      if (key === "a" && intent.selected) {
        event.preventDefault();
        void intent.reply(true);
        return;
      }
      if (key === "f" && intent.selected) {
        event.preventDefault();
        intent.startCompose({
          accountId: intent.selected.accountId,
          to: "",
          subject: `Fwd: ${intent.selected.subject}`,
          body: `\n\n--- 转发邮件 ---\n${intent.selected.messages
            .map((message) => message.text ?? "")
            .join("\n\n")}`,
          threadId: intent.selected.id,
        });
        return;
      }
      if (key === "ArrowUp" && intent.selected) {
        event.preventDefault();
        intent.setMessageIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (key === "ArrowDown" && intent.selected) {
        event.preventDefault();
        intent.setMessageIndex((index) =>
          Math.min(index + 1, intent.selected!.messages.length - 1),
        );
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (pendingG) clearTimeout(pendingG);
    };
  }, [
    intent.selected,
    intent.composerOpen,
    intent.query,
    intent.searchFiltersOpen,
    intent.registryAddOpen,
    intent.composeChord,
    intent.focusedIndex,
    intent.visibleThreads,
    intent.messageIndex,
  ]);
}
