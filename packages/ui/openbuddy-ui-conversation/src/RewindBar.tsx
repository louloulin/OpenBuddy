/**
 * 回溯/分叉工具栏 — 显示在 ChatView 底部（composer 正上方）。
 *
 * 两个能力：
 *  - Rewind（回溯）：调 `x.ai/rewind/{points,execute}`，回到指定 prompt 索引。
 *    支持 mode: conversation（仅回退对话）/ files（仅文件）/ all（全量，含对话+文件+记忆）。
 *  - Fork（分叉）：调 `x.ai/session/fork`，复制会话到新 id 探索不同方向。
 *
 * 增强点（对齐 WorkBuddy）：
 *  - 时间线视图：每个回溯点显示时间、prompt 预览、assistant 回复预览、工具调用徽章。
 *  - 文件/记忆变更徽章：标记哪些步骤产生了文件改动或记忆写入。
 *  - 三种模式按钮：仅对话 / 仅文件 / 全量。
 */
import { useEffect, useId, useRef, useState } from "react";
import {
  rewindExecute,
  rewindPoints,
  sessionFork,
} from "@/lib/agent/pi-client";
import type { RewindPoint } from "@openbuddy/shared-types";
import {
  ClockIcon,
  ChevronDownIcon,
  GitBranchIcon,
} from "@openbuddy/ui-primitives/icons";
import { confirm } from "@/lib/platform/electron-api";

/** Rewind mode options matching pi's x.ai/rewind/execute mode param.
 *  NOTE: pi's RewindMode enum only has All/ConversationOnly/FilesOnly —
 *  there is no "memory"-only mode (all already includes memory). Don't add
 *  "memory" here or pi's serde will reject it at runtime. */
type RewindMode = "conversation" | "files" | "all";

const MODE_LABELS: Record<RewindMode, string> = {
  conversation: "仅对话",
  files: "仅文件",
  all: "全量",
};

const MODE_TITLES: Record<RewindMode, string> = {
  conversation: "回退对话历史，不影响文件",
  files: "回退文件改动，不影响对话",
  all: "回退所有（对话 + 文件 + 记忆）",
};

interface RewindBarProps {
  sessionId: string;
  cwd?: string;
  onForked?: (newSessionId: string) => void;
  onRewound?: () => void;
  onToast?: (msg: string) => void;
}

export function RewindBar({
  sessionId,
  cwd,
  onForked,
  onRewound,
  onToast,
}: RewindBarProps) {
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState<RewindPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Currently selected mode for the next rewind action. */
  const [selectedMode, setSelectedMode] = useState<RewindMode>("all");
  /** R4.1 — focused timeline item (keyboard nav via ↑↓). */
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const dropdownId = useId();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const loadPoints = async () => {
    setLoading(true);
    try {
      setPoints(await rewindPoints(sessionId));
    } catch {
      setPoints([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && points.length === 0) loadPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId]);

  // R4.1 — reset focused index when the timeline contents change, and
  // close the dropdown on Escape (returning focus to the trigger).
  useEffect(() => {
    if (open) setFocusedIndex(0);
  }, [open, points.length]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === "ArrowDown" && points.length > 0) {
        e.preventDefault();
        setFocusedIndex((i) => (i + 1) % points.length);
      } else if (e.key === "ArrowUp" && points.length > 0) {
        e.preventDefault();
        setFocusedIndex((i) => (i <= 0 ? points.length - 1 : i - 1));
      } else if (e.key === "Enter" && points[focusedIndex]) {
        e.preventDefault();
        void handleRewind(points[focusedIndex].promptIndex);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, points, focusedIndex]);

  const handleRewind = async (idx: number) => {
    setBusy(true);
    try {
      await rewindExecute(sessionId, idx, selectedMode, true);
      const label = MODE_LABELS[selectedMode];
      onToast?.(`已回溯（${label}）`);
      onRewound?.();
      setOpen(false);
    } catch (e) {
      onToast?.(`回溯失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  const handleFork = async () => {
    if (!confirm("分叉此会话？会复制到新会话，原会话保留。")) return;
    setBusy(true);
    try {
      const newId = await sessionFork(sessionId, cwd);
      onToast?.(`已分叉到新会话 ${newId.slice(0, 8)}`);
      // Drop the timeline dropdown — the new session is the user's fresh
      // workspace and we don't want the menu sitting on top of the empty
      // transcript / blocking the input area below.
      setOpen(false);
      onForked?.(newId);
    } catch (e) {
      onToast?.(`分叉失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rewind-bar">
      <button
        ref={triggerRef}
        className="rewind-bar__btn"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title="回溯到历史某一步"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dropdownId}
      >
        <ClockIcon size="sm" /> 回溯
        <ChevronDownIcon size="sm" />
      </button>
      <button
        className="rewind-bar__btn"
        onClick={handleFork}
        disabled={busy}
        title="分叉此会话"
      >
        <GitBranchIcon size="sm" /> 分叉
      </button>

      {open && (
        <div
          id={dropdownId}
          ref={dropdownRef}
          className="rewind-bar__dropdown rewind-bar__dropdown--timeline"
          role="dialog"
          aria-modal="false"
          aria-label="回溯时间线"
        >
          {/* Header with refresh */}
          <div className="rewind-bar__header">
            <span>回溯时间线</span>
            <button
              className="rewind-bar__refresh"
              onClick={loadPoints}
              disabled={loading}
              aria-label="刷新回溯点"
            >
              {loading ? "加载中…" : "刷新"}
            </button>
          </div>

          {/* Mode selector — radiogroup + aria-pressed per button (R4.1) */}
          <div className="rewind-bar__modes" role="radiogroup" aria-label="回溯模式">
            {(Object.keys(MODE_LABELS) as RewindMode[]).map((mode) => (
              <button
                key={mode}
                className={
                  "rewind-bar__mode-btn" +
                  (selectedMode === mode ? " rewind-bar__mode-btn--active" : "")
                }
                onClick={() => setSelectedMode(mode)}
                title={MODE_TITLES[mode]}
                role="radio"
                aria-checked={selectedMode === mode}
                aria-pressed={selectedMode === mode}
              >
                {MODE_LABELS[mode]}
              </button>
            ))}
          </div>

          {/* Timeline list */}
          {loading && <div className="rewind-bar__empty">加载中…</div>}
          {!loading && points.length === 0 && (
            <div className="rewind-bar__empty">无回溯点（会话刚创建）</div>
          )}
          <ul className="rewind-bar__timeline" role="listbox" aria-label="回溯点">
            {points.map((p, idx) => (
              <li
                key={p.promptIndex}
                className={
                  "rewind-bar__timeline-item" +
                  (idx === focusedIndex ? " rewind-bar__timeline-item--focused" : "")
                }
                role="option"
                aria-selected={idx === focusedIndex}
                onMouseEnter={() => setFocusedIndex(idx)}
              >
                {/* Timeline dot + connector line */}
                <div className="rewind-bar__timeline-rail">
                  <span className="rewind-bar__timeline-dot" />
                </div>

                {/* Content card */}
                <div className="rewind-bar__timeline-card">
                  <div className="rewind-bar__timeline-time">
                    {p.timestamp
                      ? new Date(p.timestamp).toLocaleString()
                      : `#${p.promptIndex}`}
                  </div>
                  {p.promptPreview && (
                    <div className="rewind-bar__timeline-prompt">
                      {p.promptPreview.length > 80
                        ? p.promptPreview.slice(0, 80) + "…"
                        : p.promptPreview}
                    </div>
                  )}
                  {p.messagePreview && (
                    <div className="rewind-bar__timeline-response">
                      💬{" "}
                      {p.messagePreview.length > 60
                        ? p.messagePreview.slice(0, 60) + "…"
                        : p.messagePreview}
                    </div>
                  )}

                  {/* Badges: file changes / memory changes / tool names */}
                  <div className="rewind-bar__timeline-badges">
                    {p.hasFileChanges && (
                      <span className="rewind-bar__badge rewind-bar__badge--file">
                        📄 文件
                      </span>
                    )}
                    {p.hasMemoryChanges && (
                      <span className="rewind-bar__badge rewind-bar__badge--memory">
                        🧠 记忆
                      </span>
                    )}
                    {p.toolNames && p.toolNames.length > 0 && (
                      <span className="rewind-bar__badge rewind-bar__badge--tool">
                        🔧 {p.toolNames.slice(0, 3).join(", ")}
                        {p.toolNames.length > 3 && ` +${p.toolNames.length - 3}`}
                      </span>
                    )}
                  </div>

                  {/* Rewind action button */}
                  <button
                    className="rewind-bar__timeline-action"
                    onClick={() => handleRewind(p.promptIndex)}
                    disabled={busy}
                    aria-label={`回溯到第 ${p.promptIndex + 1} 步（${MODE_LABELS[selectedMode]}）`}
                  >
                    回溯到此处（{MODE_LABELS[selectedMode]}）
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
