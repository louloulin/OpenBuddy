import { useEffect, useRef, useState } from "react";
import { usePermissionStore, selectPermissionForSession } from "@/stores/permission-store";
import { agentResolvePermission } from "@/lib/agent-client";
import type { PermissionRequest } from "@/lib/types";
import { checkCommandRisk, riskLabel } from "@/lib/command-risk";
import { permissionObjectLabel, permissionTitle, toolCategory, toolSubject } from "@/lib/tool-summary";
import { ShieldAlertIcon } from "@/foundation/components/Icon/icons";

/** Open 设置 → 安全中心 (wired by App through a window event to avoid prop drilling). */
export function openSecurityCenter() {
  window.dispatchEvent(new CustomEvent("openbuddy:open-settings", { detail: { section: "security" } }));
}

/**
 * Approval card shown right under the tool row that triggered it.
 * Resolution is optimistic only after the engine accepted it; a failed
 * resolve keeps the card so the request is never silently lost.
 */
export function PermissionCard({ request, cwd }: { request: PermissionRequest; cwd?: string }) {
  const dismiss = usePermissionStore((s) => s.dismiss);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const tool = request.toolKind ?? request.title ?? "";
  const subject = toolSubject(tool, request.rawInput, cwd) || (request.rawInput != null ? JSON.stringify(request.rawInput) : "");
  const risk = toolCategory(tool) === "command" ? checkCommandRisk(subject) : undefined;
  const fullInput = request.rawInput != null ? JSON.stringify(request.rawInput, null, 2) : "";
  const destructive = request.destructive;

  const resolve = async (optionId: string, note?: string) => {
    setBusy(true);
    setError(null);
    try {
      await agentResolvePermission(request.requestId, { optionId, reason: note });
      dismiss(request.requestId, request.sessionId);
    } catch (e) {
      // The request may have been settled by the engine (cancel/close); drop it then.
      const message = String(e);
      if (message.includes("不存在或已过期")) dismiss(request.requestId, request.sessionId);
      else setError("操作未生效，请重试");
    } finally {
      setBusy(false);
    }
  };
  const option = (id: string) => request.options.find((o) => o.optionId === id);

  // Take focus when nobody is typing, so Enter / Esc answer the card (§5.4).
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const idle = !active || active === document.body || ((active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && !active.value);
    if (idle) primaryRef.current?.focus({ preventScroll: true });
  }, [request.requestId]);
  useEffect(() => { if (denying) reasonRef.current?.focus(); }, [denying]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (busy || e.nativeEvent.isComposing) return;
    const inReason = e.target === reasonRef.current;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (denying) { setDenying(false); setReason(""); primaryRef.current?.focus(); }
      else void resolve(option("deny")?.optionId ?? "deny");
    } else if (e.key === "Enter" && inReason) {
      e.preventDefault();
      void resolve("deny", reason);
    }
  };

  return (
    <div ref={rootRef} className={"perm-card" + (destructive ? " perm-card--danger" : "")} role="group" aria-label={permissionTitle(tool)} onKeyDown={onKeyDown}>
      <div className="perm-card__head">
        <ShieldAlertIcon size={16} className="perm-card__icon" />
        <span className="perm-card__title">{destructive ? "Buddy 想删除文件，需要你确认" : permissionTitle(tool)}</span>
        {!destructive && risk && risk.level !== "low" && (
          <span className={"perm-card__risk perm-card__risk--" + risk.level} title={risk.reasons.join("；")}>{riskLabel(risk.level)}</span>
        )}
        <button type="button" className="perm-card__rules" onClick={openSecurityCenter}>查看拦截规则</button>
      </div>
      {subject && (
        <div className="perm-card__object">
          <span className="perm-card__object-label">{permissionObjectLabel(tool)}</span>
          <button
            type="button"
            className={"perm-card__object-value" + (expanded ? " perm-card__object-value--expanded" : "")}
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "收起" : "展开完整内容"}
          >
            {expanded ? fullInput : subject}
          </button>
        </div>
      )}
      {destructive && (destructive.paths?.length ?? 0) > 0 && (
        <div className="perm-card__danger-note">
          将删除：{destructive.paths!.slice(0, 6).join("、")}{destructive.paths!.length > 6 ? ` 等 ${destructive.paths!.length} 项` : ""}。删除的文件无法从这里还原。
        </div>
      )}
      {error && <div className="perm-card__error" role="alert">{error}</div>}
      {denying ? (
        <div className="perm-card__deny">
          <input
            ref={reasonRef}
            className="perm-card__reason"
            value={reason}
            maxLength={500}
            placeholder="告诉 Buddy 为什么拒绝、应该怎么做（可选）"
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
          <button type="button" className="perm-card__btn" disabled={busy} onClick={() => { setDenying(false); setReason(""); }}>返回</button>
          <button type="button" className="perm-card__btn perm-card__btn--primary" disabled={busy} onClick={() => void resolve("deny", reason)}>拒绝</button>
        </div>
      ) : (
        <div className="perm-card__actions">
          <button type="button" className="perm-card__btn perm-card__btn--quiet" disabled={busy} onClick={() => setDenying(true)} title="拒绝并告诉 Buddy 原因，它会换一种做法">拒绝并说明…</button>
          <span className="perm-card__spacer" />
          <button type="button" className="perm-card__btn" disabled={busy} onClick={() => resolve(option("deny")?.optionId ?? "deny")} title="Esc">拒绝</button>
          {option("allow_session") && (
            <button type="button" className="perm-card__btn" disabled={busy} onClick={() => resolve("allow_session")}>本任务允许</button>
          )}
          {option("allow_always") && (
            <button type="button" className="perm-card__btn" disabled={busy} onClick={() => resolve("allow_always")} title="记为一条允许规则，可在 设置·安全中心 修改">始终允许</button>
          )}
          <button ref={primaryRef} type="button" className={"perm-card__btn perm-card__btn--primary" + (destructive ? " perm-card__btn--danger" : "")} disabled={busy} onClick={() => resolve(option("allow")?.optionId ?? "allow")} title="Enter">
            {destructive ? "允许删除" : "允许本次"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Fallback: approval for a request whose tool row is not in the transcript
 * (e.g. an extension asking before any tool call). Rendered above the composer.
 */
export function PermissionInlineCard({ sessionId, cwd, exclude }: { sessionId: string | null; cwd?: string; exclude?: Set<string> }) {
  const head = usePermissionStore(selectPermissionForSession(sessionId));
  if (!head || (head.toolCallId && exclude?.has(head.toolCallId))) return null;
  return <PermissionCard request={head} cwd={cwd} />;
}
