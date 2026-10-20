/**
 * useChatViewRewind — 消息级"从这里重发"的回溯点解析(Plan5 B.10)。
 *
 * 职责:
 *   1. 拉取当前会话的 `rewindPoints(sessionId)`(pi 侧按 user prompt 排序)
 *   2. 把"每条 assistant 消息"映射到它的 `promptIndex`
 *   3. 暴露 `handleRewindTo(promptIndex)` —— 与 `useChatViewRetry` 同一条
 *      管线:`rewindExecute(mode="conversation", force=true)` → `onRewound()`
 *      → `onSend(userText)`
 *
 * 为什么需要独立 hook:
 *   - `rewindPoints` 是一次 IPC round-trip,不能挂在每条消息上各调一次
 *     (500 条消息 = 500 次 IPC)。这里按 sessionId 拉一次,转成
 *     `messageId → promptIndex` 的 Map 下发。
 *   - 只在"会话已有消息"时拉取;空会话(还没发过 prompt)没有回溯点。
 *   - 每条 turn 结束(`streaming` 从 true 变 false)后刷新一次,让刚产生的
 *     新 prompt 立刻出现在消息级入口里。
 *
 * 与 `useChatViewRetry` 的关系:后者负责"重试最后一条",本 hook 负责
 * "重发指定的这一条"。两者共用同一套 rewind IPC 语义,但触发点与目标不同。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@openbuddy/ui-state/session-store";
import { rewindExecute, rewindPoints } from "@/lib/agent/pi-client";
// 纯映射逻辑放在无 IPC 依赖的模块里 —— 便于直接单测,也便于插件复用。
import {
  buildPromptIndexMap,
  userTextForPromptIndex,
} from "@/lib/ui/rewind-utils";

export { buildPromptIndexMap, userTextForPromptIndex };

export type UseChatViewRewindParams = {
  sessionId: string | null | undefined;
  streaming: boolean;
  /** 只读子代理会话禁止回溯(与 retry 的守卫一致)。 */
  readOnlySubagent: boolean;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onRewound?: () => void;
  onToast?: (msg: string) => void;
};

export type UseChatViewRewindResult = {
  /** assistant 消息 id → 该 turn 的 promptIndex(0-based)。 */
  promptIndexByMessageId: ReadonlyMap<string, number>;
  /** 回溯到指定 prompt 并重发它的文本。 */
  handleRewindTo: (promptIndex: number) => Promise<void>;
  /** 是否有可用的回溯点(驱动按钮启用态)。 */
  hasRewindPoints: boolean;
  /** 正在执行回溯(禁用按钮,避免连点)。 */
  rewinding: boolean;
};

export function useChatViewRewind({
  sessionId,
  streaming,
  readOnlySubagent,
  messages,
  onSend,
  onRewound,
  onToast,
}: UseChatViewRewindParams): UseChatViewRewindResult {
  const [validPromptIndexes, setValidPromptIndexes] = useState<ReadonlySet<number>>(
    () => new Set<number>(),
  );
  const [rewinding, setRewinding] = useState(false);

  // messages 通过 ref 读取,保证 loadPoints 的 identity 在流式 delta 期间稳定。
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const loadPoints = useCallback(async () => {
    if (!sessionId || sessionId.startsWith("__pending_")) {
      setValidPromptIndexes(new Set<number>());
      return;
    }
    try {
      const points = await rewindPoints(sessionId);
      setValidPromptIndexes(new Set(points.map((p) => p.promptIndex)));
    } catch {
      // 会话在 pi 侧还不存在 / IPC 暂不可用 —— 保持入口禁用,不阻塞渲染。
      setValidPromptIndexes(new Set<number>());
    }
  }, [sessionId]);

  // 会话切换 → 重新拉取。
  useEffect(() => {
    void loadPoints();
  }, [loadPoints]);

  // 每轮 turn 结束(streaming true → false)后刷新,让新 prompt 立刻可回溯。
  const prevStreaming = useRef(streaming);
  useEffect(() => {
    if (prevStreaming.current && !streaming) void loadPoints();
    prevStreaming.current = streaming;
  }, [streaming, loadPoints]);

  const handleRewindTo = useCallback(
    async (promptIndex: number) => {
      if (!sessionId || streaming || rewinding || readOnlySubagent) return;
      // 找出该 promptIndex 对应的用户消息文本,用于回溯后重发。
      const userText = userTextForPromptIndex(messagesRef.current, promptIndex);
      setRewinding(true);
      try {
        await rewindExecute(sessionId, promptIndex, "conversation", true);
        onRewound?.();
        if (userText.trim()) onSend(userText);
      } catch (e) {
        onToast?.(`回溯失败：${String(e).replace(/^Error:\s*/, "")}`);
        throw e;
      } finally {
        setRewinding(false);
      }
    },
    [sessionId, streaming, rewinding, readOnlySubagent, onSend, onRewound, onToast],
  );

  const promptIndexByMessageId = buildPromptIndexMap(messages, validPromptIndexes);

  return {
    promptIndexByMessageId,
    handleRewindTo,
    hasRewindPoints: validPromptIndexes.size > 0,
    rewinding,
  };
}
