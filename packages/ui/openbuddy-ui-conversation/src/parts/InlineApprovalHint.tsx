/**
 * InlineApprovalHint — Plan5 B.4 + P0-AI-Chat-Audit 升级。
 *
 * 原始版(B.4):只在末尾助理消息底部贴一个「X 项权限待批准 · Y 个提问」折叠 chip,
 * 用户要决策就展开看完整 PermissionInlineCard / QuestionInlineCard,展开后才看到
 * 真正的批准/拒绝按钮。
 *
 * Codex 范式升级(P1-2):在折叠态直接给三个快操作:
 *   - 「允许」:对队首 permission 调 piResolvePermission(optionId='allow once') + 本地 dismiss
 *   - 「拒绝」:对队首 permission 调 piResolvePermission(optionId='deny') + 本地 dismiss
 *   - 「稍后」:仅视觉上折叠 chip(展开态收起),队列内容不动
 *
 * 只在有 pending permission 时才显示「允许/拒绝」;纯提问队列只显示「稍后」
 * (提问必须用户输入答案,不能批量处理)。
 *
 * 视觉强化(P3-7 顺带):左侧加品牌色/警告色 3px 条带(对齐 Reasoning 卡),
 * 折叠/展开都用 motion token 过渡。
 */
import { memo, useState } from "react";
import { ChevronDown, ShieldAlert, HelpCircle, Check, X, Clock3 } from "lucide-react";
import { useQuestionStore } from "@openbuddy/ui-state/question-store";
import {
  usePermissionStore,
  selectPermissionForSession,
} from "@openbuddy/ui-state/permission-store";
import { piResolvePermission } from "@/lib/agent/pi-client";
import { PermissionInlineCard } from "@openbuddy/ui-dialogs";
import { QuestionInlineCard } from "../QuestionInlineCard";

export type InlineApprovalHintProps = {
  sessionId: string | null;
  onToast?: (msg: string) => void;
};

function InlineApprovalHintInner({ sessionId, onToast }: InlineApprovalHintProps) {
  // Read both queues — only count items for this session.
  const permissionCount = usePermissionStore((s) => {
    if (!sessionId) return 0;
    return s.queues[sessionId]?.length ?? 0;
  });
  const questionCount = useQuestionStore((s) => {
    if (!sessionId) return 0;
    return s.queues[sessionId]?.length ?? 0;
  });
  // 队首 permission 项 — 用于快操作「允许/拒绝」。只有 selectPermissionForSession
  // 返回 non-null 时才能批准/拒绝(否则按钮 disabled)。
  const headPermission = usePermissionStore(selectPermissionForSession(sessionId));
  const dismissPermission = usePermissionStore((s) => s.dismiss);
  const total = permissionCount + questionCount;
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!sessionId || total === 0) return null;

  const labelParts: string[] = [];
  if (permissionCount > 0) labelParts.push(`${permissionCount} 项权限待批准`);
  if (questionCount > 0) labelParts.push(`${questionCount} 个提问`);
  const summary = labelParts.join(" · ");

  // 快操作:对队首 permission 调 IPC + 本地 dismiss。失败时不阻塞 UI,
  // 只 toast 一下 — 让用户依然可以从展开态走完整流程。
  async function resolveHead(cancelled: boolean, optionKind: "allow" | "deny") {
    if (!headPermission || busy) return;
    setBusy(true);
    const { requestId, sessionId: reqSid, options: perms } = headPermission;
    dismissPermission(requestId, reqSid);
    try {
      const opt = perms.find((o) => o.kind === (cancelled ? optionKind === "deny" ? "deny" : optionKind : optionKind));
      const optionId = opt?.optionId ?? (optionKind === "deny" ? perms.find((o) => o.kind === "deny")?.optionId : perms.find((o) => o.kind === "allow")?.optionId);
      await piResolvePermission(requestId, { optionId, cancelled });
      onToast?.(cancelled ? "已拒绝" : "已允许");
    } catch (err) {
      console.error("inline approval quick action failed", err);
      onToast?.("操作失败,请打开完整审批卡");
    } finally {
      setBusy(false);
    }
  }

  const hasPermissions = permissionCount > 0 && !!headPermission;
  const severity = permissionCount > 0 ? "permission" : "question";

  return (
    <div
      className={
        "msg__approval-hint" +
        (expanded ? " msg__approval-hint--expanded" : "") +
        " msg__approval-hint--" +
        severity
      }
      data-testid="msg-approval-hint"
      data-permission-count={permissionCount}
      data-question-count={questionCount}
      data-severity={severity}
    >
      <button
        type="button"
        className="msg__approval-hint-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`展开待审批(共 ${total} 项)`}
      >
        {permissionCount > 0 ? (
          <ShieldAlert size={12} strokeWidth={2} className="msg__approval-hint-icon" />
        ) : (
          <HelpCircle size={12} strokeWidth={2} className="msg__approval-hint-icon" />
        )}
        <span className="msg__approval-hint-summary">{summary}</span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={"msg__approval-hint-chevron" + (expanded ? " msg__approval-hint-chevron--open" : "")}
        />
      </button>
      {/* P1-2 — Codex 风格快操作行:允许 / 拒绝 / 稍后。
       *   - 允许/拒绝:只在有 permission 时显示并可点;纯提问队列禁用,
       *     因为提问必须输入答案,不能批量处理。
       *   - 稍后:永远可点,仅收起展开 UI,事项保留在 store 里等用户回头。
       * 视觉上用紧凑小按钮(26×26 icon-only + 4px 字距),与
       * .msg__action-btn 同尺寸,符合消息操作行一致性。 */}
      <div className="msg__approval-hint-actions" data-testid="msg-approval-hint-actions">
        <button
          type="button"
          className="msg__approval-hint-action msg__approval-hint-action--allow"
          onClick={(e) => {
            e.stopPropagation();
            void resolveHead(false, "allow");
          }}
          disabled={!hasPermissions || busy}
          title={hasPermissions ? "允许该项权限" : "当前队列无权限请求"}
          aria-label="允许"
          data-testid="msg-approval-hint-allow"
        >
          <Check size={12} strokeWidth={2.25} />
          <span>允许</span>
        </button>
        <button
          type="button"
          className="msg__approval-hint-action msg__approval-hint-action--deny"
          onClick={(e) => {
            e.stopPropagation();
            void resolveHead(true, "deny");
          }}
          disabled={!hasPermissions || busy}
          title={hasPermissions ? "拒绝该项权限" : "当前队列无权限请求"}
          aria-label="拒绝"
          data-testid="msg-approval-hint-deny"
        >
          <X size={12} strokeWidth={2.25} />
          <span>拒绝</span>
        </button>
        <button
          type="button"
          className="msg__approval-hint-action msg__approval-hint-action--defer"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(false);
          }}
          title="收起,稍后再处理"
          aria-label="稍后"
          data-testid="msg-approval-hint-defer"
        >
          <Clock3 size={12} strokeWidth={2} />
          <span>稍后</span>
        </button>
      </div>
      {expanded && (
        <div className="msg__approval-hint-body">
          <PermissionInlineCard sessionId={sessionId} />
          <QuestionInlineCard sessionId={sessionId} />
        </div>
      )}
    </div>
  );
}

export const InlineApprovalHint = memo(InlineApprovalHintInner);
