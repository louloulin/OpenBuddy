import { useState } from "react";
import { agentSessionTools } from "@openbuddy/client/agent-client";
import { friendlyError } from "@openbuddy/chat-core/error-format";

/**
 * 会话工具健康检查 (20261126-upup UP-1.4)。
 *
 * 装完应用后，用真实读数核对本会话注册了哪些工具：数量与预期不符时，先看总开关、
 * 目录信任与包记录。抽成独立组件，免得扩展面板继续长大。
 */
export function SessionToolHealthCard({ sessionId }: { sessionId?: string }) {
  const [health, setHealth] = useState<{ total: number; app: number; sample: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const check = async () => {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    try {
      const tools = await agentSessionTools(sessionId);
      setHealth({
        total: tools.length,
        app: tools.filter((name) => /^(get_|search_|financial_|technical_|risk_|calc|invest|screen)/i.test(name)).length,
        sample: tools.slice(0, 12),
      });
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="res-panel__card" aria-label="会话工具健康检查">
      <h3 className="res-panel__card-title">会话工具健康检查</h3>
      <p className="res-panel__muted">装完应用后看看本会话实际注册了哪些工具——数量与预期不符时，先确认总开关、目录信任与包记录。</p>
      {error && <p className="res-panel__error" role="alert">{error}</p>}
      <div className="ext-install">
        <button type="button" className="res-panel__btn" disabled={busy || !sessionId} onClick={() => void check()}>
          {busy ? "检查中…" : "检查本会话工具"}
        </button>
        {!sessionId && <span className="res-panel__muted">先打开一个任务，再回来检查它的工具。</span>}
      </div>
      {health && (
        <p className="res-panel__muted" role="status">
          共 <strong>{health.total}</strong> 个工具，其中应用/行情类 <strong>{health.app}</strong> 个
          {health.sample.length > 0 ? `（示例：${health.sample.slice(0, 6).join("、")}）` : ""}
        </p>
      )}
    </div>
  );
}
