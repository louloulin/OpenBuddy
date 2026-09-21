/**
 * AiInboxShell — Email + AI 闭环新 UX 的统一根组件。
 *
 * 设计目标:3 段式(Today / Later / Done)、AI 默认可见、闭环回执。
 * 此组件是 EmailPanel 的"瘦壳化"替代品 — 把 50+ useState 收敛到两个 hook
 * (useAiInbox + useAiLoop),UI 拆分成下面几个组件,每个职责单一:
 *
 *   ┌─ MailRail                (侧栏:Today/Later/Done + 折叠 Folders)
 *   ├─ List 段                  (列表 + AI 标签 + 一键清空)
 *   ├─ Detail 段
 *   │    ├─ AiSummaryCard       (线程摘要)
 *   │    ├─ AiActionPlanStrip   (顶部 AI 行动条)
 *   │    ├─ 原始消息             (保留)
 *   │    └─ AiReplySuggester    (3 选 1 回复建议)
 *   └─ AiCommandBar            (Cmd+K 自然语言)
 *
 * 闭环不变量:
 *   - 任何 mutation (archive/label/snooze/mark-read/reply/task) 都经由
 *     `useAiLoop` 的 acceptPlan,UI 不会出现"看不见的执行"。
 *   - 摘要/回复建议是 read-only — 即使 AI 失败,也不会让邮件状态错乱。
 *   - 命令面板的提交直接走到 aiInbox.routePrompt -> aiLoop.propose -> UI。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AiAction,
  AiActionReceipt,
  AiReplySuggestion,
  AiThreadSummary,
  AsyncPhase,
} from "../types";
import { phaseIdle } from "../types";
import { useAiInbox, type AiInboxRuntime, type AiTriageHint } from "../hooks/useAiInbox";
import { useAiLoop } from "../hooks/useAiLoop";
import { AiSummaryCard, type AiSummaryAction } from "./AiSummaryCard";
import { AiReplySuggester } from "./AiReplySuggester";
import { AiActionPlanStrip } from "./AiActionPlanStrip";
import { AiCommandBar } from "./AiCommandBar";
import { AiMessageList } from "./AiMessageList";
import { MailStatusBar } from "./MailStatusBar";
import { ReceiptToast } from "./ReceiptToast";
import { useAiShortcuts, type AiShortcut } from "../hooks/useAiShortcuts";
import { MailRail, type RailCounts, type RailFolder, type RailView } from "./MailRail";
import { useAiMultiSelect } from "../hooks/ai-multiselect";
import { VirtualList } from "./VirtualList";
import { recordTelemetry } from "../telemetry-store";

export interface AiInboxThread {
  id: string;
  accountId: string;
  subject: string;
  from: { name?: string; address: string };
  date: string;
  snippet?: string;
  unread: boolean;
  messageCount: number;
  labels: string[];
  /** AI 标签 — 列表行右侧的 chip。 */
  aiChips?: Array<"priority" | "reply" | "action" | "muted">;
}

export interface AiInboxAccount {
  id: string;
  address: string;
  name?: string;
  status: "connected" | "reauthorization-required" | "disconnected";
}

export interface AiInboxShellProps {
  accounts: AiInboxAccount[];
  accountId: string;
  threads: AiInboxThread[];
  /** AI 运行时(由父组件注入,生产里绑到 capability-email 的 IPC)。 */
  runtime: AiInboxRuntime;
  counts: RailCounts;
  selectedThreadId: string | null;
  /** UI 状态回调 — 父组件把这些写到 store / router,Shell 自身不持久化。 */
  onSelectAccount?: (accountId: string) => void;
  onSelectThread?: (threadId: string) => void;
  onOpenComposer?: (initial?: { subject: string; body: string; threadId: string }) => void;
  /** 当需要更复杂的 toast / snackbar 时由父组件渲染。 */
  onReceipt?: (receipts: AiActionReceipt[]) => void;
  className?: string;
}

export function AiInboxShell({
  accounts,
  accountId,
  threads,
  runtime,
  counts,
  selectedThreadId,
  onSelectAccount,
  onSelectThread,
  onOpenComposer,
  onReceipt,
  className,
}: AiInboxShellProps): JSX.Element {
  const [view, setView] = useState<RailView>("today");
  const [folder, setFolder] = useState<RailFolder>("inbox");
  const [commandOpen, setCommandOpen] = useState(false);
  const [recentPrompts, setRecentPrompts] = useState<Array<{ id: string; prompt: string; ranAt: string }>>([]);

  // Receipt toast 状态必须在 useAiLoop 之前定义 — executor 回调会引用它。
  const [toastReceipts, setToastReceipts] = useState<AiActionReceipt[] | null>(null);
  const handleReceiptWithToast = useCallback(
    (receipts: AiActionReceipt[]) => {
      onReceipt?.(receipts);
      if (receipts.length > 0) {
        setToastReceipts(receipts);
        const executed = receipts.filter((r) => r.status === "executed").length;
        const failed = receipts.length - executed;
        if (executed > 0) {
          recordTelemetry("action_executed", { count: executed }, accountId);
        }
        if (failed > 0) {
          recordTelemetry("action_failed", { count: failed }, accountId);
        }
      }
    },
    [onReceipt, accountId],
  );

  const aiInbox = useAiInbox({ runtime });

  const aiLoop = useAiLoop({
    planner: useCallback((prompt: string, threadIds: string[]) => runtime.plan(prompt, threadIds), [runtime]),
    executor: useCallback(
      async (accepted: AiAction[]): Promise<AiActionReceipt[]> => {
        const receipts = await runtime.execute(accepted);
        handleReceiptWithToast(receipts);
        return receipts;
      },
      [runtime, handleReceiptWithToast],
    ),
    undoer: useCallback((receipts: AiActionReceipt[]) => runtime.undo(receipts), [runtime]),
  });

  const filteredThreads = useMemo(() => {
    if (view === "done") return [];
    return threads;
  }, [threads, view]);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  );

  useEffect(() => {
    if (!selectedThreadId) return;
    if (!aiInbox.summaries[selectedThreadId]) {
      void aiInbox.ensureSummary(selectedThreadId).catch(() => undefined);
    }
  }, [selectedThreadId, aiInbox]);

  // 摘要 ready 时记录埋点(切换线程后命中 SWR 缓存也算)。
  useEffect(() => {
    if (!selectedThreadId) return;
    const phase = aiInbox.summaries[selectedThreadId];
    if (phase?.status === "ready") {
      recordTelemetry("ai_summary_shown", { threadId: selectedThreadId }, accountId);
    }
  }, [selectedThreadId, aiInbox.summaries, accountId]);

  // ── P2-2 启动自动 triage(列表加载 ~2s 后自动打 AI chip)─────────
  const [triageHints, setTriageHints] = useState<Record<string, AiTriageHint>>({});
  useEffect(() => {
    if (typeof runtime.triage !== "function") return;
    if (filteredThreads.length === 0) return;
    const ids = filteredThreads.map((t) => t.id);
    const timer = window.setTimeout(() => {
      void runtime.triage?.(accountId, ids)
        .then((hints) => {
          if (!Array.isArray(hints)) return;
          const next: Record<string, AiTriageHint> = {};
          for (const hint of hints) {
            if (hint && typeof hint.threadId === "string") next[hint.threadId] = hint;
          }
          setTriageHints(next);
          recordTelemetry("triage_shown", { count: hints.length, accountId }, accountId);
          recordTelemetry("triage_merged", { count: Object.keys(next).length }, accountId);
        })
        .catch(() => undefined);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [runtime, accountId, filteredThreads]);

  const handleOpenComposer = useCallback(
    (init?: { subject: string; body: string }) => {
      onOpenComposer?.({
        subject: init?.subject ?? "",
        body: init?.body ?? "",
        threadId: selectedThreadId ?? "",
      });
    },
    [onOpenComposer, selectedThreadId],
  );

  const handleSummaryAction = useCallback(
    (action: AiSummaryAction, summary: AiThreadSummary) => {
      if (!selectedThreadId) return;
      if (action === "reply") {
        void aiInbox.ensureReplies(selectedThreadId).catch(() => undefined);
      } else if (action === "calendar") {
        const meetingTitle = summary.meetingProposal?.title;
        if (meetingTitle) {
          void runtime
            .plan("加入日历: " + meetingTitle, [selectedThreadId])
            .then(() => aiLoop.propose("加入日历: " + meetingTitle, [selectedThreadId]))
            .catch(() => undefined);
        }
      } else if (action === "snooze") {
        const until = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
        aiLoop.propose("稍后再处理:" + summary.oneLiner, [selectedThreadId]);
      } else if (action === "followup") {
        aiLoop.propose(
          "把以下事项创建为任务: " + summary.actionItems.map((a) => a.content).join(" / "),
          [selectedThreadId],
        );
      }
    },
    [selectedThreadId, aiInbox, runtime, aiLoop],
  );

  const handleAdoptReply = useCallback(
    (suggestion: AiReplySuggestion) => {
      handleOpenComposer({ subject: suggestion.subject, body: suggestion.body });
    },
    [handleOpenComposer],
  );

  const handleCleanInbox = useCallback(() => {
    const targets = filteredThreads.slice(0, 25).map((t) => t.id);
    aiLoop.propose("清理噪声邮件(AI 建议)", targets);
  }, [filteredThreads, aiLoop]);

  // ── P2-3 多选(批量 plan)────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const multi = useAiMultiSelect({
    selectedIds,
    allIds: filteredThreads.map((t) => t.id),
    onChange: setSelectedIds,
  });
  /** 多选模式下,选中状态应清晰可见 — 一键清空仍可触发,只是选中行不被吞。 */
  const handleCleanInboxWithSelection = useCallback(() => {
    const ids = multi.selectedCount > 0 ? selectedIds : filteredThreads.slice(0, 25).map((t) => t.id);
    aiLoop.propose("清理噪声邮件(AI 建议)", ids);
  }, [multi.selectedCount, selectedIds, filteredThreads, aiLoop]);
  /** 批量 plan — 把当前多选当作一组待 plan 线程喂给 aiLoop。 */
  const handleBatchPlan = useCallback(() => {
    if (multi.selectedCount === 0) return;
    recordTelemetry(
      "multiselect_batch_plan",
      { count: multi.selectedCount },
      accountId,
    );
    aiLoop.propose(`批量处理 ${multi.selectedCount} 封邮件`, [...selectedIds]);
    setSelectedIds([]);
  }, [multi.selectedCount, selectedIds, aiLoop, accountId]);

  const handleCommandSubmit = useCallback(
    async (prompt: string) => {
      setCommandOpen(false);
      recordTelemetry("command_prompt", { length: prompt.length }, accountId);
      setRecentPrompts((current) => [
        { id: Date.now().toString(), prompt, ranAt: new Date().toISOString() },
        ...current,
      ].slice(0, 8));
      try {
        const threadIds = threads
          .filter((t) => (view === "today" ? t.unread : true))
          .slice(0, 25)
          .map((t) => t.id);
        const actions = await runtime.routePrompt(prompt);
        if (actions.length === 0) {
          // 若 routePrompt 走不通,直接喂给 planner。
          await aiLoop.propose(prompt, threadIds);
        } else {
          // 让 aiLoop 接管 UI 决策流程 — 重新设置计划 + decisions
          // 简化做法:直接提议(planner 由 plan 实现)
          await aiLoop.propose(prompt, threadIds);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[ai-inbox] routePrompt failed", err);
      }
    },
    [threads, view, runtime, aiLoop],
  );

  // ── 键盘快捷键派发(参考 Superhuman / Shortwave) ────────────────────────
  const handleShortcut = useCallback(
    (shortcut: AiShortcut) => {
      switch (shortcut.kind) {
        case "next": {
          const idx = filteredThreads.findIndex((t) => t.id === selectedThreadId);
          const next = filteredThreads[Math.min(idx + 1, filteredThreads.length - 1)] ?? filteredThreads[0];
          if (next) onSelectThread?.(next.id);
          break;
        }
        case "prev": {
          const idx = filteredThreads.findIndex((t) => t.id === selectedThreadId);
          const prev = filteredThreads[Math.max(idx - 1, 0)] ?? filteredThreads[0];
          if (prev) onSelectThread?.(prev.id);
          break;
        }
        case "command":
          setCommandOpen(true);
          break;
        case "clean-inbox":
          handleCleanInboxWithSelection();
          break;
        case "compose":
          handleOpenComposer({ subject: "", body: "" });
          break;
        default:
          // 其他快捷键(archive / snooze / reply / search / undo / help)由调用方或后续组件处理。
          break;
      }
    },
    [filteredThreads, selectedThreadId, onSelectThread, handleCleanInbox, handleOpenComposer],
  );
  // Esc / Cmd+A → 多选状态管理。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.key === "Escape" && selectedIds.length > 0) {
        event.preventDefault();
        setSelectedIds([]);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        if (selectedIds.length === filteredThreads.length) return;
        event.preventDefault();
        multi.handleSelectAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds.length, filteredThreads.length, multi]);

  useAiShortcuts({ enabled: true, onShortcut: handleShortcut });

  // 当 undoEntry 过期时,自动 dismiss toast。
  useEffect(() => {
    if (!aiLoop.undoEntry) return;
    if (toastReceipts === null) return;
  }, [aiLoop.undoEntry, toastReceipts]);

  // status bar dynamic values
  const aiStatus = aiLoop.planning.status === "loading"
    ? "AI 正在规划…"
    : aiLoop.accepting
    ? "正在执行…"
    : aiLoop.undoEntry
    ? "已执行 · 可撤销"
    : selectedThread && aiInbox.summaries[selectedThread.id]?.status === "ready"
    ? "AI 摘要已生成"
    : "AI 待命";

  return (
    <main className={`ai-inbox-shell ${className ?? ""}`.trim()} data-view={view} data-folder={folder}>
      <MailRail
        accounts={accounts}
        accountId={accountId}
        view={view}
        folder={folder}
        counts={counts}
        onAccountChange={(next) => onSelectAccount?.(next)}
        onViewChange={setView}
        onFolderChange={setFolder}
      />

      <section className="ai-inbox-shell__list" aria-label="邮件列表">
        <header className="ai-inbox-shell__list-head">
          <div>
            <h2>{RAIL_TITLE[view]}</h2>
            <small>{filteredThreads.length} 封邮件</small>
          </div>
          <div className="ai-inbox-shell__list-actions">
            <button type="button" onClick={handleCleanInboxWithSelection} className="ai-inbox-shell__btn-secondary">
              🧹 一键清空噪声
            </button>
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="ai-inbox-shell__btn-secondary"
              title="Cmd+K"
            >
              ✨ AI 命令
            </button>
            <button type="button" className="ai-inbox-shell__btn-primary" onClick={() => handleOpenComposer()}>
              📨 新建
            </button>
          </div>
        </header>
        {multi.selectedCount > 0 ? (
          <div className="ai-inbox-shell__batch-bar" role="toolbar" aria-label="批量操作">
            <span className="ai-inbox-shell__batch-count">已选 {multi.selectedCount} 封</span>
            <button type="button" onClick={handleBatchPlan} className="ai-inbox-shell__btn-secondary" data-testid="batch-plan">
              📋 批量 plan
            </button>
            <button type="button" onClick={handleCleanInboxWithSelection} className="ai-inbox-shell__btn-secondary">
              🧹 一键清空
            </button>
            <button type="button" onClick={multi.handleSelectAll} className="ai-inbox-shell__btn-secondary">
              全选
            </button>
            <button type="button" onClick={multi.handleClearSelection} className="ai-inbox-shell__btn-secondary" data-testid="batch-clear">
              清空
            </button>
          </div>
        ) : null}
        {filteredThreads.length === 0 ? (
          <ul className="ai-inbox-shell__rows" role="listbox" aria-multiselectable="true" aria-label="邮件列表(可多选)">
            <li className="ai-inbox-shell__empty">
              {view === "done" ? "今日还没有已完成项 — 完成一些邮件后会显示在这里。" : "没有匹配的邮件。"}
            </li>
          </ul>
        ) : (
          <VirtualList
            className="ai-inbox-shell__rows"
            items={filteredThreads}
            itemHeight={72}
            overscan={6}
            ariaLabel="邮件列表(可多选)"
            keyOf={(thread) => thread.id}
            renderItem={(thread, _index, style) => {
              const isSelected = multi.isSelected(thread.id);
              const triage = triageHints[thread.id];
              const effectiveChips = triage
                ? Array.from(new Set([...(thread.aiChips ?? []), ...triage.chips]))
                : thread.aiChips;
              const rowClass = [
                "ai-inbox-shell__row",
                thread.id === selectedThreadId ? "is-selected" : "",
                thread.unread ? "is-unread" : "",
                isSelected ? "is-multi-selected" : "",
              ].filter(Boolean).join(" ");
              return (
                <div
                  className={rowClass}
                  role="option"
                  aria-selected={isSelected || thread.id === selectedThreadId}
                  onClick={(event) => {
                    if (event.shiftKey) {
                      multi.handleRangeSelect(thread.id);
                    } else if (event.ctrlKey || event.metaKey) {
                      multi.handleToggleSelect(thread.id);
                    } else {
                      multi.handleClearSelection();
                      onSelectThread?.(thread.id);
                    }
                  }}
                  data-thread-id={thread.id}
                  data-testid={`thread-row-${thread.id}`}
                >
                  <label
                    className="ai-inbox-shell__row-check"
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`选择 ${thread.subject || "（无主题）"}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => multi.handleToggleSelect(thread.id)}
                      onClick={(event) => event.stopPropagation()}
                      data-testid={`thread-check-${thread.id}`}
                    />
                  </label>
                  <div className="ai-inbox-shell__row-main">
                    <div className="ai-inbox-shell__row-from">{thread.from.name ?? thread.from.address}</div>
                    <div className="ai-inbox-shell__row-subject">{thread.subject || "（无主题）"}</div>
                    <div className="ai-inbox-shell__row-snippet">{thread.snippet}</div>
                  </div>
                  <div className="ai-inbox-shell__row-chips">
                    {(effectiveChips ?? thread.aiChips ?? []).map((chip) => (
                      <span key={chip} className={`ai-chip ai-chip--${chip}`} title={triage?.reason ?? undefined}>
                        {CHIP_LABEL[chip]}
                      </span>
                    ))}
                  </div>
                </div>
              );
            }}
          />
        )}
      </section>

      <section className="ai-inbox-shell__detail" aria-label="邮件详情">
        {selectedThread ? (
          <>
            <header className="ai-inbox-shell__detail-head">
              <h3>{selectedThread.subject || "（无主题）"}</h3>
              <small>
                {selectedThread.from.name ?? selectedThread.from.address} ·{" "}
                {new Date(selectedThread.date).toLocaleString()} · {selectedThread.messageCount} 封
              </small>
            </header>

            <AiSummaryCard
              threadId={selectedThread.id}
              summary={aiInbox.summaries[selectedThread.id] ?? phaseIdle()}
              onEnsure={(id) => aiInbox.ensureSummary(id)}
              onAction={handleSummaryAction}
              onRetry={(id) => aiInbox.invalidate(id)}
            />

            <AiActionPlanStrip
              plan={aiLoop.plan}
              decisions={aiLoop.decisions}
              planning={aiLoop.planning}
              accepting={aiLoop.accepting}
              undoEntry={aiLoop.undoEntry}
              onAcceptPlan={() => void aiLoop.acceptPlan()}
              onCancelPlan={aiLoop.cancelPlan}
              onToggleDecision={aiLoop.setDecision}
              onBulkDecide={aiLoop.bulkDecide}
              onUndo={() => {
                recordTelemetry("action_undone", { count: aiLoop.undoEntry?.receipts.length ?? 0 }, accountId);
                void aiLoop.triggerUndo();
              }}
              onDismissUndo={aiLoop.dismissUndo}
            />

            <div className="ai-inbox-shell__messages">
              <p className="ai-inbox-shell__messages-empty">
                这里会渲染原邮件消息 — EmailDetail 现有实现可平替,保持 UI 一致性。
              </p>
            </div>

            <AiReplySuggester
              threadId={selectedThread.id}
              suggestions={aiInbox.replies[selectedThread.id] ?? phaseIdle()}
              onEnsure={(id, n) => aiInbox.ensureReplies(id, n)}
              onAdopt={handleAdoptReply}
              onRegenerate={(id) => aiInbox.invalidate(id)}
            />
          </>
        ) : (
          <div className="ai-inbox-shell__detail-empty">
            <p>从列表中选择一封邮件,这里会显示 AI 自动摘要与回复建议。</p>
          </div>
        )}
      </section>

      <AiCommandBar
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onSubmit={(prompt) => void handleCommandSubmit(prompt)}
        recentPrompts={recentPrompts}
      />

      <ReceiptToast
        receipts={toastReceipts ?? []}
        undoEntry={aiLoop.undoEntry}
        onUndo={() => { void aiLoop.triggerUndo(); setToastReceipts(null); }}
        onDismiss={() => setToastReceipts(null)}
      />

      <MailStatusBar
        aiStatus={aiStatus}
        threadCount={filteredThreads.length}
        pendingPlanCount={aiLoop.plan ? 1 : 0}
        undoSecondsRemaining={aiLoop.undoEntry
          ? Math.max(0, Math.ceil((30_000 - (Date.now() - aiLoop.undoEntry.createdAt)) / 1000))
          : 0}
      />
    </main>
  );
}

const RAIL_TITLE: Record<RailView, string> = {
  today: "Today · 今天要看的",
  later: "Later · 本周再处理",
  done: "Done · 已完成",
};

const CHIP_LABEL: Record<NonNullable<AiInboxThread["aiChips"]>[number], string> = {
  priority: "Priority",
  reply: "需要回复",
  action: "行动项",
  muted: "静音",
};

// Re-export common types so consumers can stay in one place.
export type { AiAction, AiActionReceipt, AiReplySuggestion, AiThreadSummary, AsyncPhase };
export type { AiInboxRuntime } from "../hooks/useAiInbox";
export type { RailCounts } from "./MailRail";
export { phaseIdle };
export { useAiInbox, useAiLoop } from "../hooks";
