import { useEffect, useState } from "react";
import { agentCompact, settingsAgentSet } from "@openbuddy/client/agent-client";
import type { SessionCost } from "@openbuddy/protocol/agent-settings";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import "./context-usage-actions.css";

/**
 * Bottom of the context popover (20261116-pii W1.5): this session's cost from Pi's own accounting
 * (only when the model has price data), 立即压缩 (`agent_compact`) and the automatic-compaction
 * switch (`settings_agent_set`, applies to every open task at once).
 */

/** USD with enough digits to see small amounts: $0.0063, $1.27. */
export function formatCost(total: number): string {
  if (total <= 0) return "$0.00";
  if (total < 0.01) return `$${total.toFixed(4)}`;
  if (total < 1) return `$${total.toFixed(3)}`;
  return `$${total.toFixed(2)}`;
}
const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

export function ContextUsageActions({ sessionId, cost, autoCompaction, onChanged }: {
  sessionId: string;
  cost?: SessionCost;
  /** Undefined while unknown (older host): the switch is hidden. */
  autoCompaction?: boolean;
  onChanged: () => void;
}) {
  const [compacting, setCompacting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [auto, setAuto] = useState<boolean | undefined>(undefined);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const autoOn = auto ?? autoCompaction;
  // A fresh reading from the host replaces the optimistic value.
  useEffect(() => setAuto(undefined), [autoCompaction]);

  const compact = async () => {
    setCompacting(true);
    setMessage(null);
    try {
      const result = await agentCompact(sessionId);
      setMessage({ kind: "ok", text: result.tokensAfter !== undefined ? `已压缩：${tokens(result.tokensBefore)} → ${tokens(result.tokensAfter)}` : "已压缩" });
      onChanged();
    } catch (error) {
      const nothing = /Already compacted|Nothing to compact|too short/i.test(String(error instanceof Error ? error.message : error));
      setMessage({ kind: nothing ? "ok" : "error", text: compactError(error) });
    } finally {
      setCompacting(false);
    }
  };
  const toggle = async (enabled: boolean) => {
    setToggling(true);
    setAuto(enabled);
    setMessage(null);
    try {
      const saved = await settingsAgentSet({ autoCompaction: { enabled } });
      setAuto(saved.autoCompaction.enabled);
      onChanged();
    } catch (error) {
      setAuto(!enabled);
      setMessage({ kind: "error", text: `设置失败：${friendlyError(error)}` });
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="context-usage__actions">
      {cost?.priced && (
        <div className="context-usage__footer context-usage__cost">
          <span>本会话费用</span>
          <span className="context-usage__footer-value" title="按模型价格估算，含已被压缩的历史">{formatCost(cost.total)}</span>
        </div>
      )}
      {autoOn !== undefined && (
        <div className="context-usage__footer context-usage__auto">
          <span className="context-usage__auto-label">
            自动压缩
            <span className="context-usage__auto-hint">快满时自动总结较早的对话</span>
          </span>
          <label className="ob-switch">
            <input type="checkbox" role="switch" aria-label="自动压缩" checked={autoOn} disabled={toggling} onChange={(e) => void toggle(e.target.checked)} />
            <span className="ob-switch__track" aria-hidden="true"><span className="ob-switch__thumb" /></span>
          </label>
        </div>
      )}
      <button type="button" className="context-usage__compact" onClick={() => void compact()} disabled={compacting}>
        {compacting ? "压缩中…" : "立即压缩"}
      </button>
      {message && (
        <p className={"context-usage__message" + (message.kind === "error" ? " context-usage__message--error" : "")} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </div>
  );
}

/** Pi's "nothing to compact" family reads better as a plain sentence. */
function compactError(error: unknown): string {
  const raw = String(error instanceof Error ? error.message : error);
  if (/Already compacted|Nothing to compact|too short/i.test(raw)) return "暂时没有可压缩的内容，对话再长一些后再试";
  if (/忙碌|busy/i.test(raw)) return "任务正在运行，结束后再压缩";
  return `压缩失败：${friendlyError(error)}`;
}
