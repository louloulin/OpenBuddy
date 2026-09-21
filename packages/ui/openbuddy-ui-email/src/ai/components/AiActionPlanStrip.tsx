/**
 * AiActionPlanStrip — 顶部 AI 行动条。
 *
 * 闭环可视化:把 useAiLoop 的 4 个阶段(Planning / Confirm / Executing / Receipt)统一
 * 渲染成一条彩色 strip。
 *
 * 阶段转换:
 *   idle             → 不渲染
 *   planning loading → "AI 正在分析 {count} 封邮件"
 *   plan ready       → "{accepted}/{total} 已选 · 一键执行" + 全选/全驳
 *   executing        → 进度条 + "正在归档 X/Y"
 *   receipts ready   → "已归档 X · 静音 Y · 失败 0" + 30s 撤销
 */
import type {
  AiAction,
  AiActionDecision,
  AiActionPlan,
  AiActionReceipt,
  AsyncPhase,
  UndoEntry,
} from "../types";
import { phaseIsError, phaseIsLoading, phaseIsReady } from "../types";

export interface AiActionPlanStripProps {
  plan: AiActionPlan | null;
  decisions: Record<string, AiActionDecision>;
  planning: AsyncPhase<AiAction[]>;
  accepting: boolean;
  undoEntry: UndoEntry | null;
  onAcceptPlan: () => void;
  onCancelPlan: () => void;
  onToggleDecision: (actionId: string, decision: AiActionDecision) => void;
  onBulkDecide: (decision: AiActionDecision) => void;
  onUndo: () => void;
  onDismissUndo: () => void;
  undoWindowMs?: number;
}

export function AiActionPlanStrip({
  plan,
  decisions,
  planning,
  accepting,
  undoEntry,
  onAcceptPlan,
  onCancelPlan,
  onToggleDecision,
  onBulkDecide,
  onUndo,
  onDismissUndo,
  undoWindowMs = 30_000,
}: AiActionPlanStripProps): JSX.Element | null {
  // 阶段 0: 完全空闲 — 不渲染。
  if (!plan && phaseIsLoading(planning)) {
    return (
      <StripShell tone="loading" icon="✨" title="AI 正在分析邮件…">
        <span className="ai-action-strip__spinner" aria-hidden="true" />
      </StripShell>
    );
  }

  if (undoEntry && !accepting) {
    const createdAt = undoEntry.createdAt;
    const remainingSec = Math.max(
      0,
      Math.ceil((undoWindowMs - (Date.now() - createdAt)) / 1000),
    );
    return (
      <StripShell
        tone="success"
        icon="✅"
        title={receiptSummary(undoEntry.receipts)}
        meta={`撤销剩余 ${remainingSec}s`}
        actions={
          <>
            <button type="button" className="ai-action-strip__btn-secondary" onClick={onDismissUndo}>
              关闭
            </button>
            <button type="button" className="ai-action-strip__btn-primary" onClick={onUndo}>
              ↶ 撤销
            </button>
          </>
        }
      />
    );
  }

  if (!plan) return null;

  // 阶段 1: 计划生成失败。
  if (phaseIsError(planning)) {
    return (
      <StripShell
        tone="error"
        icon="⚠️"
        title="AI 分析失败"
        meta={planning.error}
        actions={
          <button type="button" className="ai-action-strip__btn-secondary" onClick={onCancelPlan}>
            关闭
          </button>
        }
      />
    );
  }

  // 阶段 2: 计划已就绪 — 用户决定接受/拒绝每条 action。
  if (phaseIsReady(planning) && plan.phase.status === "idle") {
    const actions = planning.value;
    const total = actions.length;
    const accepted = actions.filter((a) => decisions[a.id] !== "rejected").length;
    if (total === 0) {
      return (
        <StripShell
          tone="info"
          icon="✨"
          title="AI 没有建议 — 没有需要操作的邮件。"
          actions={
            <button type="button" className="ai-action-strip__btn-secondary" onClick={onCancelPlan}>
              关闭
            </button>
          }
        />
      );
    }
    return (
      <StripShell
        tone="pending"
        icon="🪄"
        title={`AI 建议 ${total} 个操作 · 已选 ${accepted}`}
        meta={plan.prompt}
        actions={
          <>
            <button type="button" className="ai-action-strip__btn-secondary" onClick={onCancelPlan}>
              取消
            </button>
            <button
              type="button"
              className="ai-action-strip__btn-secondary"
              onClick={() => onBulkDecide("rejected")}
            >
              全驳
            </button>
            <button type="button" className="ai-action-strip__btn-primary" onClick={onAcceptPlan}>
              ✓ 一键执行 {accepted}
            </button>
          </>
        }
      >
        <details className="ai-action-strip__details">
          <summary>查看明细</summary>
          <ul className="ai-action-strip__list">
            {actions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                decision={decisions[action.id] ?? "pending"}
                onToggle={(d) => onToggleDecision(action.id, d)}
              />
            ))}
          </ul>
        </details>
      </StripShell>
    );
  }

  // 阶段 3: 执行中
  if (accepting || plan.phase.status === "loading") {
    return (
      <StripShell tone="loading" icon="⏳" title="正在执行 AI 操作…">
        <progress className="ai-action-strip__progress" />
      </StripShell>
    );
  }

  // 阶段 4: 执行结果(已无 undoEntry,因为上面被 early-return)
  if (plan.phase.status === "error") {
    return (
      <StripShell
        tone="error"
        icon="⚠️"
        title="执行失败"
        actions={
          <button type="button" className="ai-action-strip__btn-secondary" onClick={onCancelPlan}>
            关闭
          </button>
        }
      />
    );
  }

  return null;
}

interface ActionRowProps {
  action: AiAction;
  decision: AiActionDecision;
  onToggle: (d: AiActionDecision) => void;
}

function ActionRow({ action, decision, onToggle }: ActionRowProps): JSX.Element {
  const label = labelForAction(action);
  return (
    <li className="ai-action-strip__row" data-decision={decision}>
      <label>
        <input
          type="checkbox"
          checked={decision !== "rejected"}
          onChange={(event) => onToggle(event.target.checked ? "accepted" : "rejected")}
        />
        <span className="ai-action-strip__row-label">{label}</span>
      </label>
      <span className="ai-action-strip__row-confidence">
        {Math.round(action.confidence * 100)}%
      </span>
    </li>
  );
}

interface StripShellProps {
  tone: "pending" | "loading" | "success" | "error" | "info";
  icon: string;
  title: string;
  meta?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}

function StripShell({ tone, icon, title, meta, children, actions }: StripShellProps): JSX.Element {
  return (
    <section className={`ai-action-strip ai-action-strip--${tone}`} data-tone={tone} role="region" aria-label="AI 行动计划">
      <span className="ai-action-strip__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="ai-action-strip__main">
        <div className="ai-action-strip__title">{title}</div>
        {meta ? <div className="ai-action-strip__meta">{meta}</div> : null}
        {children}
      </div>
      {actions ? <div className="ai-action-strip__actions">{actions}</div> : null}
    </section>
  );
}

function labelForAction(action: AiAction): string {
  switch (action.kind) {
    case "archive":
      return `📦 归档: ${action.threadId}`;
    case "label":
      return `🏷 加标签 ${action.label ?? ""}: ${action.threadId}`;
    case "snooze":
      return `⏰ 稍后处理到 ${action.snoozeUntil ?? "（未指定）"}`;
    case "mark-read":
      return `✓ 标为已读: ${action.threadId}`;
    case "reply-draft":
      return `✍️ 写回复草稿: ${action.threadId}`;
    case "create-task":
      return `📋 创建任务: ${action.taskTitle ?? action.threadId}`;
  }
}

function receiptSummary(receipts: AiActionReceipt[]): string {
  const counts = new Map<AiActionReceipt["kind"], number>();
  for (const receipt of receipts) {
    if (receipt.status !== "executed") continue;
    counts.set(receipt.kind, (counts.get(receipt.kind) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [kind, count] of counts) {
    parts.push(`${labelForKind(kind)} ${count}`);
  }
  const failed = receipts.filter((r) => r.status === "failed").length;
  if (failed > 0) parts.push(`失败 ${failed}`);
  return parts.length === 0 ? "已执行" : `已执行 · ${parts.join(" · ")}`;
}

function labelForKind(kind: AiActionReceipt["kind"]): string {
  switch (kind) {
    case "archive":
      return "归档";
    case "label":
      return "标签";
    case "snooze":
      return "稍后";
    case "mark-read":
      return "已读";
    case "reply-draft":
      return "回复";
    case "create-task":
      return "任务";
  }
}
