/**
 * 底部居中的轻量提示。
 *  - 旧 API:`<Toast message={...} />` — 单条消息,无队列。
 *  - 新 API:`<Toast entries={...} onDismiss={...} />` — 队列模式(R2.3 多 toast)。
 * 两种模式互斥;传 `entries` 时 `message` 被忽略。
 */
export interface ToastActionLike {
  label: string;
  onClick: () => void;
  hint?: string;
}

export interface ToastEntryLike {
  id: string;
  message: string;
  kind?: "info" | "warning" | "error";
  ttlMs?: number;
  action?: ToastActionLike;
}

export function Toast({
  message,
  entries,
  onDismiss,
}: {
  message?: string | null;
  entries?: ReadonlyArray<ToastEntryLike>;
  onDismiss?: (id: string) => void;
}) {
  // R4.2 — always mount the role="status" / aria-live wrapper so the
  // agent-died recovery surface has a live region to write into as
  // soon as the renderer boots (see tests/electron/agent-died.spec.ts).
  // When the queue is empty the wrapper stays in the DOM with no
  // children so screen readers still pick it up; new toasts animate in
  // without re-mounting the wrapper.
  if (entries) {
    return (
      <div className="toast-stack" role="status" aria-live="polite">
        {entries.map((e) => (
          <div
            key={e.id}
            className={"toast toast--" + (e.kind ?? "info")}
            role="status"
          >
            {/* 整条 toast 之前是一个带 onClick 的 div（点击即消失）。
                现在关闭入口是一个真正的 button —— 键盘可达，且不会因为
                误触文本就丢掉提示。同时 role="status" 不再被覆盖。 */}
            <button
              type="button"
              onClick={() => onDismiss?.(e.id)}
              aria-label={`关闭提示：${e.message}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                flex: "1 1 auto",
                minWidth: 0,
                padding: 0,
                background: "none",
                border: 0,
                font: "inherit",
                color: "inherit",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span className="toast__message">{e.message}</span>
              <span aria-hidden="true" style={{ marginLeft: "auto", opacity: 0.6, lineHeight: 1 }}>×</span>
            </button>
            {e.action ? (
              <button
                type="button"
                className="toast__action"
                onClick={(ev) => {
                  ev.stopPropagation();
                  e.action?.onClick();
                  onDismiss?.(e.id);
                }}
                aria-label={`${e.action.label}（${e.message}）`}
              >
                {e.action.label}
                {e.action.hint ? <span className="toast__action-hint">{e.action.hint}</span> : null}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    );
  }
  if (!message) return null;
  return <div className="toast" role="status">{message}</div>;
}
