/**
 * OpenBuddy 积分定价面板。
 *
 * 让企业管理员按模型配置每千 token 的输入/输出积分以及最低消费。
 * 调整会通过 IPC `casdoor:credits-pricing-update` 写入 Gateway，
 * Gateway 的 `parseUsage` / 积分结算逻辑会立即采用新价格。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, RefreshCw, Save } from "lucide-react";
import {
  casdoorListCreditPricing,
  casdoorQuoteCredits,
  casdoorUpdateCreditPricing,
  casdoorStatus,
} from "@/lib/casdoor/casdoor-client";
import type { CasdoorCreditPricing, CasdoorCreditQuote } from "@openbuddy/auth-casdoor";

function SectionShell({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <h2 className="settings-section__title">{title}</h2>
      {desc && <p className="settings-section__desc">{desc}</p>}
      <div className="settings-section__body">{children}</div>
    </div>
  );
}

interface DraftPricing {
  model: string;
  inputPointsPerThousand: number;
  outputPointsPerThousand: number;
  minimumPoints: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  costCurrency?: string;
  costSource?: CasdoorCreditPricing["costSource"];
}

function describeError(error: unknown): string {
  if (!error) return "操作失败";
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, "");
  return String(error).replace(/^Error:\s*/, "");
}

function toDraft(pricing: CasdoorCreditPricing): DraftPricing {
  return {
    model: pricing.model,
    inputPointsPerThousand: pricing.inputPointsPerThousand,
    outputPointsPerThousand: pricing.outputPointsPerThousand,
    minimumPoints: pricing.minimumPoints,
    inputCostPerMillion: pricing.inputCostPerMillion,
    outputCostPerMillion: pricing.outputCostPerMillion,
    costCurrency: pricing.costCurrency,
    costSource: pricing.costSource,
  };
}

export function CreditPricingPanel() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftPricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingModel, setSavingModel] = useState<string | null>(null);
  const [quoteModel, setQuoteModel] = useState("");
  const [quotePromptTokens, setQuotePromptTokens] = useState(1000);
  const [quoteCompletionTokens, setQuoteCompletionTokens] = useState(500);
  const [quote, setQuote] = useState<CasdoorCreditQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const session = await casdoorStatus().catch(() => null);
      setTenantId(session?.tenantContext.activeTenantId ?? null);
      const list = await casdoorListCreditPricing().catch((error) => {
        setMessage({ kind: "warn", text: `加载定价失败：${describeError(error)}` });
        return [] as CasdoorCreditPricing[];
      });
      const draftList = list.map(toDraft);
      setDrafts(draftList);
      setOriginals(draftList.map((entry) => ({ ...entry })));
      setQuoteModel((current) => current && draftList.some((entry) => entry.model === current) ? current : draftList[0]?.model ?? "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const [originals, setOriginals] = useState<DraftPricing[]>([]);
  const dirty = useMemo(() => {
    const set = new Set<string>();
    const originalMap = new Map(originals.map((entry) => [entry.model, entry]));
    for (const draft of drafts) {
      const original = originalMap.get(draft.model);
      if (!original) continue;
      const isDirty =
        draft.inputPointsPerThousand !== original.inputPointsPerThousand ||
        draft.outputPointsPerThousand !== original.outputPointsPerThousand ||
        draft.minimumPoints !== original.minimumPoints ||
        draft.inputCostPerMillion !== original.inputCostPerMillion ||
        draft.outputCostPerMillion !== original.outputCostPerMillion ||
        draft.costCurrency !== original.costCurrency ||
        draft.costSource !== original.costSource;
      if (isDirty) set.add(draft.model);
    }
    return set;
  }, [drafts, originals]);

  const update = useCallback((model: string, patch: Partial<Omit<DraftPricing, "model">>) => {
    setDrafts((prev) => prev.map((entry) => (entry.model === model ? { ...entry, ...patch } : entry)));
  }, []);

  const handleSave = useCallback(async (model: string) => {
    const draft = drafts.find((entry) => entry.model === model);
    if (!draft) return;
    setSavingModel(model);
    try {
      await casdoorUpdateCreditPricing({
        model: draft.model,
        inputPointsPerThousand: Math.max(0, Math.floor(draft.inputPointsPerThousand)),
        outputPointsPerThousand: Math.max(0, Math.floor(draft.outputPointsPerThousand)),
        minimumPoints: Math.max(0, Math.floor(draft.minimumPoints)),
        ...(draft.inputCostPerMillion === undefined || draft.outputCostPerMillion === undefined ? {} : {
          inputCostPerMillion: Math.max(0, draft.inputCostPerMillion),
          outputCostPerMillion: Math.max(0, draft.outputCostPerMillion),
          costCurrency: draft.costCurrency || "USD",
          costSource: draft.costSource || "configured-pricing",
        }),
      });
      setMessage({ kind: "ok", text: `模型 ${draft.model} 定价已保存` });
    } catch (error) {
      setMessage({ kind: "err", text: describeError(error) });
    } finally {
      setSavingModel(null);
    }
  }, [drafts]);

  const handleQuote = useCallback(async () => {
    if (!quoteModel || !tenantId) return;
    setQuoting(true);
    setMessage(null);
    try {
      const result = await casdoorQuoteCredits({
        model: quoteModel,
        promptTokens: Math.max(0, Math.floor(quotePromptTokens)),
        completionTokens: Math.max(0, Math.floor(quoteCompletionTokens)),
      });
      setQuote(result);
    } catch (error) {
      setQuote(null);
      setMessage({ kind: "err", text: describeError(error) });
    } finally {
      setQuoting(false);
    }
  }, [quoteCompletionTokens, quoteModel, quotePromptTokens, tenantId]);

  return (
    <SectionShell
      title="积分定价"
      desc="配置销售积分与供应商成本基线。积分用于用户扣费，成本用于 New API 对账和毛利核算，两者不会互相替代。"
    >
      {!tenantId ? (
        <p className="settings-hint">请先登录并选择租户，再配置积分定价。</p>
      ) : (
        <p className="settings-hint">当前租户：<strong>{tenantId}</strong> · 共 {drafts.length} 条定价</p>
      )}

      <div className="account-section" data-testid="credit-pricing-section">
        <div className="account-section__header">
          <h3 className="account-section__title">
            <Coins size={16} /> 模型定价
          </h3>
          <button className="settings-btn" onClick={reload} disabled={loading}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
        {loading && drafts.length === 0 ? (
          <p className="settings-hint">正在加载定价…</p>
        ) : drafts.length === 0 ? (
          <p className="settings-hint">暂无定价规则。可通过 Gateway 环境变量或后端 API 添加初始规则。</p>
        ) : (
          <ul className="shortcuts-list" data-testid="credit-pricing-list">
            {drafts.map((draft) => {
              const isDirty = dirty.has(draft.model);
              return (
                <li key={draft.model} className="shortcuts-list__row">
                  <div className="shortcuts-list__row-meta">
                    <span className="shortcuts-list__action">{draft.model}</span>
                    <span className="shortcuts-list__key">
                      输入：
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={draft.inputPointsPerThousand}
                        onChange={(event) => update(draft.model, { inputPointsPerThousand: Number(event.target.value) || 0 })}
                        data-testid={`credit-pricing-input-${draft.model}`}
                        style={{ width: 70, marginRight: 8 }}
                      />
                      输出：
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={draft.outputPointsPerThousand}
                        onChange={(event) => update(draft.model, { outputPointsPerThousand: Number(event.target.value) || 0 })}
                        data-testid={`credit-pricing-output-${draft.model}`}
                        style={{ width: 70, marginRight: 8 }}
                      />
                      最低：
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={draft.minimumPoints}
                        onChange={(event) => update(draft.model, { minimumPoints: Number(event.target.value) || 0 })}
                        data-testid={`credit-pricing-min-${draft.model}`}
                        style={{ width: 70 }}
                      />
                      <span className="shortcuts-list__key"> 积分 / 千 token</span>
                      <span className="shortcuts-list__key"> 成本 / 百万 token：</span>
                      <input type="number" min={0} step={0.01} value={draft.inputCostPerMillion ?? ""} onChange={(event) => update(draft.model, { inputCostPerMillion: event.target.value === "" ? undefined : Number(event.target.value) })} data-testid={`credit-pricing-cost-input-${draft.model}`} style={{ width: 78, marginRight: 8 }} />
                      /
                      <input type="number" min={0} step={0.01} value={draft.outputCostPerMillion ?? ""} onChange={(event) => update(draft.model, { outputCostPerMillion: event.target.value === "" ? undefined : Number(event.target.value) })} data-testid={`credit-pricing-cost-output-${draft.model}`} style={{ width: 78, marginRight: 8 }} />
                      {draft.costCurrency ?? "USD"}
                    </span>
                  </div>
                  <button
                    className="settings-btn"
                    data-testid={`credit-pricing-save-${draft.model}`}
                    onClick={() => handleSave(draft.model)}
                    disabled={!isDirty || savingModel === draft.model || !tenantId}
                  >
                    <Save size={14} /> 保存
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="account-section" data-testid="credit-quote-section">
        <div className="account-section__header">
          <h3 className="account-section__title">服务端积分报价</h3>
        </div>
        <p className="settings-hint">报价由 Gateway 按当前租户价格计算，仅用于试算，不会扣除积分；最终扣费以 New API 实际 usage 为准。</p>
        <div className="shortcuts-list__row">
          <label className="shortcuts-list__key">
            模型
            <select value={quoteModel} onChange={(event) => { setQuoteModel(event.target.value); setQuote(null); }} data-testid="credit-quote-model">
              {drafts.map((draft) => <option key={draft.model} value={draft.model}>{draft.model}</option>)}
            </select>
          </label>
          <label className="shortcuts-list__key">
            输入 token
            <input type="number" min={0} step={1} value={quotePromptTokens} onChange={(event) => setQuotePromptTokens(Number(event.target.value) || 0)} data-testid="credit-quote-prompt" />
          </label>
          <label className="shortcuts-list__key">
            输出 token
            <input type="number" min={0} step={1} value={quoteCompletionTokens} onChange={(event) => setQuoteCompletionTokens(Number(event.target.value) || 0)} data-testid="credit-quote-completion" />
          </label>
          <button className="settings-btn" onClick={() => void handleQuote()} disabled={quoting || !tenantId || !quoteModel} data-testid="credit-quote-submit">
            {quoting ? "报价中…" : "获取报价"}
          </button>
        </div>
        {quote && <p className="settings-msg settings-msg--ok" data-testid="credit-quote-result" role="status">预计消费 {quote.estimatedPoints} 积分（{quote.totalTokens} token）{quote.estimatedProviderCost === undefined ? "" : `，供应商成本约 ${quote.estimatedProviderCost} ${quote.costCurrency ?? "USD"}`}，有效至 {new Date(quote.quoteValidUntil).toLocaleString()}</p>}
      </div>

      {message && (
        <p
          className={`settings-msg ${message.kind === "ok" ? "settings-msg--ok" : message.kind === "warn" ? "settings-msg--warn" : "settings-msg--err"}`}
          data-testid="credit-pricing-message"
          role={message.kind === "err" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </SectionShell>
  );
}

export default CreditPricingPanel;
