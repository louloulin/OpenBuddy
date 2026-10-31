import { useEffect, useRef, useState } from "react";
import { usePermissionStore, selectPermissionForSession } from "@/stores/permission-store";
import { piResolvePermission } from "@/lib/agent/pi-client";
import { checkCommandRisk, riskLabel } from "@/lib/security/command-risk";

/**
 * Session-scoped permission card. Switching conversations remains unblocked.
 *
 * Two presentations share one implementation so there is exactly **one**
 * decision surface at a time:
 *  - `inline` (default for the chat footer): a normal card docked above the
 *    composer. It does not cover the transcript, so the message-level quick
 *    actions (allow / deny / later) stay clickable.
 *  - `modal`: a centered overlay used only when no inline host exists
 *    (standalone mounts, tests, other windows).
 *
 * History: the footer used to mount the modal variant unconditionally while
 * an expanded message hint mounted a second card. The overlay (z-index 1400)
 * then swallowed every click on the inline quick actions — the 2026-10-20
 * agent UX probe timed out on "允许" for exactly this reason.
 */
export function PermissionInlineCard({
  sessionId,
  variant = "modal",
}: {
  sessionId: string | null;
  variant?: "modal" | "inline";
}) {
  const head = usePermissionStore(selectPermissionForSession(sessionId));
  const queueLength = usePermissionStore((s) => (sessionId ? (s.queues[sessionId]?.length ?? 0) : 0));
  const dismiss = usePermissionStore((s) => s.dismiss);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const resolve = async (optionId?: string, cancelled = false) => {
    if (!head || busy) return;
    setBusy(true);
    const id = head.requestId;
    try {
      // Dismiss only after the host accepted the decision — dismissing first
      // made a failed IPC silently drop the request with no way to retry.
      await piResolvePermission(id, { optionId, cancelled });
      dismiss(id, head.sessionId);
    } catch (e) {
      console.error("resolve permission failed", e);
    } finally {
      setBusy(false);
    }
  };

  // Escape cancels only while focus is inside the card (the modal focuses its
  // cancel button). A window-wide listener used to deny the request whenever
  // the user pressed Esc to close a slash/mention menu or the find bar.
  useEffect(() => {
    if (!head) return;
    if (variant === "modal") cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy || event.defaultPrevented) return;
      if (!cardRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      void resolve(undefined, true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [head?.requestId, busy, variant]);

  if (!head) return null;

  const detail = head.message?.trim();
  // Only command-shaped prompts get a risk badge — running the shell-risk
  // regex over arbitrary prose (file paths, MCP descriptions) would produce
  // nonsense "高危" labels.
  const risk = detail && isCommandRequest(head.toolKind, head.title)
    ? checkCommandRisk(detail)
    : null;
  const riskText = risk ? riskLabel(risk.level) : "";
  const titleId = `permission-dialog-title-${head.requestId}`;
  const allow = head.options.find((o) => o.kind === "allow");
  const allowAlways = head.options.find((o) => o.kind === "allow_always");
  const deny = head.options.find((o) => o.kind === "deny");

  // One title, the exact thing being approved, three choices — the shape
  // Claude Code / Claude.ai use. The old card stacked an eyebrow, a pending
  // pill, tool + mode chips, a generic paragraph and a redundant 取消 next to
  // 拒绝 around a single command line. Esc still cancels.
  const card = (
    <div
      ref={cardRef}
      className="request-modal request-modal--permission"
      role="dialog"
      aria-modal={variant === "modal" ? "true" : undefined}
      aria-labelledby={titleId}
      data-testid="permission-card"
      data-variant={variant}
    >
      <div className="request-modal__head">
        <h2 id={titleId} className="request-modal__title">
          {head.title || permissionToolLabel(head.toolKind) || "允许 Agent 执行操作？"}
        </h2>
        {riskText && (
          <span
            className={`request-modal__risk request-modal__risk--${risk?.level}`}
            data-testid="permission-risk-label"
            title={risk?.reasons.join("；") || undefined}
          >
            {riskText}
          </span>
        )}
      </div>
      {(detail || head.rawInput != null) && (
        <div className="request-modal__body">
          {detail && (
            <pre className="request-modal__command" data-testid="permission-message">{detail}</pre>
          )}
          {head.rawInput != null && (
            <details className="request-modal__raw-details">
              <summary>查看原始参数</summary>
              <pre className="request-modal__raw">{JSON.stringify(head.rawInput, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
      <div className="request-modal__footer">
        {queueLength > 1 && <span className="request-modal__hint">{`还有 ${queueLength - 1} 项待确认`}</span>}
        <div className="request-modal__actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn--ghost request-modal__deny"
            onClick={() => void resolve(deny?.optionId, !deny)}
            disabled={busy}
            title="Esc"
          >
            拒绝
          </button>
          {allowAlways && (
            <button
              type="button"
              className="btn btn--always"
              onClick={() => void resolve(allowAlways.optionId)}
              disabled={busy}
              title={allowAlways.title}
              data-testid="permission-allow-always"
            >
              {allowAlways.title || "本会话始终允许"}
            </button>
          )}
          {allow && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void resolve(allow.optionId)}
              disabled={busy}
              title={allow.title}
              data-testid="permission-allow"
            >
              允许
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (variant === "inline") {
    return <div className="request-modal-inline" data-testid="permission-inline-host">{card}</div>;
  }
  return (
    // 遮罩点击关闭只是鼠标便利路径:面板内有「拒绝」按钮,窗口级监听也接了
    // Esc,所以遮罩本身不是控件,声明 presentation 让 AT 跳过它。
    <div className="request-modal-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) void resolve(undefined, true);
    }} data-testid="permission-overlay">
      {card}
    </div>
  );
}

/** Human-readable tool labels; unknown ids fall back to the raw id. */
const TOOL_LABELS: Record<string, string> = {
  apply_command: "执行命令",
  bash: "执行命令",
  shell: "执行命令",
  command: "执行命令",
  write: "写入文件",
  edit: "修改文件",
  apply_patch: "修改文件",
  read: "读取文件",
  glob: "查找文件",
  grep: "搜索内容",
  web_search: "联网搜索",
  fetch: "获取网页",
  mcp: "MCP 工具",
  confirm: "工具确认",
  memory_save: "保存记忆",
};

export function permissionToolLabel(toolKind: string | undefined): string {
  if (!toolKind) return "工具";
  return TOOL_LABELS[toolKind] ?? toolKind;
}

function isCommandRequest(toolKind: string | undefined, title: string | undefined): boolean {
  return /command|bash|shell|exec/i.test(toolKind ?? "") || title?.includes("执行命令") === true;
}

