import { useEffect, useRef, useState } from "react";
import { usePermissionStore, selectPermissionForSession } from "@/features/approvals/state/permission-store";
import { agentResolvePermission } from "@openbuddy/client/agent-client";
import type { PermissionRequest } from "@openbuddy/protocol/dto";
import { isUserBashRequest } from "@openbuddy/protocol/bash";
import { checkCommandRisk, riskLabel } from "@openbuddy/chat-core/command-risk";
import { permissionObjectLabel, permissionTitle, toolCategory, toolSubject } from "@openbuddy/chat-core/tool-summary";
import { ShieldAlertIcon } from "@openbuddy/ui/icon/icons/index";

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
  const safeRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  /** The last key pressed anywhere was Tab, and the danger button was reached that way. */
  const tabbedRef = useRef(false);
  const armedRef = useRef(false);
  const tool = request.toolKind ?? request.title ?? "";
  const subject = toolSubject(tool, request.rawInput, cwd) || (request.rawInput != null ? JSON.stringify(request.rawInput) : "");
  const risk = toolCategory(tool) === "command" ? checkCommandRisk(subject) : undefined;
  const fullInput = request.rawInput != null ? JSON.stringify(request.rawInput, null, 2) : "";
  const destructive = request.destructive;
  // A command the user typed (`!cmd`, W1.2) that needs the strong confirmation.
  const typed = isUserBashRequest(request);
  const title = typed ? (destructive?.paths?.length ? "这条命令会删除文件，确定要执行吗？" : "这条命令有风险，确定要执行吗？") : destructive ? "Buddy 想删除文件，需要你确认" : permissionTitle(tool);
  // Deletions and typed commands' strong confirmation: the keyboard lands on the safe action, and
  // the danger action answers Enter / Space only after the user moved to it with Tab (or clicks it),
  // so a repeated Enter (`!rm -rf build` ⏎ ⏎) cancels instead of running.
  const strong = !!destructive;

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
    if (idle) (strong ? safeRef : primaryRef).current?.focus({ preventScroll: true });
  }, [request.requestId]);
  // Into the reason field, and back to the card's default action once the buttons are mounted again.
  const refocusRef = useRef(false);
  useEffect(() => {
    if (denying) reasonRef.current?.focus();
    else if (refocusRef.current) (strong ? safeRef : primaryRef).current?.focus();
    refocusRef.current = false;
  }, [denying]);
  useEffect(() => {
    if (!strong) return;
    const onKey = (e: KeyboardEvent) => { tabbedRef.current = e.key === "Tab"; };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [strong]);
  /** Swallow keyboard activation of the danger button unless it was reached with Tab. */
  const guardKey = (e: React.KeyboardEvent) => {
    if (strong && !armedRef.current && (e.key === "Enter" || e.key === " ")) e.preventDefault();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (busy || e.nativeEvent.isComposing) return;
    const inReason = e.target === reasonRef.current;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (denying) { refocusRef.current = true; setDenying(false); setReason(""); }
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
        <span className="perm-card__title">{title}</span>
        {/* 子代理 (W3.4): say which sub-agent asked before the user approves for it. */}
        {request.subagent && <span className="perm-card__from">来自子代理 {request.subagent.name ?? "子代理"}</span>}
        {(!destructive || typed) && risk && risk.level !== "low" && (
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
          {!typed && <button type="button" className="perm-card__btn perm-card__btn--quiet" disabled={busy} onClick={() => setDenying(true)} title="拒绝并告诉 Buddy 原因，它会换一种做法">拒绝并说明…</button>}
          <span className="perm-card__spacer" />
          <button ref={safeRef} type="button" className="perm-card__btn" disabled={busy} onClick={() => resolve(option("deny")?.optionId ?? "deny")} title={strong ? "Enter / Esc" : "Esc"}>{typed ? "取消" : "拒绝"}</button>
          {option("allow_session") && (
            <button type="button" className="perm-card__btn" disabled={busy} onClick={() => resolve("allow_session")}>本任务允许</button>
          )}
          {option("allow_always") && (
            <button type="button" className="perm-card__btn" disabled={busy} onClick={() => resolve("allow_always")} title="记为一条允许规则，可在 设置·安全中心 修改">始终允许</button>
          )}
          <button ref={primaryRef} type="button" className={"perm-card__btn perm-card__btn--primary" + (destructive ? " perm-card__btn--danger" : "")} disabled={busy} onClick={() => resolve(option("allow")?.optionId ?? "allow")}
            title={strong ? "点击，或用 Tab 选中后按 Enter" : "Enter"} onFocus={() => { armedRef.current = tabbedRef.current; }} onBlur={() => { armedRef.current = false; }} onKeyDown={guardKey} onKeyUp={guardKey}>
            {typed ? "仍要执行" : destructive ? "允许删除" : "允许本次"}
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
