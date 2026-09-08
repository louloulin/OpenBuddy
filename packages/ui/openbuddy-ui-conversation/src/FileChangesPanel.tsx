/**
 * 文件变更聚合面板 —— 对标 WorkBuddy `cb-chat-ui/file-changes-panel`。
 *
 * 从会话消息的 tool_call diff 聚合出「每个文件的净变更」,展示文件类型图标、
 * 路径、增删行(+绿/-红)、编辑次数。空(无 diff)时不渲染。
 */
import { memo, useMemo } from "react";
import { aggregateFileChanges, fileIcon, changeStatus } from "@/lib/files/file-changes";
import type { ChatMessage } from "@/stores/session-store";

interface FileChangesPanelProps {
  messages: ChatMessage[];
}

/**
 * P1-04 (WU-E): memoize FileChangesPanel. Without this, the entire
 * aggregate-file-changes useMemo re-executes on every streaming delta
 * even though the diff aggregator only depends on tool_call events
 * (which are sparse compared to text deltas).
 *
 * Custom comparator: skip the messages array shallow compare if both
 * arrays have the same length and last id; tool_call additions change
 * the length, so a streaming text delta inside an existing tool_call
 * turn doesn't invalidate the memo.
 */
function fileChangesPropsAreEqual(
  prev: FileChangesPanelProps,
  next: FileChangesPanelProps,
): boolean {
  if (prev.messages === next.messages) return true;
  const a = prev.messages;
  const b = next.messages;
  if (a.length !== b.length) return false;
  if (a[a.length - 1]?.id !== b[b.length - 1]?.id) return false;
  return true;
}

const FileChangesPanelInner = function FileChangesPanel({ messages }: FileChangesPanelProps) {
  const summary = useMemo(() => aggregateFileChanges(messages), [messages]);
  if (summary.totalFiles === 0) return null;

  return (
    <div className="file-changes" role="region" aria-label="文件变更">
      <div className="file-changes__head">
        <span className="file-changes__title">文件变更</span>
        <span className="file-changes__summary">
          {summary.totalFiles} 个文件 ·{" "}
          <span className="file-changes__added">+{summary.totalAdded}</span>{" "}
          <span className="file-changes__removed">-{summary.totalRemoved}</span>
        </span>
      </div>
      <ul className="file-changes__list">
        {summary.files.map((f) => (
          <li
            key={f.path}
            className={"file-changes__row file-changes__row--" + changeStatus(f)}
            title={f.path}
          >
            <span className="file-changes__icon">{fileIcon(f.ext)}</span>
            <span className="file-changes__name">{f.name}</span>
            {f.edits > 1 && (
              <span className="file-changes__edits" title={`${f.edits} 次编辑`}>
                ×{f.edits}
              </span>
            )}
            <span className="file-changes__stats">
              <span className="file-changes__added">+{f.added}</span>
              <span className="file-changes__removed">-{f.removed}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * P1-04 (WU-E): memoized export. See `fileChangesPropsAreEqual` for
 * why the comparator inspects length + last-id instead of doing a
 * shallow equality on the full messages array.
 */
export const FileChangesPanel = memo(FileChangesPanelInner, fileChangesPropsAreEqual);
