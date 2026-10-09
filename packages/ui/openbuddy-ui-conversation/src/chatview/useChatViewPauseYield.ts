/**
 * useChatViewPauseYield — 软暂停/恢复 闭环 hook。
 *
 * 与 `ChatView.tsx:347-377` 改造前的内联逻辑等价,并把 `confirmYielded` 副作用
 * (流式结束后把 `requestYield` 升级为 `yielded`)也一起搬进来,免得调用方还要
 * 写一段 `useEffect(() => { ... }, [streaming, sessionId])`。
 */
import { useCallback, useEffect, useState } from "react";
import {
  requestYield,
  clearYield,
  confirmYielded,
  isYielded,
  createYieldStore,
} from "@/lib/ui/yield-state";

export type UseChatViewPauseYieldParams = {
  sessionId: string | null | undefined;
  streaming: boolean;
  /** 通知外部触发 agent 取消(由 ChatView 的 onCancel 透传)。 */
  onCancel: () => void;
  /** 重新发送一条 prompt,让 agent 接着生成。 */
  onSend: (text: string) => void;
  onToast?: (text: string) => void;
};

export type UseChatViewPauseYieldResult = {
  yielded: boolean;
  handlePause: () => void;
  handleResume: () => void;
  handleResumeAndContinue: () => void;
};

export function useChatViewPauseYield({
  sessionId,
  streaming,
  onCancel,
  onSend,
  onToast,
}: UseChatViewPauseYieldParams): UseChatViewPauseYieldResult {
  const [yieldStore, setYieldStore] = useState(() => createYieldStore());

  const yielded = sessionId ? isYielded(yieldStore, sessionId) : false;

  // 流式结束后确认 yield(requestYield → yielded,显示「已暂停」横幅)。
  useEffect(() => {
    if (!sessionId) return;
    if (!streaming) {
      setYieldStore((s) => confirmYielded(s, sessionId));
    }
  }, [sessionId, streaming]);

  const handlePause = useCallback(() => {
    if (!sessionId || !streaming) return;
    setYieldStore((s) => requestYield(s, sessionId));
    // pi 无原生 yield,用 cancel 软停止(保留会话);yield 状态在 complete 后确认。
    onCancel();
  }, [sessionId, streaming, onCancel]);

  const handleResume = useCallback(() => {
    if (!sessionId) return;
    setYieldStore((s) => clearYield(s, sessionId));
    onToast?.("已恢复(可继续发送消息)");
  }, [sessionId, onToast]);

  const handleResumeAndContinue = useCallback(() => {
    if (!sessionId) return;
    setYieldStore((s) => clearYield(s, sessionId));
    onSend("请继续。");
    onToast?.("已恢复并继续生成");
  }, [sessionId, onSend, onToast]);

  return {
    yielded,
    handlePause,
    handleResume,
    handleResumeAndContinue,
  };
}
