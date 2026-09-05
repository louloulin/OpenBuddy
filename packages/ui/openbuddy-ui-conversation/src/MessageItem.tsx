import { memo, useCallback, useState } from "react";
import { Markdown, type MarkdownConfig } from "@openbuddy/ui-markdown";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { ToolCallCard } from "./ToolCallCard";
import { LoadingRow } from "./LoadingRow";
import { FeedbackDialog } from "@openbuddy/ui-dialogs";
import { useThemeSnapshot } from "@openbuddy/ui-theme/client";
import { useFeedbackStore, type FeedbackRating } from "@/stores/feedback-store";
import type { ChatMessage, ToolCallView } from "@/stores/session-store";
import { EXPERT_PERSONA_BEGIN, EXPERT_PERSONA_END } from "./persona-markers";
import { useRendererContributions, useRendererSlot } from "@/lib/runtime/renderer-plugin-runtime";
import { RendererContributionView, RendererSlotView } from "@openbuddy/ui-workbench";

/** Strip the hidden expert persona block from text (used on history replay). */
function stripPersona(text: string): string {
  const begin = text.indexOf(EXPERT_PERSONA_BEGIN);
  if (begin === -1) return text;
  const end = text.indexOf(EXPERT_PERSONA_END, begin);
  if (end === -1) return text;
  const after = end + EXPERT_PERSONA_END.length;
  // Also strip trailing newlines after the end marker.
  const rest = text.slice(after).replace(/^\n+/, "");
  return (text.slice(0, begin) + rest).trim();
}

/**
 * Renders one chat message. Assistant messages are left-aligned with avatar +
 * name row; user messages are right-aligned bubbles with no avatar / name.
 *
 * Hover action bar (对齐 WorkBuddy):
 *  - user: 复制 / 编辑重发
 *  - assistant: 复制 / 复制 Markdown
 */
function MessageItemInner({
  message,
  streaming,
  markdownConfig,
  sessionId,
  onOpenTool,
  onEditResend,
  onRetry,
  onToast,
}: {
  message: ChatMessage;
  streaming: boolean;
  markdownConfig?: MarkdownConfig;
  /** @deprecated kept for call-site compatibility; unused after compact tools. */
  cwd?: string;
  /** Current session id — needed to key feedback entries. */
  sessionId?: string;
  onToast?: (msg: string) => void;
  /** Open tool detail in the right-side panel (Phase 2). */
  onOpenTool?: (tc: ToolCallView) => void;
  /** Put text back into the composer for re-editing (user messages only). */
  onEditResend?: (text: string) => void;
  /** Regenerate this response (last assistant message only): rewinds the
   *  conversation to the preceding user prompt and resends it. */
  onRetry?: () => void;
}) {
  // Subscribe to theme changes so message bubbles re-render immediately
  // when the user toggles themes. `useTheme().current()` alone returns a
  // one-shot snapshot that does not trigger a re-render — see
  // fix-renderer-pi-cors-and-theme-switch / A6.
  const theme = useThemeSnapshot((s) => s.current());
  const pluginMessageContributions = useRendererContributions("message");
  const pluginMessageSlots = useRendererSlot("conversation.message.footer");

  const copyText = useCallback(
    (text: string, label: string) => {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => onToast?.(label))
          .catch(() => onToast?.("复制失败"));
      } else {
        onToast?.("当前环境不支持剪贴板");
      }
    },
    [onToast],
  );

  /** Extract plain text from all text parts (for copy), stripping hidden persona. */
  const plainText = message.parts
    .filter((p) => p.kind === "text")
    .map((p) => (message.role === "user" ? stripPersona(p.text) : p.text))
    .join("\n");

  /** Extract markdown (text + thought) for "copy as markdown". */
  const markdownText = message.parts
    .map((p) => {
      if (p.kind === "text") return p.text;
      if (p.kind === "thought") return `<details>\n<summary>深度思考</summary>\n\n${p.text}\n\n</details>`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");

  if (message.role === "user") {
    return (
      <div className="msg msg--user">
        <div>
          <div className="msg__bubble">
            {message.parts.map((p, i) =>
              p.kind === "text" ? <span key={i}>{stripPersona(p.text)}</span> : null
            )}
          </div>
          {/* Hover actions */}
          <div className="msg__actions">
            <button
              type="button"
              className="msg__action-btn"
              onClick={() => copyText(plainText, "已复制")}
              title="复制"
            >
              复制
            </button>
            {onEditResend && (
              <button
                type="button"
                className="msg__action-btn"
                onClick={() => onEditResend(plainText)}
                title="编辑并重新发送"
              >
                编辑
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg msg--assistant">
      <div>
        <div className="msg__header">
          <span className="msg__avatar">B</span>
          <span className="msg__name">Buddy</span>
        </div>
        <div className="msg__body">
          {/* Placeholder state: the assistant message exists but no content
              has streamed in yet. Render the avatar (header above) + the
              shimmering "preparing / waiting for model" loading row with a
              rotating tip — mirrors WorkBuddy's pending-assistant view. */}
          {message.parts.length === 0 && !message.complete && <LoadingRow />}
          {message.parts.map((p, i) => {
            // Active streaming: skip the full markdown pipeline (gfm, math,
            // katex, sanitize, lowlight) and render raw text instead. The
            // pipeline re-parses on every delta which is the dominant cost
            // during streaming; once the message is complete we fall back
            // to the rich renderer. streaming===true is only set by ChatView
            // for the currently-streaming message.
            const isStreaming = streaming && !message.complete;
            if (p.kind === "text") {
              return isStreaming ? (
                <StreamingMarkdown key={i} text={p.text} markdownTheme="loose" />
              ) : (
                <Markdown
                  key={i}
                  complete={message.complete}
                  markdownTheme="loose"
                  theme={theme}
                  config={markdownConfig}
                >
                  {p.text}
                </Markdown>
              );
            }
            if (p.kind === "thought") {
              return (
                <details key={i} className="msg__thought">
                  <summary>深度思考</summary>
                  <div className="msg__thought-body">
                    {isStreaming ? (
                      <StreamingMarkdown text={p.text} markdownTheme="reasoning" />
                    ) : (
                      <Markdown
                        complete={message.complete}
                        markdownTheme="reasoning"
                        theme={theme}
                        config={markdownConfig}
                      >
                        {p.text}
                      </Markdown>
                    )}
                  </div>
                </details>
              );
            }
            if (p.kind !== "tool_call") return null;
            return (
              <ToolCallCard
                key={p.toolCall.toolCallId || i}
                tc={p.toolCall}
                onOpen={onOpenTool}
              />
            );
          })}
          {pluginMessageContributions.map((contribution) => (
            <div key={contribution.id} className="msg__plugin-contribution">
              <RendererContributionView contribution={contribution} onPlaceholder={onToast} />
            </div>
          ))}
          {pluginMessageSlots.map((entry) => (
            <RendererSlotView key={String(entry.options.id ?? entry.options.key ?? entry.options.name)} entry={entry} className="msg__plugin-contribution" />
          ))}
          {streaming &&
            message.complete === false &&
            message.parts.length > 0 && (
              <span className="msg__caret">▋</span>
            )}
        </div>
        {/* WB 风格消息 footer 操作行:复制 / MD / 重试 / 赞踩,常显(低对比度,
            hover 提升),位于正文下方而非 header 内(对齐 WorkBuddy)。 */}
        {message.complete && (
          <div className="msg__footer">
            <button
              type="button"
              className="msg__action-btn"
              onClick={() => copyText(plainText, "已复制")}
              title="复制纯文本"
            >
              复制
            </button>
            <button
              type="button"
              className="msg__action-btn"
              onClick={() => copyText(markdownText, "已复制 Markdown")}
              title="复制 Markdown 源码"
            >
              MD
            </button>
            {onRetry && (
              <button
                type="button"
                className="msg__action-btn"
                onClick={onRetry}
                title="重新生成回复（回溯后重发）"
              >
                重试
              </button>
            )}
            {sessionId && (
              <FeedbackButtons sessionId={sessionId} messageId={message.id} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 反馈按钮(👍/👎)—— 对齐 WorkBuddy message-feedback。
 *
 * 本地持久化(toggle:再点同向取消)。无后端上报(OpenBuddy 是 BYOK,无可上报通道)。
 * 选中的方向高亮(填充),未选中保持描边。
 */
function FeedbackButtons({
  sessionId,
  messageId,
}: {
  sessionId: string;
  messageId: string;
}) {
  const entry = useFeedbackStore(
    (s) => s.entries[`${sessionId}:${messageId}`] ?? null,
  );
  const setRating = useFeedbackStore((s) => s.setRating);
  const current = entry?.rating ?? null;
  // 点赞/踩:记录方向并打开完整评分弹窗(对齐 WorkBuddy rating bar + 弹窗)。
  const [dialogOpen, setDialogOpen] = useState<FeedbackRating | null>(null);
  const click = (r: FeedbackRating) => {
    // 再点已选中方向 → 取消(不弹窗)。
    if (current === r) {
      setRating(sessionId, messageId, r);
      return;
    }
    setRating(sessionId, messageId, r);
    setDialogOpen(r);
  };
  return (
    <span className="msg__feedback">
      <button
        type="button"
        className={
          "msg__action-btn msg__feedback-btn" +
          (current === "up" ? " msg__feedback-btn--active" : "")
        }
        onClick={() => click("up")}
        title={current === "up" ? "取消赞" : "赞"}
        aria-label="赞"
        aria-pressed={current === "up"}
      >
        👍
      </button>
      <button
        type="button"
        className={
          "msg__action-btn msg__feedback-btn" +
          (current === "down" ? " msg__feedback-btn--active" : "")
        }
        onClick={() => click("down")}
        title={current === "down" ? "取消踩" : "踩"}
        aria-label="踩"
        aria-pressed={current === "down"}
      >
        👎
      </button>
      {dialogOpen && (
        <FeedbackDialog
          open={dialogOpen !== null}
          sessionId={sessionId}
          messageId={messageId}
          rating={dialogOpen}
          onClose={() => setDialogOpen(null)}
        />
      )}
    </span>
  );
}

/**
 * Memoized wrapper — a message's UI only re-renders when:
 *   - the message object reference changes (new content from store), OR
 *   - the streaming flag flips on/off (entering/leaving the live delta path).
 *
 * Other props (handlers, markdownConfig, cwd, sessionId, callbacks) are
 * stabilized by ChatView's useCallback and Markdown's lazy mount, so a
 * reference-equal compare is sufficient and avoids spurious re-renders of
 * the entire transcript during streaming deltas.
 */
export const MessageItem = memo(MessageItemInner, (prev, next) => {
  return (
    prev.message === next.message &&
    prev.streaming === next.streaming &&
    prev.markdownConfig === next.markdownConfig &&
    prev.cwd === next.cwd &&
    prev.sessionId === next.sessionId &&
    prev.onToast === next.onToast &&
    prev.onOpenTool === next.onOpenTool &&
    prev.onEditResend === next.onEditResend &&
    prev.onRetry === next.onRetry
  );
});
