import { useEffect, useRef, useState } from "react";
import { usePermissionStore, selectPermissionForSession } from "@/stores/permission-store";
import { piResolvePermission } from "@/lib/agent/pi-client";

/**
 * Session-scoped permission modal. Switching conversations remains unblocked.
 */
export function PermissionInlineCard({ sessionId }: { sessionId: string | null }) {
  const head = usePermissionStore(selectPermissionForSession(sessionId));
  const dismiss = usePermissionStore((s) => s.dismiss);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const resolve = async (optionId?: string, cancelled = false) => {
    if (!head || busy) return;
    setBusy(true);
    const id = head.requestId;
    dismiss(id, head.sessionId);
    try {
      await piResolvePermission(id, { optionId, cancelled });
    } catch (e) {
      console.error("resolve permission failed", e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!head) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) void resolve(undefined, true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [head?.requestId, busy]);

  if (!head) return null;

  return (
    <div className="request-modal-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) void resolve(undefined, true);
    }}>
      <div className="request-modal request-modal--permission" role="dialog" aria-modal="true" aria-labelledby="permission-dialog-title">
        <div className="request-modal__head">
          <div className="request-modal__identity">
            <span className="request-modal__icon request-modal__icon--permission" aria-hidden="true">!</span>
            <div>
              <span className="request-modal__eyebrow">需要你的确认</span>
              <h2 id="permission-dialog-title" className="request-modal__title">{head.title || "允许 Agent 执行操作？"}</h2>
            </div>
          </div>
          <span className="request-modal__kind">{head.toolKind}</span>
        </div>
        <div className="request-modal__body">
          <p className="request-modal__description">pi agent 请求执行以下操作。请确认内容后选择允许或拒绝。</p>
          {head.rawInput != null && (
            <pre className="request-modal__raw">{JSON.stringify(head.rawInput, null, 2)}</pre>
          )}
        </div>
        <div className="request-modal__footer">
          <span className="request-modal__hint">按 Esc 取消</span>
          <div className="request-modal__actions">
            <button ref={cancelRef} type="button" className="btn btn--ghost" onClick={() => void resolve(undefined, true)} disabled={busy}>取消</button>
            <button type="button" className="btn btn--danger" onClick={() => {
              const deny = head.options.find((o) => o.kind === "deny");
              void resolve(deny?.optionId);
            }} disabled={busy}>拒绝</button>
            {head.options
              .filter((o) => o.kind === "allow" || o.kind === "allow_always")
              .map((o) => (
                <button key={o.optionId} type="button" className={"btn " + (o.kind === "allow_always" ? "btn--ghost" : "btn--primary")} onClick={() => void resolve(o.optionId)} disabled={busy}>
                  {o.title}
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
