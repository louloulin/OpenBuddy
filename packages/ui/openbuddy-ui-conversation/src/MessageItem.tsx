import { memo, useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import FileText from "lucide-react/dist/esm/icons/file-text";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Check from "lucide-react/dist/esm/icons/check";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { TooltipButton } from "./TooltipButton";
import { type MarkdownConfig } from "@openbuddy/ui-markdown";
import { useSlotComponents } from "@openbuddy/ui-runtime/client";
import { MessagePartRegistry } from "./MessagePartRegistry";
import { StreamingCaret } from "./StreamingCaret";
import { MessageRewindMenu } from "./parts/MessageRewindMenu";
import { InlineApprovalHint } from "./parts/InlineApprovalHint";
import { MessageMeta } from "./parts/MessageMeta";
import { UserBubble } from "./parts/UserBubble";
import { CopyIconButton } from "./parts/CopyIconButton";
import { FeedbackButtons } from "./parts/FeedbackButtons";
import { LoadingRow } from "./LoadingRow";
import { TurnErrorCard } from "./TurnErrorCard";
import { useThemeSnapshot } from "@openbuddy/ui-theme/client";
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
  onInlineResend,
  onStepRevision,
  onRetry,
  onToast,
  onEditAssistantMessage,
  onResendAfterAssistantEdit,
  onOpenSettings,
  rewindPromptIndex,
  onRewindTo,
  allowFork,
  onForkFromHere,
  streamingDurationMs,
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
  /** R8.3 (inline-edit) — submit a re-edited version directly from inside
   *  the bubble (Cmd/Ctrl+Enter or 点击"发送"). This mirrors
   *  onEditResend but skips the composer handoff so the user can refine
   *  the prompt without leaving the bubble. Still wired through
   *  appendUserRevision by ChatView so the revision pager history stays
   *  in sync. */
  onInlineResend?: (messageId: string, text: string) => void;
  /** R78 (assistant inline edit) — replace this assistant message's
   *  rendered text with `newMarkdown` (single blob). Tool-call parts are
   *  preserved. Wired by ChatView to `editAssistantMessage`. */
  onEditAssistantMessage?: (messageId: string, newMarkdown: string) => void;
  /** R78 — optionally regenerate from this assistant message after the
   *  user has edited it inline (drops the old bubble and resends the
   *  preceding user prompt). Wired by ChatView to handleRetry-style flow. */
  onResendAfterAssistantEdit?: (messageId: string) => void;
    /** R8.1 (revision-pager) — step the displayed revision of a user
   *  bubble. `direction` is -1 (older) or +1 (newer). The pager is only
   *  rendered when `message.revisions && message.revisions.length > 1`. */
  onStepRevision?: (messageId: string, direction: -1 | 1) => void;
  /** Regenerate this response (last assistant message only): rewinds the
   *  conversation to the preceding user prompt and resends it. */
  onRetry?: () => void;
  /** Navigate to the settings panel — wired into TurnErrorCard so auth /
   *  model-config errors offer a one-click escape instead of an opaque retry. */
  onOpenSettings?: () => void;
  /** Plan5 B.10 — 该 assistant 消息对应的 promptIndex(0-based)。
   *  由 ChatView 从 `rewindPoints` 解析后下发;undefined 时重发入口禁用。 */
  rewindPromptIndex?: number;
  /** Plan5 B.10 — 执行"从此消息重发"(回溯 + 重发该轮 prompt)。 */
  onRewindTo?: (promptIndex: number) => Promise<void> | void;
  /** Plan5 B.10 — 是否允许"从此处分叉"。 */
  allowFork?: boolean;
  onForkFromHere?: () => void;
  /** R8.14 — wall-clock ms since the current streaming turn started.
   *  ChatView passes `Date.now() - turnStartRef.current` while the
   *  message is still streaming so the meta chip can render a live
   *  "12s 正在生成…" label. Undefined on completed bubbles (we use
   *  `completedAt - createdAt` instead) and on user bubbles. */
  streamingDurationMs?: number;
}) {
  // Subscribe to theme changes so message bubbles re-render immediately
  // when the user toggles themes. `useTheme().current()` alone returns a
  // one-shot snapshot that does not trigger a re-render — see
  // fix-renderer-pi-cors-and-theme-switch / A6.
  const theme = useThemeSnapshot((s) => s.current());

  // R8.16 — smooth streaming→complete transition. We detect the
  // moment `streaming` flips from true → false on this message and
  // stamp a `just-completed` flag for one frame so CSS can fade-in
  // the freshly-settled bubble. Two reasons we can't just rely on
  // `message.complete` alone:
  //   1. historic loaded messages arrive already complete (no
  //      transition to animate);
  //   2. sessions re-mounted from JSONL may have `complete: true` on
  //      first render — animating those would feel like a glitch.
  // We therefore require `wasStreaming` to have been observed at
  // least once during this bubble's lifetime.
  const wasStreamingRef = useRef(false);
  const [justCompleted, setJustCompleted] = useState(false);
  useEffect(() => {
    if (streaming) {
      wasStreamingRef.current = true;
    } else if (wasStreamingRef.current && message.complete) {
      // Was streaming, now finished — fire the one-shot animation.
      wasStreamingRef.current = false;
      setJustCompleted(true);
      const t = window.setTimeout(() => setJustCompleted(false), 320);
      return () => window.clearTimeout(t);
    }
  }, [streaming, message.complete]);
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

  /** R8.1 (revision-pager) — text used by the user-bubble renderer.
   *  When the user has re-edited this message, `revisions` holds the full
   *  history and `activeRevision` picks the currently displayed version.
   *  Falls back to `plainText` for messages with no revision history. */
  const userDisplayedText = (() => {
    if (message.role !== "user") return plainText;
    const revs = message.revisions;
    if (!revs || revs.length === 0) return plainText;
    const idx = Math.min(
      Math.max(1, message.activeRevision ?? revs.length),
      revs.length,
    );
    return revs[idx - 1] ?? plainText;
  })();

  /** R8.1 — pager state for the user bubble. Returns null when there is
   *  only a single revision (no pager UI). */
  const revisionPager =
    message.role === "user" &&
    message.revisions &&
    message.revisions.length > 1
      ? {
          current: Math.min(
            Math.max(1, message.activeRevision ?? message.revisions.length),
            message.revisions.length,
          ),
          total: message.revisions.length,
        }
      : null;

  /** Extract markdown (text + thought) for "copy as markdown". */
  const markdownText = message.parts
    .map((p) => {
      if (p.kind === "text") return p.text;
      if (p.kind === "thought") return `<details>\n<summary>深度思考</summary>\n\n${p.text}\n\n</details>`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");


  // R73 — 「📋 编辑为草稿」入口。读 editor.draft 槽,空槽(本环境未挂 ui-editor)时不渲染按钮。
  // 每个 message 自带草稿态,关闭 / 打开互不影响。
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftInitial, setDraftInitial] = useState("");
  // R78 — 「✏️ 就地编辑」入口。读 editor.body 槽,空槽时不渲染按钮。
  // 进入编辑态后,msg__body 整体替换为 EditorImpl;Esc 退出,
  // Cmd/Ctrl+Enter 应用(并可选 resend)。
  const [inlineEditing, setInlineEditing] = useState(false);
  const [inlineDraft, setInlineDraft] = useState("");
  const inlineEditorImpls = useSlotComponents("editor.body");
  const InlineEditorImpl = inlineEditorImpls[0] as
    | ComponentType<{
        value?: string;
        format?: "html" | "markdown";
        onChange?: (next: string) => void;
        editable?: boolean;
        placeholder?: string;
      }>
    | undefined;
  const draftImpls = useSlotComponents("editor.draft");
  const DraftImpl = draftImpls[0] as
    | ComponentType<{
        open: boolean;
        onClose?: () => void;
        onApply?: (md: string) => void;
        onCopy?: (md: string) => void;
        initialMarkdown?: string;
        title?: string;
      }>
    | undefined;
  if (message.role === "user") {
    // R8.1 (revision-pager) — split attachments (file/image parts) from the
    // text part. The text part gets replaced by the currently selected
    // revision so the user can scrub through previous edits while keeping
    // any uploaded files visible.
    const fileParts = message.parts.filter((p) => p.kind === "file");
    return (
      <UserBubble
        message={message}
        userDisplayedText={userDisplayedText}
        fileParts={fileParts}
        revisionPager={revisionPager}
        onStepRevision={onStepRevision}
        onEditResend={onEditResend}
        onInlineResend={onInlineResend}
        onToast={onToast}
        copyText={copyText}
      />
    );
  }

  // R8.14 — per-message meta chip. Returns null when no createdAt is
  // available so historic transcripts that pre-date the field simply
  // skip the chip (no visual regression).
  // R8.15 — also pipes through modelId + outputTokens so the meta chip
  // can render the "<model> · X tok/s" pills.
  const metaProps = (() => {
    const createdAt = message.createdAt;
    if (typeof createdAt !== "number") return null;
    const isStreaming = streaming && !message.complete;
    const completedAt = message.completedAt;
    const durationMs =
      typeof completedAt === "number"
        ? Math.max(0, completedAt - createdAt)
        : isStreaming && typeof streamingDurationMs === "number"
          ? Math.max(0, streamingDurationMs)
          : null;
    return {
      createdAt,
      durationMs,
      isStreaming,
      modelId: message.modelId,
      outputTokens: message.outputTokens,
      // R58 — pipe input (prompt) token count so MessageMeta can
      // render the "1.2k in" chip beside the throughput chip.
      inputTokens: message.inputTokens,
    };
  })();

  // Don't render blank assistant bubbles. A turn that ended with no parts
  // and no error (or that finished mid-stream before any chunk landed) is
  // visually empty — keeping it would clutter the transcript with a stray
  // header and the full action toolbar for content that doesn't exist.
  if (
    message.role === "assistant" &&
    message.complete &&
    message.parts.length === 0 &&
    !message.error
  ) {
    return null;
  }

  // R78 — Esc 取消 / Cmd+Enter 应用 inline edit
  useEffect(() => {
    if (!inlineEditing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setInlineEditing(false);
        setInlineDraft("");
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (!onEditAssistantMessage) return;
        e.preventDefault();
        onEditAssistantMessage(message.id, inlineDraft);
        setInlineEditing(false);
        setInlineDraft("");
        onToast?.("已就地保存");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [inlineEditing, inlineDraft, message.id, onEditAssistantMessage, onToast]);

    // R8.16 — apply the just-completed class to the assistant root
  // for ~320ms after the streaming flag flips off so the bubble
  // fades + slides in instead of popping into existence.
  // R8.44 — additionally apply msg--streaming while the message
  // is actively streaming so the avatar pulse (defined in
  // prose.css) can fire. The class only sticks while `streaming`
  // is true; when streaming finishes, the class is removed and
  // just-completed takes over.
  const rootCls = justCompleted
    ? "msg msg--assistant msg--just-completed"
    : streaming
      ? "msg msg--assistant msg--streaming"
      : "msg msg--assistant";
  return (
    <div className={rootCls}>
      <div>
        <div className="msg__header">
          <span className="msg__avatar" aria-hidden="true">
            <Sparkles size={14} strokeWidth={2} />
          </span>
          <span className="msg__name">Buddy</span>
          <span className="msg__role" aria-label="AI assistant">AI</span>
        </div>
        <div className="msg__body">
          {inlineEditing && InlineEditorImpl ? (
            <div className="msg__inline-editor" data-testid="message-inline-editor">
              <InlineEditorImpl
                value={inlineDraft}
                format="markdown"
                editable
                onChange={(v) => setInlineDraft(v)}
                placeholder="在 Tiptap 富文本里修改这条回复..."
              />
              <div className="msg__inline-editor-actions">
                <button
                  type="button"
                  className="msg__action-btn"
                  onClick={() => {
                    setInlineEditing(false);
                    setInlineDraft("");
                  }}
                  data-testid="message-inline-edit-cancel"
                >
                  取消 (Esc)
                </button>
                <button
                  type="button"
                  className="msg__action-btn"
                  onClick={() => {
                    if (!onEditAssistantMessage) return;
                    onEditAssistantMessage(message.id, inlineDraft);
                    setInlineEditing(false);
                    setInlineDraft("");
                    onToast?.("已就地保存");
                  }}
                  data-testid="message-inline-edit-apply"
                >
                  应用
                </button>
                {onResendAfterAssistantEdit && onEditAssistantMessage && (
                  <button
                    type="button"
                    className="msg__action-btn msg__action-btn--primary"
                    onClick={() => {
                      onEditAssistantMessage(message.id, inlineDraft);
                      setInlineEditing(false);
                      setInlineDraft("");
                      onResendAfterAssistantEdit(message.id);
                    }}
                    data-testid="message-inline-edit-apply-resend"
                  >
                    应用并重新生成
                  </button>
                )}
              </div>
            </div>
          ) : null}
          {/* Placeholder state: the assistant message exists but no content
              has streamed in yet. Render the avatar (header above) + the
              shimmering "preparing / waiting for model" loading row with a
              rotating tip — mirrors WorkBuddy's pending-assistant view. */}
          {message.parts.length === 0 && !message.complete && <LoadingRow />}
          {/* Failed turn: surface the structured error as the bubble body
              (so a blank "Buddy" bubble never appears in the transcript),
              and still render any partial parts the agent did emit. */}
          {message.error && (
            <TurnErrorCard
              error={message.error}
              onRetry={onRetry}
              onOpenSettings={onOpenSettings}
              onToast={onToast}
            />
          )}
          {/* Plan A.2 — 部件派发统一走 MessagePartRegistry。新增 part 类型只需在
              `parts/registry-defaults.tsx` 加一行,不需要修改本组件主干。
              视觉与 data-testid 与改造前完全一致(快照测试覆盖)。 */}
          <MessagePartRegistry
            parts={message.parts}
            messageId={message.id}
            isStreaming={streaming && !message.complete}
            complete={message.complete}
            theme={theme}
            markdownConfig={markdownConfig}
            onOpenTool={onOpenTool ? (toolCallId) => {
              // Phase A.2 — 从 toolCallId 找回完整 ToolCallView 并打开。
              const target = message.parts.find(
                (part) => part.kind === "tool_call" && part.toolCall.toolCallId === toolCallId,
              );
              if (target && target.kind === "tool_call") onOpenTool(target.toolCall);
            } : undefined}
            onToast={onToast}
          />
          {pluginMessageContributions.map((contribution) => (
            <div key={contribution.id} className="msg__plugin-contribution">
              <RendererContributionView contribution={contribution} onPlaceholder={onToast} />
            </div>
          ))}
          {pluginMessageSlots.map((entry) => (
            <RendererSlotView key={String(entry.options.id ?? entry.options.key ?? entry.options.name)} entry={entry} className="msg__plugin-contribution" />
          ))}
          {/* R8.23 → Plan5 B.1 — streaming caret.
              Was the unicode ▋ block char, then a hand-rolled
              `.msg__caret` span; now the shared `StreamingCaret`
              primitive so the caret can be themed (loose / reasoning)
              and reused by plugins. Only rendered when there is already
              streamed text — a `LoadingRow` owns the empty state, and a
              caret floating above it would read as a stray cursor. */}
          {message.parts.length > 0 && (
            <StreamingCaret active={streaming && message.complete !== true} />
          )}
        </div>
        {/* R8.11 — message footer actions (复制 / MD / 重试 / 赞踩). Icon-only
            buttons; copy buttons briefly swap to a checkmark on success
            (matches cabinet's CopyButton pattern). Failure turns keep
            重试 + 赞踩 only. Buttons stay always-visible at low opacity
            and brighten on hover/focus. */}
        {message.complete &&
          (plainText || message.error || typeof rewindPromptIndex === "number") && (
          <div className="msg__footer">
            {plainText && (
              <CopyIconButton
                tooltip="复制纯文本"
                copiedTooltip="已复制"
                onCopy={() => copyText(plainText, "已复制")}
              />
            )}
            {plainText && (
              <CopyIconButton
                tooltip="复制 Markdown 源码"
                copiedTooltip="已复制 Markdown"
                onCopy={() => copyText(markdownText, "已复制 Markdown")}
                idleIcon={<FileText size={14} strokeWidth={1.75} />}
                copiedIcon={<Check size={14} strokeWidth={2} />}
              />
            )}
            {DraftImpl && markdownText && (
              <TooltipButton
                className="msg__action-btn"
                tooltip="把这条回答送进草稿编辑器(用 Tiptap / 表格 / math / mermaid 改写)"
                onClick={() => {
                  setDraftInitial(markdownText);
                  setDraftOpen(true);
                }}
                aria-label="编辑为草稿"
                data-testid="message-draft-button"
              >
                <Pencil size={14} strokeWidth={1.75} />
              </TooltipButton>
            )}
            {InlineEditorImpl && markdownText && !inlineEditing && (
              <TooltipButton
                className="msg__action-btn"
                tooltip="就地编辑这条回复(Tiptap 富文本,Esc 取消,⌘/Ctrl+Enter 应用并可重新生成)"
                onClick={() => {
                  setInlineDraft(markdownText);
                  setInlineEditing(true);
                }}
                aria-label="就地编辑"
                data-testid="message-inline-edit-button"
              >
                <Pencil size={14} strokeWidth={1.75} />
                <span style={{ marginLeft: 2 }}>↳</span>
              </TooltipButton>
            )}
            {onRetry && (
              <TooltipButton
                className="msg__action-btn"
                tooltip="重新生成回复"
                onClick={onRetry}
                aria-label="重试"
              >
                <RefreshCw size={14} strokeWidth={1.75} />
              </TooltipButton>
            )}
            {/* Plan5 B.10 — 消息级"从此消息重发/分叉"。放在赞踩之前,
                保持既有按钮顺序不变(快照 / 既有选择器全部命中)。 */}
            {message.role === "assistant" && (
              <MessageRewindMenu
                messageId={message.id}
                promptIndex={rewindPromptIndex}
                sessionId={sessionId}
                allowFork={allowFork}
                onRewind={onRewindTo ? (p) => onRewindTo(p.promptIndex) : undefined}
                onFork={onForkFromHere}
                onToast={onToast}
              />
            )}
            {sessionId && (
              <FeedbackButtons sessionId={sessionId} messageId={message.id} />
            )}
          </div>
        )}
        {metaProps && <MessageMeta {...metaProps} />}
        {DraftImpl ? (
          <DraftImpl
            open={draftOpen}
            onClose={() => setDraftOpen(false)}
            onApply={(md) => {
              setDraftOpen(false);
              onToast?.(md ? `草稿已应用（${md.length} 字符）` : "草稿为空");
            }}
            onCopy={(md) => {
              void navigator.clipboard?.writeText(md).then(
                () => onToast?.("草稿 markdown 已复制到剪贴板"),
                () => onToast?.("剪贴板不可用"),
              );
            }}
            initialMarkdown={draftInitial}
          />
        ) : null}
        {/* Plan5 B.4 — pending permission/question requests at the
            trailing assistant message so the user notices inline
            instead of only at the footer. The component reads the
            stores itself (via memo) so it's safe to render here
            without prop-drilling. */}
        {message.role === "assistant" && sessionId && (
          <InlineApprovalHint sessionId={sessionId} />
        )}
      </div>
    </div>
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
    prev.onInlineResend === next.onInlineResend &&
    prev.onRetry === next.onRetry &&
    prev.onOpenSettings === next.onOpenSettings
  );
});
