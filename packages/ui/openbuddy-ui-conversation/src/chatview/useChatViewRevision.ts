/**
 * useChatViewRevision — owns the "edit / re-send / step revision"
 * callbacks wired through `MessageItem` and `Composer`.
 *
 * Responsibilities:
 *   - `handleStepRevision(messageId, dir)` — page the user's revision pager.
 *   - `handleEditResend(text)` — fill composer with the user's edited text
 *     and append it as a new revision on the originating bubble.
 *   - `handleInlineResend(messageId, text)` — same path as edit-resend
 *     but skips the `editResendOriginId` indirection (the message id is
 *     explicit).
 *   - `handleEditAssistantMessage(messageId, md)` — R78: replace an
 *     assistant bubble's rendered markdown without resending.
 *   - `handleResendAfterAssistantEdit(messageId)` — R78: drop the
 *     edited assistant bubble and resend the preceding user prompt.
 *   - `handleQuickPrompt(text)` — R8.10: seed the composer from a
 *     quick-prompt chip in one shared pipe.
 *
 * Why this lives in a hook (rather than inline in ChatView):
 *   - ChatView.tsx is the orchestrator; revision/edit state should not
 *     bleed into the parent component since it's only read by MessageItem
 *     and Composer (both of which already accept handlers as props).
 *   - `resendText` + `resendNonce` is the canonical "seed composer" pipe;
 *     keeping it here means we can later add e.g. queued resends without
 *     touching ChatView.
 *   - Lifts the `editResendOriginId` state out of ChatView, which had
 *     grown to ~960 lines.
 *
 * Behavioral parity:
 *   - Every callback keeps the exact same call order as the previous
 *     inline implementation (appendUserRevision → setResendText →
 *     setResendNonce). The seed-composer pipe is unchanged.
 */
import { useCallback, useState } from "react";
import { useSessionStore } from "@/stores/session-store";

export type RevisionHook = {
  // seed signals for Composer
  resendText: string | undefined;
  resendNonce: number;
  setResendText: (text: string | undefined) => void;
  setResendNonce: (updater: (prev: number) => number) => void;

  /** R8.1 — origin id of the message whose `编辑` button was clicked.
   *  Set by `useChatViewTimeline` when the user opens the inline-edit
   *  editor; read by `handleEditResend` to append a revision. */
  setEditResendOriginId: (id: string | null) => void;

  // per-message revision
  handleStepRevision: (messageId: string, direction: -1 | 1) => void;
  handleEditResend: (text: string) => void;
  handleInlineResend: (messageId: string, text: string) => void;

  // R78 — assistant inline edit
  handleEditAssistantMessage: (messageId: string, newMarkdown: string) => void;
  handleResendAfterAssistantEdit: (messageId: string) => void;

  // R8.10 — quick prompt chips
  handleQuickPrompt: (text: string) => void;
};

export function useChatViewRevision({
  handleRetryRef,
}: {
  handleRetryRef: React.MutableRefObject<(() => void | Promise<void>) | null>;
}): RevisionHook {
  // R8.1 — id of the user message whose `编辑` button was last clicked.
  // Used by `handleEditResend` to append the new text to that message's
  // revision history before re-seeding the composer.
  const [editResendOriginId, setEditResendOriginId] = useState<string | null>(null);
  // ---- 消息"编辑重发":把消息文本回填到输入框 ----
  const [resendText, setResendText] = useState<string | undefined>(undefined);
  const [resendNonce, setResendNonce] = useState(0);

  // R8.1 — bound pager stepper. Wraps `useSessionStore.setActiveRevision`
  // so MessageItem never imports the store directly.
  const handleStepRevision = useCallback((messageId: string, direction: -1 | 1) => {
    const s = useSessionStore.getState();
    const msg = s.messages.find((m) => m.id === messageId);
    if (!msg || !msg.revisions || msg.revisions.length === 0) return;
    const cur = Math.min(Math.max(1, msg.activeRevision ?? msg.revisions.length), msg.revisions.length);
    s.setActiveRevision(messageId, cur + direction);
  }, []);

  // ---- 消息"编辑重发":把消息文本回填到输入框 ----
  const handleEditResend = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      // R8.1 (revision-pager) — record this edit on the originating message
      // so the bubble's footer can show a 上一版/下一版 pager of every text
      // the user ever submitted from this slot. We piggy-back on the same
      // resendText signal: Composer still receives the seed text below, but
      // the bubble now also gains a new revisions entry.
      if (editResendOriginId) {
        useSessionStore.getState().appendUserRevision(editResendOriginId, text);
      }
      setResendText(text);
      setResendNonce((n) => n + 1);
    },
    [editResendOriginId],
  );

  // R8.3 (inline-edit) — submit an inline edit from the bubble editor.
  // Records the new revision on the originating message and seeds the
  // composer. We deliberately reuse handleEditResend's path so the two
  // entry points (inline textarea + composer 回填) converge on the same
  // canonical "append revision → seed composer" sequence.
  const handleInlineResend = useCallback((messageId: string, text: string) => {
    if (!text.trim()) return;
    useSessionStore.getState().appendUserRevision(messageId, text);
    setResendText(text);
    setResendNonce((n) => n + 1);
  }, []);

  // R78 (assistant inline edit) — apply 落库;不需要 resend 路径。
  const handleEditAssistantMessage = useCallback(
    (messageId: string, newMarkdown: string) => {
      useSessionStore.getState().editAssistantMessage(messageId, newMarkdown);
    },
    [],
  );

  // R78 — 应用并重新生成:先替换 assistant 内容,再走 handleRetry 同一管线
  // (回退到上一条 user prompt 重新发送)。
  const handleResendAfterAssistantEdit = useCallback((_messageId: string) => {
    if (handleRetryRef.current) {
      void handleRetryRef.current();
    }
  }, [handleRetryRef]);

  // R8.10 — quick-prompt card click: seed the composer with the preset
  // text via the same resendText pipe as inline-edit / revision-pager so
  // a single source of truth seeds the textarea (Composer auto-focuses
  // when externalTextNonce bumps).
  const handleQuickPrompt = useCallback((text: string) => {
    if (!text.trim()) return;
    setResendText(text);
    setResendNonce((n) => n + 1);
  }, []);

  return {
    resendText,
    resendNonce,
    setResendText,
    setResendNonce,
    setEditResendOriginId,
    handleStepRevision,
    handleEditResend,
    handleInlineResend,
    handleEditAssistantMessage,
    handleResendAfterAssistantEdit,
    handleQuickPrompt,
  };
}
