/**
 * EmailHeader — 简化版邮件工作区头部。
 *
 * 第 2 周改进(P1-2):从 7 个 AI 按钮砍到 2 个。
 *   - 搜索框(`/` 聚焦)
 *   - 新建邮件按钮
 *
 * AI 全部动作下沉到:
 *   - AiActionPlanStrip(顶部)
 *   - AiSummaryCard(详情)
 *   - AiReplySuggester(详情)
 *   - AiCommandBar(Cmd+K)
 *
 * 旧 header 的"待确认计划 / AI 行动中心 / 待我回复 / 摘要 / 分诊"按钮
 * 仍在 EmailPanel 的旧实现里被调用 — 我们保留 callback prop 接口,
 * 但默认实现 noop,这样旧 EmailPanel 调用不会崩,新 UI 也只显示 2 个按钮。
 */
export interface EmailHeaderProps {
  onSearch?: (query: string) => void;
  onCompose: () => void;
  /** 旧 callback 接口(保留兼容) — 默认 noop。 */
  onOpenPendingPlan?: (plan?: unknown) => void;
  /** 旧 prop:保留兼容 — EmailPanel.tsx 还在传。 */
  pendingPlans?: unknown[];
  /** 旧 prop:保留兼容。 */
  actionCenterLoading?: boolean;
  onOpenActionCenter?: () => void;
  onRunReplyZero?: (kind: "needs_reply" | "waiting_for_reply") => void;
  onRunDigest?: () => void;
  onRunTriage?: () => void;
  onRunSummary?: () => void;
  pendingPlanCount?: number;
  accountId?: string;
  canCompose?: boolean;
}

export function EmailHeader({
  onSearch,
  onCompose,
  onOpenPendingPlan = () => undefined,
  onOpenActionCenter = () => undefined,
  onRunReplyZero = () => undefined,
  onRunDigest = () => undefined,
  onRunTriage = () => undefined,
  onRunSummary = () => undefined,
  pendingPlanCount = 0,
  pendingPlans: _pendingPlans = [],
  actionCenterLoading: _actionCenterLoading = false,
  accountId,
  canCompose = true,
}: EmailHeaderProps): JSX.Element {
  const hasAccount = Boolean(accountId);
  return (
    <header className="email-panel__header wb-email-header" data-simplified="true">
      <div className="wb-email-header__title">
        <h1>邮件</h1>
        <p>用 AI 处理邮件 — 3 段视图、自动摘要、3 选 1 回复。</p>
      </div>
      <div className="wb-email-header__actions" aria-label="邮件工作区操作">
        <div className="wb-email-header__search">
          <span aria-hidden="true">🔍</span>
          <input
            type="search"
            placeholder="搜索或输入自然语言命令(按 / 聚焦)"
            onChange={(event) => onSearch?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.currentTarget.value.trim()) {
                onSearch?.(event.currentTarget.value.trim());
              }
            }}
            aria-label="搜索邮件"
          />
        </div>
        <button type="button" className="wb-email-header__legacy" onClick={onOpenActionCenter} title="AI 行动中心(旧)" aria-label="AI 行动中心">
          AI 行动{(pendingPlanCount > 0 ? pendingPlanCount : (_pendingPlans?.length ?? 0)) > 0 ? `（${pendingPlanCount > 0 ? pendingPlanCount : _pendingPlans?.length}）` : ""}
        </button>
        <button type="button" className="email-primary" disabled={!canCompose || !hasAccount} onClick={onCompose}>
          📨 新建
        </button>
      </div>
      {/* 旧 callback 仍然存在但默认 noop — 保留向后兼容,新 UI 不渲染。 */}
      <div hidden>
        <button type="button" onClick={onOpenPendingPlan} aria-hidden="true" />
        <button type="button" onClick={() => onRunReplyZero("needs_reply")} aria-hidden="true" />
        <button type="button" onClick={() => onRunReplyZero("waiting_for_reply")} aria-hidden="true" />
        <button type="button" onClick={onRunDigest} aria-hidden="true" />
        <button type="button" onClick={onRunTriage} aria-hidden="true" />
        <button type="button" onClick={onRunSummary} aria-hidden="true" />
      </div>
    </header>
  );
}
