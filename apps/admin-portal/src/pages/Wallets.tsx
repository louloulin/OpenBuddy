import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Plus, Wallet } from "lucide-react";
import { gatewayClient, type CreditAccount, type CreditLedgerEntry, type CreditWallet } from "../api/gateway-client";

interface Ctx {
  tenantId: string;
}

export function Wallets() {
  const { tenantId } = useOutletContext<Ctx>();
  const [wallets, setWallets] = useState<CreditWallet[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [account, setAccount] = useState<CreditAccount | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
  const [draft, setDraft] = useState({ id: "", name: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!tenantId) return;
    try {
      const r = await gatewayClient.listWallets(tenantId);
      setWallets(r.data);
      if (r.data.length > 0 && !selected) setSelected(r.data[0]!.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [tenantId, selected]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!tenantId || !selected) {
      setAccount(null);
      setLedger([]);
      return;
    }
    Promise.all([
      gatewayClient.getWalletCredits(tenantId, selected),
      gatewayClient.listWalletLedger(tenantId, selected, 20),
    ])
      .then(([a, l]) => {
        setAccount(a.data);
        setLedger(l.data);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [tenantId, selected]);

  const create = async () => {
    if (!tenantId || !draft.id.trim() || !draft.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await gatewayClient.createWallet(tenantId, {
        id: draft.id.trim(),
        name: draft.name.trim(),
        ownerSubject: "openbuddy-admin", // 简化：admin 自动成为 owner
      });
      setDraft({ id: "", name: "" });
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!tenantId) return <p style={{ color: "var(--wb-text-tertiary)" }}>请先选择租户</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ margin: 0 }}><Wallet size={20} /> 共享钱包</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}><Plus size={16} /> 新建钱包</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" placeholder="Wallet ID" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
          <input className="input" placeholder="名称" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <button className="btn btn-primary" onClick={create} disabled={busy}>创建</button>
        </div>
        {error && <p style={{ color: "var(--wb-status-error)" }}>{error}</p>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>钱包列表</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {wallets.length === 0 && <p style={{ color: "var(--wb-text-tertiary)" }}>暂无钱包</p>}
            {wallets.map((w) => (
              <button
                key={w.id}
                onClick={() => setSelected(w.id)}
                style={{
                  background: selected === w.id ? "var(--wb-bg-tertiary)" : "transparent",
                  border: "1px solid var(--wb-border-default)",
                  borderRadius: "var(--wb-radius-md)",
                  padding: 12,
                  color: "var(--wb-text-primary)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 600 }}>{w.name}</div>
                <div style={{ fontSize: 12, color: "var(--wb-text-tertiary)" }}>{w.id} · 余额 {w.balance}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          {account && selected ? (
            <>
              <h2 style={{ marginTop: 0 }}>{selected}</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <Stat label="余额" value={account.balance.toLocaleString()} />
                <Stat label="预留" value={account.reserved.toLocaleString()} />
                <Stat label="可用" value={account.available.toLocaleString()} />
                <Stat label="累计消耗" value={account.lifetimeConsumed.toLocaleString()} />
              </div>
              <h3 style={{ marginTop: 24 }}>最近流水</h3>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--wb-border-default)", textAlign: "left" }}>
                    <th style={{ padding: 8 }}>时间</th>
                    <th style={{ padding: 8 }}>类型</th>
                    <th style={{ padding: 8 }}>积分</th>
                    <th style={{ padding: 8 }}>模型</th>
                    <th style={{ padding: 8 }}>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((e) => (
                    <tr key={e.id} style={{ borderBottom: "1px solid var(--wb-border-soft)" }}>
                      <td style={{ padding: 8, fontSize: 12, color: "var(--wb-text-tertiary)" }}>
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: 8 }}>{e.type}</td>
                      <td style={{ padding: 8, color: e.amount < 0 ? "var(--wb-status-error)" : "var(--wb-status-success)" }}>
                        {e.amount > 0 ? "+" : ""}
                        {e.amount.toLocaleString()}
                      </td>
                      <td style={{ padding: 8 }}>{e.model ?? "—"}</td>
                      <td style={{ padding: 8, color: "var(--wb-text-tertiary)", fontSize: 12 }}>{e.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ledger.length === 0 && <p style={{ color: "var(--wb-text-tertiary)" }}>暂无流水</p>}
            </>
          ) : (
            <p style={{ color: "var(--wb-text-tertiary)" }}>选择左侧钱包查看详情</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--wb-bg-primary)", padding: 12, borderRadius: "var(--wb-radius-md)" }}>
      <div style={{ fontSize: 12, color: "var(--wb-text-tertiary)" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
