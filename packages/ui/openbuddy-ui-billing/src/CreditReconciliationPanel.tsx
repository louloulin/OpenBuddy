/**
 * OpenBuddy New API 成本对账面板。
 *
 * 展示 Gateway 本地积分账本和独立 Worker 导入的 New API 外部成本。
 */
import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { casdoorExportCreditReconciliation, casdoorGetCreditReconciliation, casdoorStatus } from "@/lib/casdoor/casdoor-client";
import { invoke } from "@/lib/platform/electron-api";
import { exportTextFile } from "@/lib/agent/pi-client";
import type { CasdoorReconciliationBucket, CasdoorReconciliationReport } from "@openbuddy/auth-casdoor";

function SectionShell({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return <div className="settings-section"><h2 className="settings-section__title">{title}</h2>{desc && <p className="settings-section__desc">{desc}</p>}<div className="settings-section__body">{children}</div></div>;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, "");
  return String(error || "操作失败").replace(/^Error:\s*/, "");
}

function number(value: number): string { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value); }
function amountMinor(value: number): string { return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100); }
function amountMajor(value: number): string { return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value); }
function amounts(values: Record<string, number> | undefined): string {
  if (!values || Object.keys(values).length === 0) return "无";
  return Object.entries(values).map(([currency, value]) => `${currency} ${amountMinor(value)}`).join(" · ");
}
function majorAmounts(values: Record<string, number> | undefined): string {
  if (!values || Object.keys(values).length === 0) return "无";
  return Object.entries(values).map(([currency, value]) => `${currency} ${amountMajor(value)}`).join(" · ");
}
function bucketLabel(bucket: CasdoorReconciliationBucket): string {
  return `${number(bucket.requests)} 次 · ${number(bucket.totalTokens)} tokens · ${number(bucket.pointsSettled)} 积分 · 上游成本 ${number(bucket.upstreamCost)}`;
}

function externalBucketLabel(bucket: CasdoorReconciliationBucket): string {
  return `${number(bucket.requests)} 次 · ${number(bucket.totalTokens)} tokens · 外部成本 ${number(bucket.externalCost ?? 0)}`;
}

function dimensionList(values: Record<string, CasdoorReconciliationBucket> | undefined, empty = "暂无记录") {
  const entries = Object.entries(values ?? {});
  if (entries.length === 0) return <li className="shortcuts-list__row"><span className="settings-hint">{empty}</span></li>;
  return entries.map(([key, bucket]) => <li key={key} className="shortcuts-list__row"><span className="shortcuts-list__action">{key}</span><span className="shortcuts-list__key">{bucketLabel(bucket)}</span></li>);
}

function externalDimensionList(values: Record<string, CasdoorReconciliationBucket> | undefined, empty = "暂无外部成本记录") {
  const entries = Object.entries(values ?? {});
  if (entries.length === 0) return <li className="shortcuts-list__row"><span className="settings-hint">{empty}</span></li>;
  return entries.map(([key, bucket]) => <li key={key} className="shortcuts-list__row"><span className="shortcuts-list__action">{key}</span><span className="shortcuts-list__key">{externalBucketLabel(bucket)}</span></li>);
}

export function CreditReconciliationPanel() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [report, setReport] = useState<CasdoorReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [walletId, setWalletId] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const reload = useCallback(async (requestedWalletId = "") => {
    setLoading(true);
    setMessage(null);
    try {
      const status = await casdoorStatus().catch(() => null);
      setTenantId(status?.tenantContext.activeTenantId ?? null);
      const next = requestedWalletId.trim()
        ? await casdoorGetCreditReconciliation(undefined, undefined, requestedWalletId.trim())
        : await casdoorGetCreditReconciliation();
      setReport(next);
    } catch (error) {
      setReport(null);
      setMessage({ kind: "err", text: `加载对账报告失败：${describeError(error)}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const exportReport = useCallback(async () => {
    setExporting(true);
    setMessage(null);
    try {
      const exported = await casdoorExportCreditReconciliation(undefined, undefined, walletId.trim() || undefined);
      const selectedPath = await invoke<string | null>("dialog:save", { defaultPath: exported.filename, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!selectedPath) return;
      await exportTextFile(selectedPath, exported.body);
      setMessage({ kind: "ok", text: `对账 CSV 已导出：${selectedPath}${exported.reportId ? `（报告 ${exported.reportId}）` : exported.reportHash ? `（报告哈希 ${exported.reportHash.slice(0, 12)}…）` : ""}` });
    } catch (error) {
      setMessage({ kind: "err", text: `导出对账报告失败：${describeError(error)}` });
    } finally {
      setExporting(false);
    }
  }, [walletId]);

  return (
    <SectionShell title="成本对账" desc="汇总当前租户本地积分账本与 New API 外部成本导入。外部成本必须由独立 Worker 导入，直接供应商成本、实例 quota 推导和配置价格推导会分开显示。">
      {!tenantId ? <p className="settings-hint">请先登录并选择租户，再查看成本对账。</p> : <p className="settings-hint">当前租户：<strong>{tenantId}</strong> · 需要积分读取权限</p>}
      <div className="settings-actions">
        <label className="settings-field"><span className="settings-field__label">共享钱包范围（可选）</span><input className="settings-input" value={walletId} onChange={(event) => setWalletId(event.target.value)} placeholder="输入 walletId，留空按租户" /></label>
        <button className="settings-btn" onClick={() => reload(walletId)} disabled={loading || exporting}><RefreshCw size={14} /> {loading ? "加载中…" : "刷新"}</button>
        <button className="settings-btn" onClick={() => void exportReport()} disabled={loading || exporting || !tenantId}><BarChart3 size={14} /> {exporting ? "导出中…" : "导出 CSV"}</button>
      </div>
      {report && <>
        <p className="settings-hint" data-testid="credit-reconciliation-scope">统计范围：{report.scope === "wallet" ? `共享钱包 ${report.walletId}` : "当前租户"}</p>
        <div className="account-section" data-testid="credit-reconciliation-summary">
          <div className="account-section__header"><h3 className="account-section__title"><BarChart3 size={16} /> 总览</h3><span className="account-badge account-badge--ok">本地账本</span></div>
          <ul className="shortcuts-list">
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">请求 / token</span><span className="shortcuts-list__key">{number(report.total.requests)} 次 · {number(report.total.totalTokens)} tokens</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">结算积分</span><span className="shortcuts-list__key">{number(report.total.pointsSettled)}</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">上游成本</span><span className="shortcuts-list__key">{number(report.total.upstreamCost)}（{number(report.total.upstreamCostEntries)} 条有成本）</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">外部成本</span><span className="shortcuts-list__key">{report.external?.totalCostByCurrency && Object.keys(report.external.totalCostByCurrency).length > 1 ? Object.entries(report.external.totalCostByCurrency).map(([currency, cost]) => `${currency} ${number(cost)}`).join(" · ") : number(report.external?.totalCost ?? 0)}（{number(report.external?.records ?? 0)} 条，{report.external?.providerReportedRecords ? "供应商已报告" : report.external?.providerReportedQuotaRecords ? "按实例 quota 推导" : report.external?.records ? "仅配置推导/未确认" : "未导入"}）</span></li>
            {report.external?.costBasis && Object.entries(report.external.costBasis).map(([basis, cost]) => <li key={basis} className="shortcuts-list__row"><span className="shortcuts-list__action">成本依据：{basis}</span><span className="shortcuts-list__key">{number(cost)}</span></li>)}
            {report.external && <li className="shortcuts-list__row"><span className="shortcuts-list__action">对账匹配</span><span className="shortcuts-list__key">{number(report.external.matchedRecords)} 已匹配 · {number(report.external.unmatchedRecords)} 未匹配</span></li>}
            <li className="shortcuts-list__row" data-testid="credit-reconciliation-coverage"><span className="shortcuts-list__action">成本覆盖率</span><span className="shortcuts-list__key">{number(report.coveragePercent)}%</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">报告标识</span><span className="shortcuts-list__key">{report.reportId}</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">报告哈希</span><span className="shortcuts-list__key">{report.reportHash}</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">报告时间</span><span className="shortcuts-list__key">{new Date(report.generatedAt).toLocaleString()}</span></li>
          </ul>
        </div>
        {report.commerce && <div className="account-section" data-testid="credit-reconciliation-commerce">
          <div className="account-section__header"><h3 className="account-section__title">商业订单摘要</h3><span className="account-badge account-badge--ok">原币种</span></div>
          <ul className="shortcuts-list">
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">净收入</span><span className="shortcuts-list__key">{amounts(report.commerce.netAmountMinorByCurrency)}</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">毛订单 / 退款订单</span><span className="shortcuts-list__key">{number(report.commerce.grossOrders)} / {number(report.commerce.refundedOrders)}</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">毛收入</span><span className="shortcuts-list__key">{amounts(report.commerce.grossAmountMinorByCurrency)}</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">退款金额</span><span className="shortcuts-list__key">{amounts(report.commerce.refundedAmountMinorByCurrency)}</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">净积分</span><span className="shortcuts-list__key">{number(report.commerce.netPoints)}</span></li>
          </ul>
          <p className="settings-hint">金额按订单原币种展示；此摘要不是财务总账，不做汇率换算。</p>
        </div>}
        {report.economics && <div className="account-section" data-testid="credit-reconciliation-economics">
          <div className="account-section__header"><h3 className="account-section__title">单位经济性</h3><span className="account-badge account-badge--ok">证据分层</span></div>
          <ul className="shortcuts-list">
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">已结算积分</span><span className="shortcuts-list__key">{number(report.economics.settledPoints)}</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">核验成本</span><span className="shortcuts-list__key">{amounts(report.economics.verifiedExternalCostByCurrency)}（{number(report.economics.verifiedCostRecords)} 条）</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">成本匹配率</span><span className="shortcuts-list__key">{number(report.economics.costCoveragePercent)}%（{number(report.economics.matchedVerifiedCostRecords)} / {number(report.economics.verifiedCostRecords)}）</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">未匹配核验成本</span><span className="shortcuts-list__key">{amounts(report.economics.unmatchedVerifiedExternalCostByCurrency)}（{number(report.economics.unmatchedVerifiedCostRecords)} 条）</span></li>
            <li className="shortcuts-list__row"><span className="shortcuts-list__action">同币种贡献毛利</span><span className="shortcuts-list__key">{majorAmounts(report.economics.contributionMarginMajorByCurrency)}</span></li>
          </ul>
          <p className="settings-hint">贡献毛利只在订单收入与核验成本币种相同且成本有证据时计算；不跨币种换算，不把 New API quota 当作货币。</p>
        </div>}
        <div className="account-section" data-testid="credit-reconciliation-models"><div className="account-section__header"><h3 className="account-section__title">按模型</h3></div><ul className="shortcuts-list">{dimensionList(report.byModel)}</ul></div>
        <div className="account-section" data-testid="credit-reconciliation-subjects"><div className="account-section__header"><h3 className="account-section__title">按成员</h3></div><ul className="shortcuts-list">{dimensionList(report.bySubject)}</ul></div>
        <div className="account-section" data-testid="credit-reconciliation-actors"><div className="account-section__header"><h3 className="account-section__title">按发起成员</h3></div><p className="settings-hint">共享钱包请求按实际发起的 Casdoor 成员归属；普通个人账户没有单独的 actor 维度。</p><ul className="shortcuts-list">{dimensionList(report.byActor, "暂无共享钱包发起成员记录")}</ul></div>
        {report.external && <div className="account-section" data-testid="credit-reconciliation-external-actors"><div className="account-section__header"><h3 className="account-section__title">New API 外部成本 · 按发起成员</h3></div><ul className="shortcuts-list">{externalDimensionList(report.external.byActor)}</ul></div>}
        <div className="account-section" data-testid="credit-reconciliation-agents"><div className="account-section__header"><h3 className="account-section__title">按 Agent / 工作流</h3></div><ul className="shortcuts-list">{dimensionList(report.byAgent, "请求未携带 Agent 标识")}</ul></div>
        <div className="account-section" data-testid="credit-reconciliation-sessions"><div className="account-section__header"><h3 className="account-section__title">按会话</h3></div><ul className="shortcuts-list">{dimensionList(report.bySession, "请求未携带会话标识")}</ul></div>
      </>}
      {message && <p className={`settings-msg ${message.kind === "ok" ? "settings-msg--ok" : message.kind === "warn" ? "settings-msg--warn" : "settings-msg--err"}`} data-testid="credit-reconciliation-message" role="alert">{message.text}</p>}
    </SectionShell>
  );
}

export default CreditReconciliationPanel;
