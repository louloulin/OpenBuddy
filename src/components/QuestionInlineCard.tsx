import { useEffect, useState } from "react";
import { useQuestionStore, selectQuestionForSession, type QuestionRequest } from "@/stores/question-store";
import { agentResolveUi } from "@/lib/agent-client";

/** Drafts stay inside a keyed, session-scoped form and never enter logs or history. */
export function QuestionInlineCard({ sessionId }: { sessionId: string | null }) {
  const request = useQuestionStore(selectQuestionForSession(sessionId));
  const notice = useQuestionStore(state => sessionId ? state.notices[sessionId] : undefined);
  if (!request) return notice ? <p role="status" className="question-inline">{notice}</p> : null;
  return <ExtensionInput key={`${request.sessionId}:${request.requestId}`} request={request} />;
}
function ExtensionInput({ request }: { request: QuestionRequest }) {
  const [value, setValue] = useState(request.initialValue ?? "");
  const [hidden, setHidden] = useState(!!request.secret || /password|secret|api.?key|密码|密钥/i.test(request.title));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (request.expiresAt === undefined) return;
    const timer = setTimeout(() => useQuestionStore.getState().dismiss(request.requestId, request.sessionId, "timeout"), Math.max(0, request.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [request.expiresAt, request.requestId, request.sessionId]);
  const respond = async (answer: { value?: string | boolean; cancelled?: boolean }) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await agentResolveUi({ requestId: request.requestId, sessionId: request.sessionId, ...answer });
      useQuestionStore.getState().dismiss(request.requestId, request.sessionId, answer.cancelled ? "cancelled" : "resolved");
    } catch { setError("提交失败，请重试。若请求已结束，可取消此表单。"); }
    finally { setBusy(false); }
  };
  const inputId = `extension-input-${request.requestId}`;
  return <section className="question-inline" aria-label={request.title} aria-busy={busy}>
    <div className="question-inline__head"><h3 className="question-inline__title">{request.title}</h3></div>
    {request.message && <p>{request.message}</p>}
    <div className="question-inline__body">
      {request.kind === "select" && <div className="question-inline__options">{request.options?.map(option => <button key={option} type="button" disabled={busy} className="question-inline__option" onClick={() => { void respond({ value: option }); }}>{option}</button>)}</div>}
      {(request.kind === "input" || request.kind === "editor") && <form onSubmit={event => { event.preventDefault(); void respond({ value }); }}>
        <label htmlFor={inputId}>{request.title}</label>
        {request.kind === "editor" ? <textarea id={inputId} className={`question-inline__custom-input${hidden ? " extension-input--hidden" : ""}`} value={value} placeholder={request.placeholder} disabled={busy} onChange={event => setValue(event.target.value)} /> : <input id={inputId} type={hidden ? "password" : "text"} autoComplete="off" spellCheck={false} className="question-inline__custom-input" value={value} placeholder={request.placeholder} disabled={busy} onChange={event => setValue(event.target.value)} />}
        <label><input type="checkbox" checked={hidden} onChange={event => setHidden(event.target.checked)} />隐藏输入内容</label>
        <button className="btn btn--primary" type="submit" disabled={busy}>提交</button>
      </form>}
      {request.kind === "confirm" && <div className="question-inline__options"><button className="btn btn--primary" disabled={busy} onClick={() => { void respond({ value: true }); }}>确认</button><button className="btn btn--ghost" disabled={busy} onClick={() => { void respond({ value: false }); }}>拒绝</button></div>}
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="question-inline__footer"><button className="btn btn--ghost" disabled={busy} onClick={() => { void respond({ cancelled: true }); }}>取消</button></div>
  </section>;
}
