/**
 * SubagentIndicator — MVP-3 sidebar subagent tree UI.
 *
 * Renders the live subagent list under a parent session row in the sidebar.
 * Consumes `useSubagentStore` (already fed by main-side `pi://subagent`
 * events emitted from `electron/main/agent/host-modules/team-runner.ts`
 * via `appendCustomEntry("openbuddy/subagent", ...)` +
 * `emitPluginEvent("subagent/start|end|settled", ...)`).
 *
 * Pure UI / store consumer — no business logic, no IPC. Pure helpers
 * (`subagentStatusGlyph`, `formatSubagentDuration`, `shortSubagentId`)
 * live in `src/lib/agent/subagents.ts` so this file stays declarative.
 *
 * Visual:
 *   - Hidden when no subagents exist for the session.
 *   - Compact badge (▶N running) on the parent row when collapsed.
 *   - Click the chevron / badge to expand into an inline list.
 *   - Each child row is clickable and navigates to `childSessionId`
 *     using the same `onSelect` callback the parent row uses.
 */
import { memo, useState, useCallback } from "react";
import type { SessionSummary } from "@openbuddy/shared-types";
import { useSubagentStore, type SubagentRuntime } from "@/stores/subagent-store";
import {
  subagentStatusGlyph,
  subagentStatusClass,
  formatSubagentDuration,
  shortSubagentId,
} from "@/lib/agent/subagents";

export interface SubagentIndicatorProps {
  parentSessionId: string;
  /** Same `onSelect` the parent SessionRow uses; we forward it to child rows. */
  onSelect?: (sessionId: string, cwd?: string) => void;
  /** Optional cwd forwarded when navigating to child session. */
  parentCwd?: string;
}

function SubagentIndicatorInner({
  parentSessionId,
  onSelect,
  parentCwd,
}: SubagentIndicatorProps) {
  const subagents = useSubagentStore((s) => s.bySession[parentSessionId] ?? {});
  const ids = Object.keys(subagents);
  const [expanded, setExpanded] = useState(false);

  const running = ids.filter((id) => subagents[id]?.status === "running").length;
  const completed = ids.filter(
    (id) => subagents[id]?.status === "completed",
  ).length;
  const failed = ids.filter((id) => subagents[id]?.status === "failed").length;

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      // Stop propagation so clicking the chevron doesn't open the parent row.
      e.preventDefault();
      e.stopPropagation();
      setExpanded((v) => !v);
    },
    [],
  );

  const handleChildClick = useCallback(
    (child: SubagentRuntime) => (e: React.MouseEvent) => {
      // Only navigate when the child has a real session id. Children spawned
      // before their sessionManager finalize may not have one yet.
      if (!child.childSessionId || !onSelect) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect(child.childSessionId, parentCwd ?? "");
    },
    [onSelect, parentCwd],
  );

  if (ids.length === 0) return null;

  return (
    <div
      className={
        "sidebar__subagent" +
        (expanded ? " sidebar__subagent--expanded" : "")
      }
      aria-label={`子代理 ${ids.length} 个`}
    >
      <button
        type="button"
        className="sidebar__subagent-toggle"
        onClick={handleToggle}
        aria-expanded={expanded}
        aria-controls={`subagent-list-${parentSessionId}`}
        title={expanded ? "折叠子代理列表" : `展开 ${ids.length} 个子代理`}
      >
        <span className="sidebar__subagent-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        <span className="sidebar__subagent-summary">
          {running > 0 && (
            <span className="sidebar__subagent-stat sidebar__subagent-stat--running">
              ▶ {running}
            </span>
          )}
          {completed > 0 && (
            <span className="sidebar__subagent-stat sidebar__subagent-stat--completed">
              ✓ {completed}
            </span>
          )}
          {failed > 0 && (
            <span className="sidebar__subagent-stat sidebar__subagent-stat--failed">
              ✗ {failed}
            </span>
          )}
          {running === 0 && completed === 0 && failed === 0 && (
            <span className="sidebar__subagent-stat">{ids.length}</span>
          )}
          <span className="sidebar__subagent-label">子代理</span>
        </span>
      </button>
      {expanded && (
        <ul
          className="sidebar__subagent-list"
          id={`subagent-list-${parentSessionId}`}
        >
          {ids.map((id) => {
            const sa = subagents[id];
            if (!sa) return null;
            const cls = subagentStatusClass(sa.status);
            return (
              <li
                key={id}
                className={`sidebar__subagent-row sidebar__subagent-row--${cls}`}
              >
                <button
                  type="button"
                  className="sidebar__subagent-row-btn"
                  onClick={handleChildClick(sa)}
                  disabled={!sa.childSessionId}
                  title={
                    sa.childSessionId
                      ? `打开子代理 ${sa.description}`
                      : `子代理 ${sa.description} 还未生成会话`
                  }
                >
                  <span className="sidebar__subagent-glyph" aria-hidden="true">
                    {subagentStatusGlyph(sa.status)}
                  </span>
                  <span className="sidebar__subagent-name">
                    {sa.description || sa.subagentType || "子代理"}
                  </span>
                  {sa.subagentType && sa.description !== sa.subagentType && (
                    <span className="sidebar__subagent-type">
                      {sa.subagentType}
                    </span>
                  )}
                  <span className="sidebar__subagent-meta">
                    <span className="sidebar__subagent-duration">
                      {formatSubagentDuration(sa.durationMs)}
                    </span>
                    <span className="sidebar__subagent-id">
                      #{shortSubagentId(id)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const SubagentIndicator = memo(SubagentIndicatorInner);

/**
 * SessionRowWithSubagents — thin wrapper that stacks the parent SessionRow
 * with the live subagent indicator. Drop-in replacement for the inline
 * `<SessionRow ...>` previously emitted by Sidebar.renderConv().
 *
 * High-cohesion / low-coupling: forwards every SessionRow prop verbatim,
 * adds the indicator block as a sibling without touching SessionRow.
 */
export interface SessionRowWithSubagentsProps {
  session: SessionSummary;
  isCurrent: boolean;
  onSelect: (sessionId: string, cwd?: string) => void;
  onMenuFromButton: (
    e: React.MouseEvent,
    sessionId: string,
    sessionTitle: string,
    isPinned: boolean,
  ) => void;
  onArchive: (sessionId: string) => void;
  onPin: (sessionId: string, pinned: boolean) => void;
  onUnarchive?: (sessionId: string) => void;
  isSelected?: boolean;
  onToggleSelected?: (sessionId: string, multi: boolean) => void;
}

import { SessionRow } from "./Sidebar";

function SessionRowWithSubagentsInner(props: SessionRowWithSubagentsProps) {
  return (
    <div className="sidebar__conv-wrap">
      <SessionRow {...props} />
      <SubagentIndicator
        parentSessionId={props.session.sessionId}
        parentCwd={props.session.cwd}
        onSelect={props.onSelect}
      />
    </div>
  );
}

export const SessionRowWithSubagents = memo(SessionRowWithSubagentsInner);
