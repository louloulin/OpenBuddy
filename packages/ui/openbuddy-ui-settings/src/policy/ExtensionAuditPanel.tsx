/**
 * ExtensionAuditPanel — 插件(扩展)策略决策审计面板。
 *
 * 数据来自 `useExtensionAuditPanel()`:agent host 每次解析 Pi 扩展集
 * (`resolvePiExtensions`)都会发一条 `pi/extension-policy-report`,
 * 里面是逐个 spec 的 allow / deny / needs-review 决策。
 *
 * 这个面板是**纯展示**:不写 store、不起定时器、不回调主进程 ——
 * 派生状态全在 hook 里,渲染层只负责把「N 允许 · M 拒绝 · K 待复核」画出来。
 *
 * 之所以要它:OpenBuddy 是本地优先的 BYOK 桌面应用,**插件准入必须是可审计的**。
 * 用户在设置里能看到"哪个扩展被拒、为什么",而不是只看到一句"加载失败"。
 *
 * 每个决策行带 `data-action="allow|deny|needs-review"`,由 CSS 上色
 * (deny = 红,needs-review = 琥珀,allow = 中性)。
 */
import { memo, useMemo } from "react";
import { useExtensionAuditPanel } from "@/hooks/useExtensionAuditPanel";
import type { ExtensionAuditDecision } from "@/lib/agent/extension-audit-event-parser";

export interface ExtensionAuditPanelProps {
  /**
   * 可选:hook 结果的覆盖值。省略时面板自己调 `useExtensionAuditPanel()`。
   * 测试与 Storybook 用它把面板钉在确定性状态上。
   */
  hookResult?: ReturnType<typeof useExtensionAuditPanel>;
  /** 追加到根 `<section>` 的类名。 */
  className?: string;
}

/** 决策徽标文案(allow / deny / needs-review → 中文)。 */
const ACTION_LABELS: Record<ExtensionAuditDecision["action"], string> = {
  allow: "允许",
  deny: "拒绝",
  "needs-review": "待复核",
};

function actionLabel(action: ExtensionAuditDecision["action"]): string {
  return ACTION_LABELS[action] ?? action;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "尚未收到策略报告";
  // 时间戳原样透出(ISO8601),不做本地化格式 —— 首屏 SSR/CSR 才不会不一致。
  return `最近一次解析 ${iso}`;
}

function ExtensionAuditPanelInner({
  hookResult,
  className,
}: ExtensionAuditPanelProps) {
  const hook = useExtensionAuditPanel();
  const { reports, summary, clear } = hookResult ?? hook;
  const latestReport = useMemo(() => {
    if (reports.length === 0) return null;
    // 报告按到达顺序追加,最后一条是最新的。
    return reports[reports.length - 1];
  }, [reports]);
  const hasReports = latestReport !== null;

  return (
    <section
      className={`extension-audit-panel${className ? ` ${className}` : ""}`}
      data-testid="extension-audit-panel"
      data-report-count={reports.length}
      aria-live="polite"
      aria-atomic="false"
    >
      <header className="extension-audit-panel__header">
        <h3 className="extension-audit-panel__title">插件策略审计</h3>
        <span
          className="extension-audit-panel__timestamp"
          data-testid="extension-audit-timestamp"
        >
          {formatTimestamp(summary.latest)}
        </span>
      </header>

      {hasReports && latestReport ? (
        <>
          <dl className="extension-audit-panel__summary" data-testid="extension-audit-summary">
            <div className="extension-audit-panel__metric" data-tone="allow">
              <dt>允许</dt>
              <dd data-testid="extension-audit-allowed">{summary.totalAllowed}</dd>
            </div>
            <div className="extension-audit-panel__metric" data-tone="deny">
              <dt>拒绝</dt>
              <dd data-testid="extension-audit-denied">{summary.totalDenied}</dd>
            </div>
            <div className="extension-audit-panel__metric" data-tone="needs-review">
              <dt>待复核</dt>
              <dd data-testid="extension-audit-needs-review">
                {summary.totalNeedsReview}
              </dd>
            </div>
            <div className="extension-audit-panel__metric" data-tone="resolves">
              <dt>解析次数</dt>
              <dd data-testid="extension-audit-resolves">{summary.reports}</dd>
            </div>
            <div className="extension-audit-panel__metric" data-tone="total">
              <dt>决策数</dt>
              <dd data-testid="extension-audit-last-decision-count">
                {summary.lastDecisionCount}
              </dd>
            </div>
          </dl>

          {latestReport.decisions.length === 0 ? (
            // 空报告是**正常的**:profile 里一个 Pi 扩展都没有时,resolver 照样
            // 发一条 total=0 的报告。这里必须说清楚"策略就绪、只是还没东西可判",
            // 否则用户看到一张 0 表格会以为审计坏了。
            <p
              className="extension-audit-panel__empty"
              data-testid="extension-audit-no-decisions"
            >
              {`当前 profile 里没有已配置的 Pi 扩展 —— 策略已就绪,安装扩展后这里会逐条显示准入决策(最近一次解析 ${latestReport.generatedAt})。`}
            </p>
          ) : (
          <ul
            className="extension-audit-panel__rows"
            data-testid="extension-audit-rows"
          >
            {latestReport.decisions.map((decision) => (
              <li
                key={`${decision.id}::${decision.packageName ?? ""}`}
                className="extension-audit-panel__row"
                data-testid="extension-audit-row"
                data-decision-id={decision.id}
                data-action={decision.action}
              >
                <span className="extension-audit-panel__row-id">{decision.id}</span>
                <span
                  className="extension-audit-panel__action"
                  data-testid={`extension-audit-action-${decision.action}`}
                >
                  {actionLabel(decision.action)}
                </span>
                <span className="extension-audit-panel__reason">{decision.reason}</span>
              </li>
            ))}
          </ul>
          )}

          <button
            type="button"
            className="extension-audit-panel__clear"
            data-testid="extension-audit-clear"
            onClick={() => clear()}
          >
            清空记录
          </button>
        </>
      ) : (
        <p
          className="extension-audit-panel__empty"
          data-testid="extension-audit-empty"
        >
          {`尚未收到 agent host 的插件策略报告(已收到 ${summary.reports} 条)。启动一次会话后这里会显示逐个扩展的准入决策。`}
        </p>
      )}
    </section>
  );
}

export const ExtensionAuditPanel = memo(ExtensionAuditPanelInner);
