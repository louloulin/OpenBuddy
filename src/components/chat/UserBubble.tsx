import { useEffect, useRef, useState } from "react";
import { openLightbox } from "../ImageLightbox";
import type { ChatMessage } from "@/stores/session-store";
import { copyText } from "@/lib/clipboard";
import { baseName } from "@/lib/user-text";
import { CopyGlyph, EditGlyph, FileGlyph } from "./icons";

/** Prompts longer than this fold to a few lines. */
const LONG_PROMPT_CHARS = 800;
const LONG_PROMPT_LINES = 12;
/** While folded only the head is rendered (enough to fill the clamp). */
const FOLDED_RENDER_CHARS = 1200;

/**
 * The user's prompt: own words plus attachment / skill chips; never injected context.
 * 编辑 opens the prompt in place; nothing is rewound until the edit is sent.
 */
export function UserBubble({ message, onEdit, onToast }: {
  message: ChatMessage;
  /**
   * Restart from this prompt with new text: resend it, or (when the prompt had
   * files, which must be re-attached) put it back in the composer. Absent while a reply runs.
   */
  onEdit?: (text: string, resend: boolean) => void | Promise<void>;
  onToast?: (msg: string) => void;
}) {
  const text = message.parts.map((p) => (p.kind === "text" ? p.text : "")).join("\n");
  const meta = message.meta;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasFiles = !!(meta?.attachments?.length || meta?.images?.length);
  // Pasted material can be huge: fold long prompts to a few lines (and render only the head while folded).
  const long = text.length > LONG_PROMPT_CHARS || text.split("\n").length > LONG_PROMPT_LINES;
  const [unfolded, setUnfolded] = useState(false);
  const folded = long && !unfolded;

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }, [editing]);
  // A reply started elsewhere (or the prompt was replaced): leave edit mode.
  useEffect(() => { if (!onEdit) setEditing(false); }, [onEdit]);

  const startEdit = () => { setDraft(text); setEditing(true); };
  const cancel = () => { setEditing(false); setDraft(text); };
  const submit = async () => {
    const next = draft.trim();
    if (!next || sending || !onEdit) return;
    setSending(true);
    try {
      await onEdit(next, !hasFiles);
      setEditing(false);
    } finally {
      setSending(false);
    }
  };

  if (editing) {
    return (
      <div className="msg msg--user msg--editing">
        <div className="msg__edit">
          <textarea
            ref={inputRef}
            className="msg__edit-input"
            value={draft}
            aria-label="编辑提问"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
              else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
            }}
          />
          <div className="msg__edit-foot">
            <span className="msg__edit-hint">{hasFiles ? "附件需要在输入框里重新添加；之后的对话会被替换" : "从这里重新开始，之后的对话会被替换"}</span>
            <button type="button" className="msg__edit-btn" onClick={cancel} disabled={sending}>取消</button>
            <button type="button" className="msg__edit-btn msg__edit-btn--primary" onClick={() => void submit()} disabled={sending || !draft.trim()}>
              {sending ? "处理中…" : hasFiles ? "放回输入框" : "发送"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg msg--user" data-pending={meta?.pending ? "" : undefined}>
      <div className="msg__user-col">
        {hasFiles ? (
          <div className="msg__chips">
            {meta?.images?.map((img, i, all) => (
              <button key={`img${i}`} type="button" className="msg__thumb-btn" aria-label={`查看图片 ${i + 1}`} onClick={() => openLightbox(all.map((x, j) => ({ src: `data:${x.mimeType};base64,${x.data}`, alt: `图片 ${j + 1}` })), i)}>
                <img className="msg__thumb" src={`data:${img.mimeType};base64,${img.data}`} alt={`图片 ${i + 1}`} />
              </button>
            ))}
            {meta?.attachments?.filter((path) => !meta.images?.length || !/\.(png|jpe?g|gif|webp)$/i.test(path)).map((path) => (
              <span key={path} className="msg__chip" title={path}><FileGlyph /><span className="msg__chip-name">{baseName(path)}</span></span>
            ))}
          </div>
        ) : null}
        {(text || meta?.skill || meta?.mode) && (
          <div className={"msg__bubble" + (folded ? " msg__bubble--folded" : "")}>
            {meta?.skill && <span className="msg__skill">技能 · {meta.skill}</span>}
            {meta?.mode && <span className="msg__skill msg__mode">{meta.mode === "plan" ? "想一想" : "问一问"}</span>}
            {text && <span className="msg__bubble-text">{folded ? text.slice(0, FOLDED_RENDER_CHARS) : text}</span>}
            {long && (
              <div>
                <button type="button" className="msg__more" onClick={() => setUnfolded((v) => !v)} aria-expanded={unfolded}>
                  {unfolded ? "收起" : `展开全部（${text.length.toLocaleString()} 字）`}
                </button>
              </div>
            )}
          </div>
        )}
        {text && (
          <div className="msg__actions">
            <button type="button" className="turn-action" onClick={() => copyText(text).then(() => onToast?.("已复制"), () => onToast?.("复制失败"))} aria-label="复制" data-tip="复制"><CopyGlyph /></button>
            {onEdit && !meta?.pending && <button type="button" className="turn-action" onClick={startEdit} aria-label="编辑" data-tip="编辑"><EditGlyph /></button>}
          </div>
        )}
      </div>
    </div>
  );
}
