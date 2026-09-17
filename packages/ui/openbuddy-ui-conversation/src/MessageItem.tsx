import { memo, useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import Copy from "lucide-react/dist/esm/icons/copy";
import FileText from "lucide-react/dist/esm/icons/file-text";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Check from "lucide-react/dist/esm/icons/check";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
// R8.14 — per-message meta chip (timestamp + completion duration).
// `hourglass` pulses while streaming; `clock-3` is the static mark
// on completed bubbles.
import Hourglass from "lucide-react/dist/esm/icons/hourglass";
import Clock3 from "lucide-react/dist/esm/icons/clock-3";
// R8.15 — model id + token-throughput chips. Mirrors PI-Desktop's
// MessageMeta: a tiny "<model> · 42 tok/s" line below the assistant
// bubble that lets the user see at a glance what produced the answer.
import Cpu from "lucide-react/dist/esm/icons/cpu";
import Hash from "lucide-react/dist/esm/icons/hash";
import Zap from "lucide-react/dist/esm/icons/zap";
import { TooltipButton } from "./TooltipButton";
import { type MarkdownConfig } from "@openbuddy/ui-markdown";
import { useSlotComponents } from "@openbuddy/ui-runtime/client";
import { ConversationMarkdown } from "./conversation-slots";
import { ToolCallCard } from "./ToolCallCard";
import { LoadingRow } from "./LoadingRow";
import { TurnErrorCard } from "./TurnErrorCard";
import { FeedbackDialog } from "@openbuddy/ui-dialogs";
import { useThemeSnapshot } from "@openbuddy/ui-theme/client";
import { useFeedbackStore, type FeedbackRating } from "@/stores/feedback-store";
import type { ChatMessage, ToolCallView } from "@/stores/session-store";
import { EXPERT_PERSONA_BEGIN, EXPERT_PERSONA_END } from "./persona-markers";
import { useRendererContributions, useRendererSlot } from "@/lib/runtime/renderer-plugin-runtime";
import { RendererContributionView, RendererSlotView, FilePreview } from "@openbuddy/ui-workbench";

function toPreviewDataUrl(mediaType: string, data: string): string {
  if (data.startsWith("data:")) return data;
  return `data:${mediaType || "application/octet-stream"};base64,${data}`;
}

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
  onOpenSettings,
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
          {message.parts.map((p, i) => {
            // Active streaming: skip the full markdown pipeline (gfm, math,
            // katex, sanitize, lowlight) and render raw text instead. The
            // pipeline re-parses on every delta which is the dominant cost
            // during streaming; once the message is complete we fall back
            // to the rich renderer. streaming===true is only set by ChatView
            // for the currently-streaming message.
            const isStreaming = streaming && !message.complete;
            if (p.kind === "text") {
              // 正文走内核 `conversation.message.markdown` 槽:插件可以换成
              // 自己的 markdown 引擎 / 批注视图,内核里没实现时渲染的就是原来
              // 那对 StreamingMarkdown / Markdown —— 视觉零变化。
              return (
                <ConversationMarkdown
                  key={i}
                  text={p.text}
                  streaming={isStreaming}
                  complete={message.complete}
                  markdownTheme="loose"
                  theme={theme}
                  config={markdownConfig}
                />
              );
            }
            if (p.kind === "thought") {
              return (
                <details key={i} className="msg__thought">
                  <summary>深度思考</summary>
                  <div className="msg__thought-body">
                    <ConversationMarkdown
                      text={p.text}
                      streaming={isStreaming}
                      complete={message.complete}
                      markdownTheme="reasoning"
                      theme={theme}
                      config={markdownConfig}
                    />
                  </div>
                </details>
              );
            }
            if (p.kind === "file") {
              return (
                <FilePreview
                  key={i}
                  filename={p.name || "attachment"}
                  content={toPreviewDataUrl(p.mediaType, p.data)}
                />
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
          {/* R8.23 — streaming caret. Was the unicode ▋ block char; we
              now render a 2×14 brand-tinted pill with a soft pulse so
              the streaming state reads as "alive" rather than a
              flickering terminal cursor. The aria-label keeps the
              screen-reader experience stable across the visual swap. */}
          {streaming &&
            message.complete === false &&
            message.parts.length > 0 && (
              <span
                className="msg__caret"
                aria-label="正在生成"
                role="status"
              />
            )}
        </div>
        {/* R8.11 — message footer actions (复制 / MD / 重试 / 赞踩). Icon-only
            buttons; copy buttons briefly swap to a checkmark on success
            (matches cabinet's CopyButton pattern). Failure turns keep
            重试 + 赞踩 only. Buttons stay always-visible at low opacity
            and brighten on hover/focus. */}
        {message.complete && (plainText || message.error) && (
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
      </div>
    </div>
  );
}

/**
 * R8.14 — Per-message meta chip.
 *
 * Renders a single thin line under the assistant bubble with:
 *   - relative timestamp (`刚刚` / `5 分钟前` / `2 小时前` / `昨天` / `3 天前`)
 *   - generation duration when `completedAt` is stamped (`12s` / `1m 5s`)
 *   - live streaming label (`12s 正在生成…`) while the turn is in-flight
 *
 * Visibility: always rendered at low opacity (0.55); the message-wrap
 * `:hover` brings it to full opacity (matches the PI-Desktop MessageMeta
 * pattern where meta info lives one tap away, not always loud).
 */
function MessageMeta({
  createdAt,
  durationMs,
  isStreaming,
  modelId,
  outputTokens,
  inputTokens,
}: {
  createdAt: number;
  durationMs: number | null;
  isStreaming: boolean;
  /** R8.15 — model id used to produce this turn. Drives the .msg__meta-chip--model
   *  pill rendered alongside the timestamp (PI-Desktop parity). */
  modelId?: string;
  /** R8.15 — completion token count. Combined with `durationMs` to derive
   *  a tok/s throughput chip. Only renders when both are present and the
   *  turn has actually finished streaming. */
  outputTokens?: number;
  /** R58 — prompt (input) token count for this turn. Renders as a
   *  "<formatted> in" chip before the throughput chip when present.
   *  Optional for backward compat with pre-R58 history. */
  inputTokens?: number;
}) {
  const label = isStreaming
    ? `${formatDurationMs(durationMs ?? 0)} 正在生成…`
    : formatRelativeTime(Date.now() - createdAt);
  const detail =
    !isStreaming && typeof durationMs === "number" && durationMs > 0
      ? formatDurationMs(durationMs)
      : null;
  // R8.15 — derive throughput from completed output tokens / duration.
  // Require ≥ 1s so we don't render "inf tok/s" on sub-second turns
  // (also matches PI-Desktop's `calculateTokenRate` floor).
  const throughput =
    !isStreaming &&
    typeof outputTokens === "number" &&
    outputTokens > 0 &&
    typeof durationMs === "number" &&
    durationMs >= 1000
      ? outputTokens / (durationMs / 1000)
      : null;
  const ariaLabel = isStreaming
    ? `正在生成, ${formatDurationMs(durationMs ?? 0)}`
    : detail
      ? `${label}, 用时 ${detail}`
      : label;
  const showModelChip = !isStreaming && typeof modelId === "string" && modelId.length > 0;
  return (
    <div
      className={
        "msg__meta" + (isStreaming ? " msg__meta--streaming" : "")
      }
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <span className="msg__meta-icon" aria-hidden="true">
        {isStreaming ? (
          <Hourglass size={10} strokeWidth={1.75} />
        ) : (
          <Clock3 size={10} strokeWidth={1.75} />
        )}
      </span>
      <span className="msg__meta-time">{label}</span>
      {detail && (
        <span className="msg__meta-detail" aria-hidden="true">
          · {detail}
        </span>
      )}
      {showModelChip && (
        <span className="msg__meta-chip msg__meta-chip--model" title={`model: ${modelId}`}>
          <Cpu size={9} strokeWidth={1.75} aria-hidden="true" />
          <span className="msg__meta-chip-text">{modelId}</span>
        </span>
      )}
      {/* R58 — input (prompt) token chip. Renders before the throughput
          chip so the "in" / "out" / "tok/s" reading order stays natural.
          Only shown when inputTokens is present (provider-reported) AND
          the turn has finished streaming (mirrors the throughput gate). */}
      {!isStreaming && typeof inputTokens === "number" && inputTokens > 0 && (
        <span
          className="msg__meta-chip msg__meta-chip--input"
          title={`${inputTokens} prompt tokens for this turn`}
        >
          <Hash size={9} strokeWidth={1.75} aria-hidden="true" />
          <span className="msg__meta-chip-text">{formatTokenCount(inputTokens)} in</span>
        </span>
      )}
      {/* R58 — output (completion) token chip. Rendered alongside the
          input chip so users can see in/out at a glance; the legacy
          throughput chip below carries the tok/s rate. */}
      {!isStreaming && typeof outputTokens === "number" && outputTokens > 0 && (
        <span
          className="msg__meta-chip msg__meta-chip--output"
          title={`${outputTokens} completion tokens for this turn`}
        >
          <Zap size={9} strokeWidth={1.75} aria-hidden="true" />
          <span className="msg__meta-chip-text">{formatTokenCount(outputTokens)} out</span>
        </span>
      )}
      {throughput !== null && (
        <span className="msg__meta-chip msg__meta-chip--throughput" title={`${outputTokens} completion tokens in ${formatDurationMs(durationMs!)}`}>
          <Zap size={9} strokeWidth={1.75} aria-hidden="true" />
          <span className="msg__meta-chip-text">{formatThroughput(throughput)} tok/s</span>
        </span>
      )}
    </div>
  );
}

/** R8.15 — "42 tok/s" / "1.2k tok/s" formatter. Mirrors PI-Desktop's
 *  `formatTokenCount` rounding so the chip is glanceable. */
function formatThroughput(tps: number): string {
  if (tps >= 1000) return `${(tps / 1000).toFixed(tps >= 10000 ? 0 : 1)}k`;
  if (tps >= 100) return `${Math.round(tps)}`;
  if (tps >= 10) return tps.toFixed(1);
  return tps.toFixed(2);
}

/** R58 — "1.2k" / "12k" / "1.5m" formatter for raw token counts.
 *  Mirrors how ChatMinimap / ContextUsagePill already shorten large
 *  numbers so the meta chip reads consistently across the app. */
function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

/** R8.14 — `12s` / `1m 5s` formatter. Mirrors ChatView's existing
 *  `formatInFlightElapsed` so the per-message chip and the per-turn
 *  status pill stay visually consistent. */
function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${seconds}s`;
}

/** R8.14 — Chinese relative-time formatter. Mirrors how iOS / WeChat
 *  surface chat timestamps: 0–59s → `刚刚`, 1–59m → `X 分钟前`, 1–23h →
 *  `X 小时前`, 1d → `昨天`, 2–6d → `X 天前`, ≥7d → absolute MM-DD. */
function formatRelativeTime(deltaMs: number): string {
  const ms = Math.max(0, deltaMs);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 7) return `${day} 天前`;
  const date = new Date(Date.now() - ms);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

/**
 * R8.3 (inline-edit) — user-message bubble as its own component so the
 * inline-edit textarea can hold local state without bloating MessageItemInner.
 *
 * Lifecycle:
 *   - Mount: read-only display of the active revision text.
 *   - Double-click on the bubble body → enter edit mode; the textarea is
 *     auto-focused and pre-seeded with the active revision text.
 *   - Esc → cancel; Cmd/Ctrl+Enter → submit. Click 发送 button as an alt.
 *   - Submitting fires `onInlineResend(messageId, text)`. ChatView wires
 *     this to the same appendUserRevision + composer seed path so the
 *     revision pager history stays in sync.
 *
 * Design notes:
 *   - File/image parts stay mounted above the textarea so the user keeps
 *     visibility into attachments while editing the prompt.
 *   - The textarea grows between 3..12 rows based on line count, mirroring
 *     PI-Desktop's `Math.min(12, Math.max(3, lines))` heuristic.
 *   - We deliberately do NOT swallow Enter into submit; users paste
 *     multi-line prompts often and Enter should add a newline. Cmd/Ctrl
 *     +Enter is the universal "send" shortcut.
 */
type RevisionPagerInfo =
  | { current: number; total: number }
  | null;

function UserBubble({
  message,
  userDisplayedText,
  fileParts,
  revisionPager,
  onStepRevision,
  onEditResend,
  onInlineResend,
  onToast,
  copyText,
}: {
  message: ChatMessage;
  userDisplayedText: string;
  fileParts: Array<{ name: string; mediaType: string; data: string }>;
  revisionPager: RevisionPagerInfo;
  onStepRevision?: (messageId: string, direction: -1 | 1) => void;
  onEditResend?: (text: string) => void;
  onInlineResend?: (messageId: string, text: string) => void;
  onToast?: (msg: string) => void;
  copyText: (text: string, label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(userDisplayedText);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // When the user scrubs the revision pager, sync the draft so cancelling
  // a mid-edit pager switch doesn't lose the prior version's text.
  useEffect(() => {
    if (!editing) setDraft(userDisplayedText);
  }, [userDisplayedText, editing]);

  // Auto-focus + auto-grow rows once we enter edit mode.
  useEffect(() => {
    if (!editing) return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    // Place caret at end so the user can keep typing without re-positioning.
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
    // Adjust rows to current line count, clamped 3..12.
    const lines = ta.value.split("\n").length;
    ta.rows = Math.min(12, Math.max(3, lines));
  }, [editing]);

  const startEdit = () => {
    if (!onInlineResend) return;
    setDraft(userDisplayedText);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(userDisplayedText);
    setEditing(false);
  };

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (trimmed === userDisplayedText.trim()) {
      // No change → cancel silently so the user doesn't accidentally
      // trigger a re-send of the same text.
      setEditing(false);
      return;
    }
    onInlineResend?.(message.id, trimmed);
    setEditing(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="msg msg--user">
      <div>
        {/* Attachments stay mounted above the text in both display and edit
            modes so the user always sees what they uploaded. */}
        {fileParts.map((p, i) => (
          <FilePreview
            key={`f-${i}`}
            filename={p.name || "attachment"}
            content={toPreviewDataUrl(p.mediaType, p.data)}
          />
        ))}
        {editing ? (
          <div className="msg__edit" data-testid="user-bubble-edit">
            <textarea
              ref={textareaRef}
              className="msg__edit-input selectable"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                const lines = e.target.value.split("\n").length;
                e.target.rows = Math.min(12, Math.max(3, lines));
              }}
              onKeyDown={onKeyDown}
              rows={Math.min(12, Math.max(3, draft.split("\n").length))}
              aria-label="编辑消息"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              data-testid="user-bubble-edit-input"
            />
            <div className="msg__edit-actions">
              <span className="msg__edit-hint">Esc 取消 · ⌘/Ctrl+Enter 发送</span>
              <TooltipButton
                className="msg__action-btn"
                tooltip="取消（Esc）"
                onClick={cancelEdit}
                aria-label="取消编辑"
                tooltipSide="bottom"
              >
                <span style={{ fontSize: 11, padding: "0 4px" }}>取消</span>
              </TooltipButton>
              <TooltipButton
                className="msg__action-btn msg__action-btn--primary"
                tooltip="重新发送（⌘/Ctrl+Enter）"
                onClick={submit}
                disabled={!draft.trim() || draft.trim() === userDisplayedText.trim()}
                data-testid="user-bubble-edit-submit"
                aria-label="发送编辑"
                variant="primary"
                tooltipSide="bottom"
              >
                <span style={{ fontSize: 11, padding: "0 4px" }}>发送</span>
              </TooltipButton>
            </div>
          </div>
        ) : (
          <div
            className="msg__bubble msg__bubble--editable"
            onDoubleClick={startEdit}
            title={onInlineResend ? "双击编辑" : undefined}
            data-testid="user-bubble-display"
          >
            <span className="msg__bubble-text" key={`r-${revisionPager?.current ?? 0}`}>
              {userDisplayedText}
            </span>
          </div>
        )}
        {/* R8.1 — revision pager sits inside the hover-actions row so it
            inherits the same fade-in / opacity-0.55 styling. Hidden when
            there is only one revision. */}
        {revisionPager && onStepRevision ? (
          <div
            className="msg__revision-pager"
            role="group"
            aria-label={`版本 ${revisionPager.current} / ${revisionPager.total}`}
          >
            <button
              type="button"
              className="msg__revision-btn"
              onClick={() => onStepRevision(message.id, -1)}
              disabled={revisionPager.current <= 1}
              title="上一版"
              aria-label="上一版"
            >
              ‹
            </button>
            <span className="msg__revision-label">
              {revisionPager.current} / {revisionPager.total}
            </span>
            <button
              type="button"
              className="msg__revision-btn"
              onClick={() => onStepRevision(message.id, 1)}
              disabled={revisionPager.current >= revisionPager.total}
              title="下一版"
              aria-label="下一版"
            >
              ›
            </button>
          </div>
        ) : null}
        {/* Hover actions (only when not editing) — icon-only TooltipButtons.
            复制 swaps to a check on success; 编辑 triggers inline edit
            (double-click on the bubble does the same). */}
        {!editing && (
          <div className="msg__actions">
            <CopyIconButton
              tooltip="复制"
              copiedTooltip="已复制"
              onCopy={() => copyText(userDisplayedText, "已复制")}
            />
            {onInlineResend && (
              <TooltipButton
                className="msg__action-btn"
                tooltip="编辑（双击消息也可）"
                onClick={startEdit}
                data-testid="user-bubble-edit-btn"
                aria-label="编辑消息"
              >
                <Pencil size={14} strokeWidth={1.75} />
              </TooltipButton>
            )}
            {onEditResend && !onInlineResend && (
              <TooltipButton
                className="msg__action-btn"
                tooltip="编辑并重新发送"
                onClick={() => onEditResend(userDisplayedText)}
                aria-label="编辑并重新发送"
              >
                <Pencil size={14} strokeWidth={1.75} />
              </TooltipButton>
            )}
          </div>
        )}
        {/* R8.14 — relative-timestamp chip beneath the user bubble.
            Always rendered (no hover gate) so the chat transcript reads
            like a normal messenger scroll: you can scroll back and see
            "5 分钟前" next to an old prompt without having to hover. */}
        {typeof message.createdAt === "number" && (
          <div className="msg__meta msg__meta--user" aria-label={formatRelativeTime(Date.now() - message.createdAt)}>
            <span className="msg__meta-icon" aria-hidden="true">
              <Clock3 size={10} strokeWidth={1.75} />
            </span>
            <span className="msg__meta-time">{formatRelativeTime(Date.now() - message.createdAt)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * R8.11 — CopyIconButton: 26×26 icon-only copy button that briefly swaps
 * to a checkmark on success (mirrors cabinet's CopyButton pattern).
 * Keeps the toast for screen-reader / non-visual confirmation. */
function CopyIconButton({
  tooltip,
  copiedTooltip,
  onCopy,
  idleIcon,
  copiedIcon,
}: {
  tooltip: string;
  copiedTooltip: string;
  onCopy: () => void;
  idleIcon?: React.ReactNode;
  copiedIcon?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const handle = useCallback(() => {
    onCopy();
    setCopied(true);
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [onCopy]);
  const Icon = copied
    ? (copiedIcon ?? <Check size={14} strokeWidth={2} />)
    : (idleIcon ?? <Copy size={14} strokeWidth={1.75} />);
  return (
    <TooltipButton
      className="msg__action-btn"
      tooltip={copied ? copiedTooltip : tooltip}
      onClick={handle}
      aria-label={copied ? copiedTooltip : tooltip}
    >
      {Icon}
    </TooltipButton>
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
    prev.onInlineResend === next.onInlineResend &&
    prev.onRetry === next.onRetry &&
    prev.onOpenSettings === next.onOpenSettings
  );
});
