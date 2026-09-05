import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Wallet } from "lucide-react";
import { casdoorGetSelectedCreditWalletCredits, casdoorGetSelectedCreditWalletId, casdoorListSelectedCreditWalletLedger, casdoorListCreditWallets, casdoorSelectCreditWallet, casdoorStatus } from "@/lib/casdoor/casdoor-client";
import type { CasdoorCreditAccount, CasdoorCreditLedgerEntry, CasdoorCreditWallet } from "@openbuddy/auth-casdoor";

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, "");
  return String(error || "操作失败").replace(/^Error:\s*/, "");
}

export function CreditWalletPanel() {
  const [wallets, setWallets] = useState<CasdoorCreditWallet[]>([]);
  const [account, setAccount] = useState<CasdoorCreditAccount | null>(null);
  const [ledger, setLedger] = useState<CasdoorCreditLedgerEntry[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | undefined>();
  const [tenantId, setTenantId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const spendableWallets = (nextWallets: CasdoorCreditWallet[], subject: string | undefined, isAdmin: boolean, isTenantAdmin: boolean) => nextWallets.filter((wallet) => wallet.status === "active" && (isAdmin || isTenantAdmin || Boolean(subject && wallet.members?.some((member) => member.subject === subject && (member.role === "owner" || member.role === "spender")))));

  const reload = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const status = await casdoorStatus().catch(() => null);
      setTenantId(status?.tenantContext.activeTenantId);
      if (!status?.tenantContext.activeTenantId) {
        setWallets([]);
        setSelectedWalletId(undefined);
        return;
      }
      const [nextWallets, selected, nextAccount, nextLedger] = await Promise.all([casdoorListCreditWallets(), casdoorGetSelectedCreditWalletId(), casdoorGetSelectedCreditWalletCredits(), casdoorListSelectedCreditWalletLedger(8)]);
      const subject = status?.identity?.subject;
      const availableWallets = spendableWallets(nextWallets, subject, Boolean(status?.identity?.isAdmin), Boolean(status?.tenantContext.membership?.isTenantAdmin));
      setWallets(availableWallets);
      setSelectedWalletId(selected && availableWallets.some((wallet) => wallet.id === selected) ? selected : undefined);
      setAccount(nextAccount);
      setLedger(nextLedger);
    } catch (error) {
      setMessage({ kind: "err", text: `加载共享钱包失败：${describeError(error)}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const select = async (walletId: string) => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await casdoorSelectCreditWallet(walletId || undefined);
      const status = await casdoorStatus().catch(() => null);
      setWallets(spendableWallets(result.wallets, status?.identity?.subject, Boolean(status?.identity?.isAdmin), Boolean(status?.tenantContext.membership?.isTenantAdmin)));
      setSelectedWalletId(result.selectedWalletId);
      const [nextAccount, nextLedger] = await Promise.all([casdoorGetSelectedCreditWalletCredits(), casdoorListSelectedCreditWalletLedger(8)]);
      setAccount(nextAccount);
      setLedger(nextLedger);
      setMessage({ kind: "ok", text: result.selectedWalletId ? "后续企业 Agent 请求将使用该共享钱包扣费。" : "已切换为个人积分账户。" });
    } catch (error) {
      setMessage({ kind: "err", text: `切换共享钱包失败：${describeError(error)}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section" data-testid="credit-wallet-panel">
      <h2 className="settings-section__title"><Wallet size={16} /> 扣费账户</h2>
      <p className="settings-section__desc">选择企业 Agent 工作台的积分扣费账户。共享钱包权限由 Gateway 校验，个人调用不会混入共享钱包账本。</p>
      <div className="settings-section__body">
        {!tenantId ? <p className="settings-hint">请先登录并选择企业租户。</p> : (
          <>
            <p className="settings-hint">当前租户：<strong>{tenantId}</strong></p>
            <div className="settings-actions">
              <label className="settings-field"><span className="settings-field__label">AI 扣费账户</span>
                <select className="settings-input" value={selectedWalletId ?? ""} onChange={(event) => void select(event.target.value)} disabled={loading || saving} data-testid="credit-wallet-select">
                  <option value="">个人积分账户</option>
                  {wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}（{wallet.id}）</option>)}
                </select>
              </label>
              <button className="settings-btn" onClick={() => void reload()} disabled={loading || saving}><RefreshCw size={14} /> {loading ? "加载中…" : "刷新"}</button>
            </div>
            {account && <div className="settings-stats" data-testid="credit-wallet-account">
              <div><span className="settings-hint">账户余额</span><strong>{account.balance.toLocaleString()} 积分</strong></div>
              <div><span className="settings-hint">预留中</span><strong>{account.reserved.toLocaleString()} 积分</strong></div>
              <div><span className="settings-hint">可用余额</span><strong>{account.available.toLocaleString()} 积分</strong></div>
              <div><span className="settings-hint">累计消耗</span><strong>{account.lifetimeConsumed.toLocaleString()} 积分</strong></div>
            </div>}
            {ledger.length > 0 && <div className="settings-ledger" data-testid="credit-wallet-ledger">
              <span className="settings-field__label">最近流水</span>
              {ledger.map((entry) => <div className="settings-ledger__row" key={entry.id}><span>{ledgerTypeLabel(entry.type)}{entry.model ? ` · ${entry.model}` : ""}</span><strong>{entry.type === "consume" || entry.type === "reservation" ? "-" : "+"}{entry.amount.toLocaleString()}</strong></div>)}
            </div>}
            {wallets.length === 0 && <p className="settings-hint">当前账户没有可用共享钱包；可由租户管理员在 Gateway 创建并加入成员。</p>}
          </>
        )}
        {message && <p className={`settings-msg settings-msg--${message.kind === "ok" ? "ok" : message.kind === "warn" ? "warn" : "err"}`} role={message.kind === "err" ? "alert" : "status"} data-testid="credit-wallet-message">{message.text}</p>}
      </div>
    </div>
  );
}

function ledgerTypeLabel(type: CasdoorCreditLedgerEntry["type"]): string {
  return ({ grant: "赠送", purchase: "充值", consume: "消费", refund: "退款", expire: "过期", adjustment: "调整", reservation: "预留", release: "释放" })[type];
}

export default CreditWalletPanel;
