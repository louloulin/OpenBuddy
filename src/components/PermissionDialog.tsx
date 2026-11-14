import { useState } from "react";
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
  const tool = request.toolKind ?? request.title ?? "";
  const subject = toolSubject(tool, request.rawInput, cwd) || (request.rawInput != null ? JSON.stringify(request.rawInput) : "");
  const risk = toolCategory(tool) === "command" ? checkCommandRisk(subject) : undefined;
  const fullInput = request.rawInput != null ? JSON.stringify(request.rawInput, null, 2) : "";

  const resolve = async (optionId: string) => {
    setBusy(true);
    setError(null);
    try {
      await agentResolvePermission(request.requestId, { optionId });
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

  return (
    <div className="perm-card" role="group" aria-label={permissionTitle(tool)}>
      <div className="perm-card__head">
        <ShieldAlertIcon size={16} className="perm-card__icon" />
        <span className="perm-card__title">{permissionTitle(tool)}</span>
        {risk && risk.level !== "low" && (
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
      {error && <div className="perm-card__error" role="alert">{error}</div>}
      <div className="perm-card__actions">
        <button type="button" className="perm-card__btn" disabled={busy} onClick={() => resolve(option("deny")?.optionId ?? "deny")}>拒绝</button>
        {option("allow_session") && (
          <button type="button" className="perm-card__btn" disabled={busy} onClick={() => resolve("allow_session")}>本会话允许</button>
        )}
        <button type="button" className="perm-card__btn perm-card__btn--primary" disabled={busy} onClick={() => resolve(option("allow")?.optionId ?? "allow")}>允许本次</button>
      </div>
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
