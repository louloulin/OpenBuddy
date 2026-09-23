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
import { useEffect, useRef, useState } from "react";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Clock3 from "lucide-react/dist/esm/icons/clock-3";
import { TooltipButton } from "../TooltipButton";
import { FilePreview } from "@openbuddy/ui-workbench";
import type { ChatMessage } from "@/stores/session-store";
import { formatRelativeTime } from "@/lib/ui/duration";
import { CopyIconButton } from "./CopyIconButton";

function toPreviewDataUrl(mediaType: string, data: string): string {
  if (data.startsWith("data:")) return data;
  return `data:${mediaType || "application/octet-stream"};base64,${data}`;
}

type RevisionPagerInfo =
  | { current: number; total: number }
  | null;

export function UserBubble({
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
