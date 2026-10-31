import { useEffect, useRef, useState } from "react";
import { usePermissionStore, selectPermissionForSession } from "@/stores/permission-store";
import { permissionModeGet, piResolvePermission, type PermissionMode } from "@/lib/agent/pi-client";
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
  const [mode, setMode] = useState<PermissionMode | null>(null);
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

  // Current permission mode is advisory context ("which policy is asking?").
  // A failure to read it must never block the decision itself.
  useEffect(() => {
    if (!head) return;
    let alive = true;
    permissionModeGet()
      .then((next) => { if (alive) setMode(next); })
      .catch(() => { /* keep the chip hidden */ });
    return () => { alive = false; };
  }, [head?.requestId]);

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

  const toolLabel = permissionToolLabel(head.toolKind);
  const detail = head.message?.trim();
  // Only command-shaped prompts get a risk badge — running the shell-risk
  // regex over arbitrary prose (file paths, MCP descriptions) would produce
  // nonsense "高危" labels.
  const risk = detail && isCommandRequest(head.toolKind, head.title)
    ? checkCommandRisk(detail)
    : null;
  const riskText = risk ? riskLabel(risk.level) : "";
  const titleId = `permission-dialog-title-${head.requestId}`;
  const description = detail
    ? "Agent 请求执行以下操作。请确认命令、工作目录与参数后选择允许或拒绝。"
    : "pi agent 请求执行以下操作。请确认内容后选择允许或拒绝。";

  const card = (
    <div
      ref={cardRef}
      className="request-modal request-modal--permission"
      role="dialog"
      aria-modal={variant === "modal" ? "true" : undefined}
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-desc`}
      data-testid="permission-card"
      data-variant={variant}
    >
      <div className="request-modal__head">
        <div className="request-modal__identity">
          <span className="request-modal__icon request-modal__icon--permission" aria-hidden="true">!</span>
          <div>
            <span className="request-modal__eyebrow">
              需要你的确认
              <span className="request-modal__pending" aria-hidden="true">
                <span className="request-modal__pending-dot" />
                等待确认
              </span>
            </span>
            <h2 id={titleId} className="request-modal__title">{head.title || "允许 Agent 执行操作？"}</h2>
          </div>
        </div>
        <div className="request-modal__chips">
          <span className="request-modal__kind" data-testid="permission-tool-label">{toolLabel}</span>
          {riskText && (
            <span
              className={`request-modal__risk request-modal__risk--${risk?.level}`}
              data-testid="permission-risk-label"
              title={risk?.reasons.join("；") || undefined}
            >
              {riskText}
            </span>
          )}
          {mode && <span className="request-modal__mode" data-testid="permission-mode-label">{permissionModeLabel(mode)}</span>}
        </div>
      </div>
      <div className="request-modal__body">
        <p id={`${titleId}-desc`} className="request-modal__description">{description}</p>
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
      <div className="request-modal__footer">
        <span className="request-modal__hint">
          {queueLength > 1 ? `第 1 / ${queueLength} 项待处理 · ` : ""}
          {variant === "modal" ? "按 Esc 取消" : "Esc 可取消"}
        </span>
        {/* cc-haha 对齐 — 主操作是「允许」,「拒绝」退为低对比度 ghost;
            此前红色实心「拒绝」在视觉上压过允许,误点风险高。 */}
        <div className="request-modal__actions">
          <button ref={cancelRef} type="button" className="btn btn--ghost" onClick={() => void resolve(undefined, true)} disabled={busy}>取消</button>
          {head.options
            .filter((o) => o.kind === "allow")
            .map((o) => (
              <button
                key={o.optionId}
                type="button"
                className="btn btn--primary"
                onClick={() => void resolve(o.optionId)}
                disabled={busy}
                title={o.title}
                data-testid="permission-allow"
              >
                允许
              </button>
            ))}
          {head.options
            .filter((o) => o.kind === "allow_always")
            .map((o) => (
              <button
                key={o.optionId}
                type="button"
                className="btn btn--always"
                onClick={() => void resolve(o.optionId)}
                disabled={busy}
                title={o.title}
                data-testid="permission-allow-always"
              >
                本会话始终允许
              </button>
            ))}
          <span className="request-modal__actions-spacer" />
          <button type="button" className="btn btn--ghost request-modal__deny" onClick={() => {
            const deny = head.options.find((o) => o.kind === "deny");
            void resolve(deny?.optionId);
          }} disabled={busy}>拒绝</button>
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
};

export function permissionToolLabel(toolKind: string | undefined): string {
  if (!toolKind) return "工具";
  return TOOL_LABELS[toolKind] ?? toolKind;
}

function isCommandRequest(toolKind: string | undefined, title: string | undefined): boolean {
  return /command|bash|shell|exec/i.test(toolKind ?? "") || title?.includes("执行命令") === true;
}

const MODE_LABELS: Record<PermissionMode, string> = {
  default: "默认 · 每次询问",
  acceptEdits: "接受编辑",
  dontAsk: "不再询问",
  plan: "计划模式",
  bypassPermissions: "完全访问",
};

function permissionModeLabel(mode: PermissionMode): string {
  return MODE_LABELS[mode] ?? mode;
}
