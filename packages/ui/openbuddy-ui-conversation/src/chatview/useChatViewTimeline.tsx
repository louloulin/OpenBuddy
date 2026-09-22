/**
 * useChatViewTimeline — 会话转录区的 timeline 节点渲染器。
 *
 * 抽出 `ChatView.tsx` 内联的 `timeline` + `renderTimelineNode`:
 *   - `buildTimeline(messages)` 的 memo(日期/模型分隔符 + 消息)
 *   - date-divider / model-divider / message 三种节点的渲染
 *   - 查找高亮(`FindBar`)、流式时长(meta chip)、retry / edit-resend 接线
 *
 * 抽出来后 ChatView 只需一次 hook 调用,把返回的 `timeline` /
 * `renderTimelineNode` 交给 `ChatViewScrollStage`。
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { buildTimeline, type TimelineNode } from "@/lib/ui/timeline-utils";
import type { ChatMessage } from "@openbuddy/ui-state/session-store";
import { MessageItem } from "../MessageItem";
import { isFindHit } from "../FindBar";

export type UseChatViewTimelineParams = {
  messages: ChatMessage[];
  streaming: boolean;
  streamingMessageId: string | null;
  markdownConfig: unknown;
  cwd?: string;
  sessionId?: string | null;
  onToast?: (msg: string) => void;
  /** 打开工具详情侧栏。 */
  handleOpenTool: (tc: import("@openbuddy/ui-state/session-store").ToolCallView) => void;
  /** 消息级"编辑重发"。 */
  handleEditResend: (text: string) => void;
  /** 记录 editResend 的源消息 id(给 revision-pager 用)。 */
  setEditResendOriginId: (id: string) => void;
  /** 消息级 revision pager 步进。 */
  handleStepRevision: (messageId: string, direction: -1 | 1) => void;
  /** 就地编辑后的重发。 */
  handleInlineResend: (messageId: string, text: string) => void;
  /** assistant 消息的就地编辑落库。 */
  handleEditAssistantMessage: (messageId: string, newMarkdown: string) => void;
  /** assistant 编辑后"应用并重新生成"。 */
  handleResendAfterAssistantEdit: (messageId: string) => void;
  /** 消息级重试(由 useChatViewRetry 提供)。 */
  handleRetry: () => Promise<void>;
  /** 流式起始时间 ref(由 useChatViewStreaming 提供)。 */
  turnStartRef: React.MutableRefObject<number | null>;
  /** 查找面板状态。 */
  findOpen: boolean;
  findHits: readonly string[];
  findCurrent: string | null;
};

export type UseChatViewTimelineResult = {
  timeline: readonly TimelineNode[];
  renderTimelineNode: (args: { node: TimelineNode; index: number }) => ReactNode;
};

export function useChatViewTimeline({
  messages,
  streaming,
  streamingMessageId,
  markdownConfig,
  cwd,
  sessionId,
  onToast,
  handleOpenTool,
  handleEditResend,
  setEditResendOriginId,
  handleStepRevision,
  handleInlineResend,
  handleEditAssistantMessage,
  handleResendAfterAssistantEdit,
  handleRetry,
  turnStartRef,
  findOpen,
  findHits,
  findCurrent,
}: UseChatViewTimelineParams): UseChatViewTimelineResult {
  const timeline = useMemo(() => buildTimeline(messages), [messages]);
  const messagesLength = messages.length;

  const renderTimelineNode = useCallback(
    ({ node }: { node: TimelineNode; index: number }) => {
      if (node.kind === "date-divider") {
        return (
          <div key={node.key} className="timeline-divider timeline-divider--date">
            {node.label}
          </div>
        );
      }
      if (node.kind === "model-divider") {
        return (
          <div key={node.key} className="timeline-divider timeline-divider--model">
            {node.label}
          </div>
        );
      }
      const m = node.message as ChatMessage;
      const idx = node.index;
      const isLastAssistant = m.role === "assistant" && idx === messagesLength - 1;
      const findCls =
        findOpen && isFindHit(findHits as string[], m.id)
          ? m.id === findCurrent
            ? " msg-wrap--find-current"
            : " msg-wrap--find-hit"
          : "";
      return (
        <div key={m.id} className={"msg-wrap" + findCls} data-msg-id={m.id}>
          <MessageItem
            message={m}
            streaming={streaming && m.id === streamingMessageId}
            // R8.14 — per-turn streaming duration so the meta chip can render
            // a live "12s 正在生成…" label on the in-flight bubble.
            streamingDurationMs={
              streaming && m.id === streamingMessageId && turnStartRef.current !== null
                ? Date.now() - turnStartRef.current
                : undefined
            }
            markdownConfig={markdownConfig as never}
            cwd={cwd}
            sessionId={sessionId ?? undefined}
            onToast={onToast}
            onOpenTool={handleOpenTool}
            onEditResend={(text) => {
              setEditResendOriginId(m.id);
              handleEditResend(text);
            }}
            onStepRevision={handleStepRevision}
            onInlineResend={m.role === "user" ? handleInlineResend : undefined}
            onRetry={isLastAssistant && !streaming && m.complete ? handleRetry : undefined}
            onEditAssistantMessage={
              m.role === "assistant" && m.complete ? handleEditAssistantMessage : undefined
            }
            onResendAfterAssistantEdit={
              m.role === "assistant" && m.complete
                ? handleResendAfterAssistantEdit
                : undefined
            }
          />
        </div>
      );
    },
    [
      messagesLength,
      streaming,
      streamingMessageId,
      markdownConfig,
      cwd,
      sessionId,
      onToast,
      handleOpenTool,
      handleEditResend,
      setEditResendOriginId,
      handleStepRevision,
      handleInlineResend,
      handleEditAssistantMessage,
      handleResendAfterAssistantEdit,
      handleRetry,
      turnStartRef,
      findOpen,
      findHits,
      findCurrent,
    ],
  );

  return { timeline, renderTimelineNode };
}
