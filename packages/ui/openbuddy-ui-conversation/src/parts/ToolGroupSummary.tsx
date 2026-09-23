/**
 * ToolGroupSummary — 并行工具组摘要(Plan5 B.9)。
 *
 * 当 `clusterToolCalls` 判定连续 tool_call 是并行调用时,渲染该摘要;
 * 单工具依旧走原本的 `ToolCallCard`。
 *
 * 视觉:
 *   - 一行 chip:"⚡ 3 个工具并行运行:ls / git status / npm test"
 *   - hover 时显示每个工具的状态 icon
 *   - 点击 → 展开/折叠,展开后逐条列出 `<ToolCallCard>`(走既有的 inline 展开
 *     路径,与 ToolCallCard 自身一致)
 *
 * 行为:
 *   - 默认 collapsed,串行工具不影响
 *   - 进入/离开用 `data-testid="tool-group-summary"` 定位
 */
import { useState, type ComponentType } from "react";
import { Zap, ChevronDown, ChevronRight } from "lucide-react";
import type { ToolCallCluster } from "@/lib/ui/timeline-utils";
import { ToolCallCard } from "../ToolCallCard";
import type { ToolCallView } from "@openbuddy/ui-state/session-store";

export type ToolGroupSummaryProps = {
  cluster: Extract<ToolCallCluster, { kind: "parallel" }>;
  /** `ToolCallCard` 的展开回调(用于 click 行为)。 */
  onOpenTool?: (tc: ToolCallView) => void;
  /** 是否默认展开(默认 false — 由用户点击展开)。 */
  defaultExpanded?: boolean;
};

function summarizeToolCall(tc: ToolCallView): string {
  return tc.title || tc.kind || tc.toolCallId.slice(0, 8);
}

export function ToolGroupSummary({
  cluster,
  onOpenTool,
  defaultExpanded = false,
}: ToolGroupSummaryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const total = cluster.toolCalls.length;
  const finished = cluster.toolCalls.filter((tc) => tc.status !== "in_progress").length;
  const allDone = finished === total;
  return (
    <div
      className={
        "tool-group-summary" +
        (allDone ? " tool-group-summary--done" : " tool-group-summary--running")
      }
      data-testid="tool-group-summary"
      data-tool-count={total}
      data-tool-ids={cluster.toolCallIds.join(",")}
    >
      <button
        type="button"
        className="tool-group-summary__header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${total} 个工具并行${
          allDone ? "已完成" : `运行中(已完 ${finished}/${total})`
        }`}
      >
        <span className="tool-group-summary__icon" aria-hidden="true">
          {allDone ? <Zap size={12} strokeWidth={1.75} /> : <Zap size={12} strokeWidth={1.75} className="tool-group-summary__icon--active" />}
        </span>
        <span className="tool-group-summary__caret" aria-hidden="true">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span className="tool-group-summary__label">
          {total} 个工具并行
        </span>
        {!expanded && (
          <span className="tool-group-summary__tools" title={cluster.toolCalls.map(summarizeToolCall).join(" · ")}>
            {cluster.toolCalls.slice(0, 3).map(summarizeToolCall).join(" · ")}
            {total > 3 && ` · +${total - 3}`}
          </span>
        )}
        <span className="tool-group-summary__progress">
          {finished}/{total}
        </span>
      </button>
      {expanded && (
        <ul className="tool-group-summary__list" role="list">
          {cluster.toolCalls.map((tc) => (
            <li key={tc.toolCallId} className="tool-group-summary__item">
              <ToolCallCard
                tc={tc}
                expandMode="compact"
                onOpen={onOpenTool ? () => onOpenTool(tc) : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
