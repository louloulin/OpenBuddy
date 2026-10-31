/**
 * ProcessSummary — 完成后的「过程折叠行」(对齐 WorkBuddy「已完成 Xs ›」)。
 *
 * 回合结束后,思考与工具调用收进一行可展开的摘要,最终回答直接露出;
 * 流式过程中不折叠(由 MessagePartRegistry 决定何时使用本组件)。
 * 子节点始终挂在 DOM 里(<details> 原生折叠),展开不需要重新渲染。
 */
import type { ReactNode } from "react";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { formatDurationMs } from "@/lib/ui/duration";

export function ProcessSummary({
  durationMs,
  stepCount,
  children,
}: {
  durationMs?: number | null;
  stepCount: number;
  children: ReactNode;
}) {
  const label =
    typeof durationMs === "number" && durationMs >= 1000
      ? `已完成 · 用时 ${formatDurationMs(durationMs)}`
      : `已完成 · ${stepCount} 个步骤`;
  return (
    <details className="msg__process" data-testid="message-process">
      <summary className="msg__process-summary">
        <span>{label}</span>
        <ChevronRight className="msg__process-chevron" size={14} strokeWidth={1.75} aria-hidden="true" />
      </summary>
      <div className="msg__process-body">{children}</div>
    </details>
  );
}
