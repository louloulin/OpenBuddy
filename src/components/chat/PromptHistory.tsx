import { useEffect, useMemo, useRef, useState } from "react";
import { History } from "lucide-react";
import type { ChatMessage } from "@/stores/session-store";
import { baseName } from "@/lib/user-text";

function clock(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** One line describing a prompt: its words, else its attachments. */
export function promptPreview(message: ChatMessage): string {
  const text = message.parts.map((p) => (p.kind === "text" ? p.text : "")).join(" ").replace(/\s+/g, " ").trim();
  if (text) return text;
  const files = message.meta?.attachments ?? [];
  if (files.length) return `附件：${files.map(baseName).join("、")}`;
  return message.meta?.skill ? `技能 · ${message.meta.skill}` : "（空消息）";
}

/**
 * Top-bar "提问历史": every prompt of this task, newest last; picking one
 * scrolls the transcript to it.
 */
export function PromptHistory({ messages, onJump }: { messages: ChatMessage[]; onJump: (messageId: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const prompts = useMemo(
    () => messages.filter((m) => m.role === "user").map((m, i) => ({ id: m.id, index: i + 1, text: promptPreview(m), time: m.meta?.timestamp })),
    [messages],
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="prompt-history" ref={ref}>
      <button
        type="button"
        className={"main-topbar__btn" + (open ? " main-topbar__btn--active" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-label="提问历史"
        aria-expanded={open}
        data-tip="提问历史"
        disabled={!prompts.length}
      >
        <History size={16} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="prompt-history__popover ob-pop" role="menu" aria-label="本任务的提问">
          <div className="prompt-history__head">本任务的提问 · {prompts.length}</div>
          <ol className="prompt-history__list">
            {prompts.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="menuitem"
                  className="prompt-history__item"
                  onClick={() => { setOpen(false); onJump(p.id); }}
                  title={p.text}
                >
                  <span className="prompt-history__index">{p.index}</span>
                  <span className="prompt-history__text">{p.text}</span>
                  {p.time ? <span className="prompt-history__time">{clock(p.time)}</span> : null}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
