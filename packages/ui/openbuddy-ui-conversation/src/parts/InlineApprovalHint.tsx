/**
 * InlineApprovalHint — Plan5 B.4 partial.
 *
 * Rendered at the end of the trailing assistant message when there are
 * pending permission/question requests. Without this hint, the only
 * indication is a count badge in the footer — easy to miss when the
 * user is reading mid-conversation. Surfaces the count inline at the
 * point of attention; click expands the existing
 * PermissionInlineCard / QuestionInlineCard inline so the user can
 * answer without scrolling to the bottom.
 *
 * Reuses the same stores (`useQuestionStore` / `usePermissionStore`)
 * the existing cards read; no schema or IPC changes needed.
 */
import { memo, useState } from "react";
import { ChevronDown, ShieldAlert, HelpCircle } from "lucide-react";
import { useQuestionStore } from "@openbuddy/ui-state/question-store";
import { usePermissionStore } from "@openbuddy/ui-state/permission-store";
import { PermissionInlineCard } from "@openbuddy/ui-dialogs";
import { QuestionInlineCard } from "../QuestionInlineCard";

export type InlineApprovalHintProps = {
  sessionId: string | null;
};

function InlineApprovalHintInner({ sessionId }: InlineApprovalHintProps) {
  // Read both queues — only count items for this session.
  const permissionCount = usePermissionStore((s) => {
    if (!sessionId) return 0;
    return s.queues[sessionId]?.length ?? 0;
  });
  const questionCount = useQuestionStore((s) => {
    if (!sessionId) return 0;
    return s.queues[sessionId]?.length ?? 0;
  });
  const total = permissionCount + questionCount;
  const [expanded, setExpanded] = useState(false);

  if (!sessionId || total === 0) return null;

  const labelParts: string[] = [];
  if (permissionCount > 0) labelParts.push(`${permissionCount} 项权限待批准`);
  if (questionCount > 0) labelParts.push(`${questionCount} 个提问`);
  const summary = labelParts.join(" · ");

  return (
    <div
      className={"msg__approval-hint" + (expanded ? " msg__approval-hint--expanded" : "")}
      data-testid="msg-approval-hint"
      data-permission-count={permissionCount}
      data-question-count={questionCount}
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
