/**
 * useChatViewRetry — 消息级/会话级 retry hook。
 *
 * 与 ChatView 改造前内联实现逐字等价:
 *   - handleRetry:rewindPoints → 取最大 promptIndex → rewindExecute(mode=conversation, force=true)
 *     → onRewound() → onSend(userText)
 *   - handleRetryLast:error banner 的「↻ 重试」。比 handleRetry 轻:不 rewind,
 *     只清 error 后重发最近一条 user prompt(适合 session 级失败)
 *
 * messages 通过 ref 读取,保证 handleRetry 的 identity 在流式 delta 期间稳定,
 * 否则 ChatView 的每次 re-render 都会让 MessageItem 的 React.memo 失效。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@openbuddy/ui-state/session-store";
import { useSessionStore } from "@/stores/session-store";
import { rewindExecute, rewindPoints } from "@/lib/agent/pi-client";

export type UseChatViewRetryParams = {
  sessionId: string | null | undefined;
  streaming: boolean;
  readOnlySubagent: boolean;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onRewound?: () => void;
  onToast?: (msg: string) => void;
};

export type UseChatViewRetryResult = {
  retrying: boolean;
  /** 整个会话的最近一条 user prompt 重发(带回退点)。 */
  handleRetry: () => Promise<void>;
  /** error banner 上的 ↻ 重试(不回退,只重发)。 */
  handleRetryLast: () => void;
  /** 稳定的 handleRetry 引用,给 handleResendAfterAssistantEdit 用。 */
  handleRetryRef: React.MutableRefObject<(() => Promise<void>) | null>;
  /** ChatView 仍需读取的最新 messages 快照 ref(避免每次 delta 重建回调查看 messages)。 */
  messagesRef: React.MutableRefObject<ChatMessage[]>;
};

export function useChatViewRetry({
  sessionId,
  streaming,
  readOnlySubagent,
  messages,
  onSend,
  onRewound,
  onToast,
}: UseChatViewRetryParams): UseChatViewRetryResult {
  const [retrying, setRetrying] = useState(false);

  // Read the current `messages` array through a ref so handleRetry's identity
  // stays stable across streaming deltas.
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const handleRetryRef = useRef<(() => Promise<void>) | null>(null);
  handleRetryRef.current = null;

  const handleRetry = useCallback(async () => {
    if (!sessionId || streaming || retrying || readOnlySubagent) return;
    const snapshot = messagesRef.current;
    const lastUserMsg = [...snapshot].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      onToast?.("没有可重试的消息");
      return;
    }
    const userText = lastUserMsg.parts
      .filter((p) => p.kind === "text")
      .map((p) => p.text)
      .join("\n");
    if (!userText.trim()) return;

    setRetrying(true);
    try {
      const points = await rewindPoints(sessionId);
      if (points.length === 0) {
        onToast?.("没有可回退的点，无法重试");
        return;
      }
      const lastPoint = points.reduce((a, b) =>
        b.promptIndex > a.promptIndex ? b : a,
      );
      await rewindExecute(sessionId, lastPoint.promptIndex, "conversation", true);
      onRewound?.();
      onSend(userText);
    } catch (e) {
      onToast?.(`重试失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setRetrying(false);
    }
  }, [sessionId, streaming, retrying, readOnlySubagent, onSend, onRewound, onToast]);

  // R78 — 让 handleResendAfterAssistantEdit 永远拿到当前最新的 handleRetry
  handleRetryRef.current = handleRetry;

  const handleRetryLast = useCallback(() => {
    if (!sessionId || streaming) return;
    const snapshot = messagesRef.current;
    const lastUserMsg = [...snapshot].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      onToast?.("没有可重试的消息");
      return;
    }
    const userText = lastUserMsg.parts
      .filter((p) => p.kind === "text")
      .map((p) => p.text)
      .join("\n");
    if (!userText.trim()) return;
    // Clear the error so the banner does not linger over the new turn.
    useSessionStore.getState().setError(null);
    onSend(userText);
  }, [sessionId, streaming, onSend, onToast]);

  return { retrying, handleRetry, handleRetryLast, handleRetryRef, messagesRef };
}
