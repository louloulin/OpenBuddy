import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useQuestionStore, selectQuestionForSession } from "@/stores/question-store";
import { piResolveQuestion } from "@/lib/agent/pi-client";

/** Session-scoped question modal rendered above the current conversation. */
function QuestionInlineCardInner({ sessionId }: { sessionId: string | null }) {
  const head = useQuestionStore(selectQuestionForSession(sessionId));
  const dismiss = useQuestionStore((s) => s.dismiss);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const handleSelect = useCallback((questionId: string, option: string) => {
    setSelections((prev) => ({ ...prev, [questionId]: option }));
    setCustomInputs((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  }, []);

  const handleCustomInput = useCallback((questionId: string, value: string) => {
    setCustomInputs((prev) => ({ ...prev, [questionId]: value }));
    setSelections((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  }, []);

  const handleSubmit = async () => {
    if (!head || busy) return;
    setBusy(true);
    const answers: Record<string, string | string[]> = {};
    const annotations: Record<string, { notes?: string }> = {};
    for (const q of head.questions) {
      const key = q.question || q.id;
      const selected = selections[q.id];
      const custom = (customInputs[q.id] ?? "").trim();
      if (selected) {
        answers[key] = selected;
        if (custom) annotations[key] = { notes: custom };
      } else if (custom) {
        answers[key] = "Other";
        annotations[key] = { notes: custom };
      }
    }
    try {
      dismiss(head.requestId, head.sessionId);
      await piResolveQuestion(head.requestId, {
        answers,
        annotations: Object.keys(annotations).length ? annotations : undefined,
      });
    } catch (e) {
      console.error("resolve question failed", e);
    } finally {
      setBusy(false);
      setSelections({});
      setCustomInputs({});
    }
  };

  const handleCancel = async () => {
    if (!head || busy) return;
    setBusy(true);
    try {
      dismiss(head.requestId, head.sessionId);
      await piResolveQuestion(head.requestId, { cancelled: true });
    } catch (e) {
      console.error("cancel question failed", e);
    } finally {
      setBusy(false);
      setSelections({});
      setCustomInputs({});
    }
  };

  const hasAnswer = head?.questions.some(
    (q) => (selections[q.id] ?? customInputs[q.id] ?? "").length > 0,
  ) ?? false;

  useEffect(() => {
    if (!head) return;
    firstInputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) void handleCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [head?.requestId, busy]);

  if (!head) return null;

  return (
    <div className="request-modal-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) void handleCancel();
    }}>
      <div className="request-modal request-modal--question" role="dialog" aria-modal="true" aria-labelledby="question-dialog-title">
        <div className="request-modal__head">
          <div className="request-modal__identity">
            <span className="request-modal__icon request-modal__icon--question" aria-hidden="true">?</span>
            <div>
              <span className="request-modal__eyebrow">Agent 正在等待你的回答</span>
              <h2 id="question-dialog-title" className="request-modal__title">{head.title || "Agent 提问"}</h2>
            </div>
          </div>
          <span className="request-modal__step">{head.questions.length} 个问题</span>
        </div>
        <div className="request-modal__body">
          {head.questions.map((q, index) => (
            <div key={q.id} className="request-modal__question">
              <p className="request-modal__question-text"><span>{index + 1}</span>{q.question}</p>
              {q.options.length > 0 && (
                <div className="request-modal__options">
                  {q.options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      className={"request-modal__option" + (selections[q.id] === opt ? " request-modal__option--selected" : "")}
                      onClick={() => handleSelect(q.id, opt)}
                      disabled={busy}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              <input
                ref={index === 0 ? firstInputRef : undefined}
                type="text"
                className="request-modal__custom-input"
                placeholder="输入自定义回答…"
                value={customInputs[q.id] ?? ""}
                onChange={(event) => handleCustomInput(q.id, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && hasAnswer && !busy) void handleSubmit();
                }}
                disabled={busy}
              />
            </div>
          ))}
        </div>
        <div className="request-modal__footer">
          <span className="request-modal__hint">按 Esc 跳过</span>
          <div className="request-modal__actions">
            <button type="button" className="btn btn--ghost" onClick={() => void handleCancel()} disabled={busy}>跳过</button>
            <button type="button" className="btn btn--primary" onClick={() => void handleSubmit()} disabled={busy || !hasAnswer}>{busy ? "提交中…" : "提交"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * R1.4 — Memoized question modal. The card only re-renders when its
 * `sessionId` prop changes (session switch). Internal state
 * (`selections`, `customInputs`, `busy`) is local so the memo
 * comparator only needs to look at the primitive `sessionId`.
 */
export const QuestionInlineCard = memo(QuestionInlineCardInner);
