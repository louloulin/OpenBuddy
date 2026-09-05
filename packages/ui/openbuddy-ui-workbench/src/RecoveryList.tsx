import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import {
  harnessRecoveryClaim,
  harnessRecoveryList,
  harnessRecoveryResolve,
  harnessRecoveryStatus,
  type HarnessRecoveryClaim,
  type HarnessRecoveryIntent,
} from "@/lib/agent/pi-client";

interface RecoveryListProps {
  onToast?: (message: string) => void;
}

interface ClaimState {
  claim: HarnessRecoveryClaim;
  busy: "committed" | "aborted" | null;
}

export function RecoveryList({ onToast }: RecoveryListProps) {
  const [status, setStatus] = useState<{ pending: number; uncertain: number; byMethod: Record<string, number> }>({ pending: 0, uncertain: 0, byMethod: {} });
  const [intents, setIntents] = useState<readonly HarnessRecoveryIntent[]>([]);
  const [claims, setClaims] = useState<Record<string, ClaimState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [snapshot, listed] = await Promise.all([harnessRecoveryStatus(), harnessRecoveryList()]);
      setStatus({ pending: snapshot.pending, uncertain: snapshot.uncertain, byMethod: snapshot.byMethod });
      setIntents(listed.intents);
    } catch (cause) {
      setError(`恢复队列读取失败：${String(cause).replace(/^Error:\s*/u, "")}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleClaim = useCallback(async (rpcId: string) => {
    setError(null);
    try {
      const claim = await harnessRecoveryClaim(rpcId, "openbuddy-ui");
      setClaims((prev) => ({ ...prev, [rpcId]: { claim, busy: null } }));
      onToast?.(`已对 ${claim.method} 抢占恢复签名（30 分钟有效）`);
    } catch (cause) {
      setError(`抢占失败：${String(cause).replace(/^Error:\s*/u, "")}`);
    }
  }, [onToast]);

  const handleResolve = useCallback(async (rpcId: string, action: "committed" | "aborted") => {
    const claim = claims[rpcId];
    if (!claim) return;
    setClaims((prev) => ({ ...prev, [rpcId]: { ...prev[rpcId], busy: action } }));
    try {
      await harnessRecoveryResolve(rpcId, claim.claim.token, action);
      setClaims((prev) => {
        const next = { ...prev };
        delete next[rpcId];
        return next;
      });
      onToast?.(`${action === "committed" ? "已确认" : "已终止"}：${rpcId}`);
      await refresh();
    } catch (cause) {
      setClaims((prev) => ({ ...prev, [rpcId]: { ...prev[rpcId], busy: null } }));
      setError(`${action === "committed" ? "确认" : "终止"}失败：${String(cause).replace(/^Error:\s*/u, "")}`);
    }
  }, [claims, onToast, refresh]);

  if (loading) {
    return (
      <div className="recovery-list">
        <div className="recovery-list__header">
          <ShieldCheck size={20} />
          <h3>副作用恢复</h3>
        </div>
        <div className="recovery-list__loading"><Loader2 size={14} /> 正在读取持久化意图…</div>
      </div>
    );
  }

  const uncertain = intents.filter((intent) => intent.status === "uncertain");

  return (
    <div className="recovery-list">
      <div className="recovery-list__header">
        <ShieldCheck size={20} />
        <div>
          <h3>副作用恢复</h3>
          <p>{status.pending} 个 pending、{status.uncertain} 个 uncertain。重启后必须显式 committed/aborted，绝不静默重跑。</p>
        </div>
      </div>
      {error ? <div className="recovery-list__error">{error}</div> : null}
      {uncertain.length === 0 ? (
        <div className="recovery-list__empty">
          <ShieldAlert size={16} />
          当前没有未决副作用，host 全部 receipt 已落地。
        </div>
      ) : (
        <ul className="recovery-list__items">
          {uncertain.map((intent) => {
            const claim = claims[intent.rpcId];
            return (
              <li key={intent.rpcId} className="recovery-list__item">
                <div className="recovery-list__meta">
                  <code className="recovery-list__rpcid">{intent.rpcId}</code>
                  <span className="recovery-list__method">{intent.method}</span>
                  <span className="recovery-list__status">{intent.status}</span>
                </div>
                <div className="recovery-list__detail">
                  <span>创建于 {new Date(intent.createdAt).toLocaleString()}</span>
                  <span>到期 {new Date(intent.expiresAt).toLocaleString()}</span>
                  {intent.claimedBy ? <span>已被 {intent.claimedBy} 抢占</span> : null}
                </div>
                <div className="recovery-list__actions">
                  {!claim ? (
                    <button type="button" onClick={() => void handleClaim(intent.rpcId)}>抢占签名</button>
                  ) : (
                    <>
                      <button type="button" onClick={() => void handleResolve(intent.rpcId, "committed")} disabled={claim.busy !== null}>
                        {claim.busy === "committed" ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />} committed
                      </button>
                      <button type="button" onClick={() => void handleResolve(intent.rpcId, "aborted")} disabled={claim.busy !== null} className="danger">
                        {claim.busy === "aborted" ? <Loader2 size={14} className="spin" /> : <XCircle size={14} />} aborted
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
