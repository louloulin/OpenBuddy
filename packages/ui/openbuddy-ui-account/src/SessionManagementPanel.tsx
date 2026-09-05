/**
 * OpenBuddy 会话管理面板。
 *
 * 集中查看当前租户下活跃的桌面 / Web / Automation / Team 会话，
 * 支持单条注销（撤销绑定）与一键清空。注销会立即让 Gateway 在
 * `assertSessionNotRevoked` 中拒绝该 sessionId 的进一步调用。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Laptop, RefreshCw, Trash2, Users } from "lucide-react";
import {
  casdoorListSessions,
  casdoorUnregisterSession,
  casdoorStatus,
} from "@/lib/casdoor/casdoor-client";
import type { CasdoorSessionBinding, CasdoorSessionKind } from "@/lib/casdoor/casdoor-client";

function SectionShell({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <h2 className="settings-section__title">{title}</h2>
      {desc && <p className="settings-section__desc">{desc}</p>}
      <div className="settings-section__body">{children}</div>
    </div>
  );
}

const KIND_LABEL: Record<CasdoorSessionKind, string> = {
  desktop: "桌面",
  web: "Web",
  automation: "自动化",
  team: "团队",
  session: "会话",
};

function describeError(error: unknown): string {
  if (!error) return "操作失败";
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, "");
  return String(error).replace(/^Error:\s*/, "");
}

export function SessionManagementPanel() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CasdoorSessionBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const session = await casdoorStatus().catch(() => null);
      setTenantId(session?.tenantContext.activeTenantId ?? null);
      const list = await casdoorListSessions(100).catch((error) => {
        setMessage({ kind: "warn", text: `加载会话失败：${describeError(error)}` });
        return [] as CasdoorSessionBinding[];
      });
      setSessions(list.filter((entry) => !entry.endedAt));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const byKind = useMemo(() => {
    const map = new Map<CasdoorSessionKind, number>();
    for (const session of sessions) {
      map.set(session.kind, (map.get(session.kind) ?? 0) + 1);
    }
    return map;
  }, [sessions]);

  const handleUnregister = useCallback(async (sessionId: string) => {
    if (!confirm(`确认注销会话 ${sessionId}？该会话的所有后续请求会被拒绝。`)) return;
    setBusyId(sessionId);
    try {
      await casdoorUnregisterSession(sessionId);
      await reload();
      setMessage({ kind: "ok", text: `已注销 ${sessionId}` });
    } catch (error) {
      setMessage({ kind: "err", text: describeError(error) });
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  const handleUnregisterAll = useCallback(async () => {
    if (sessions.length === 0) return;
    if (!confirm(`确认注销全部 ${sessions.length} 个活跃会话？`)) return;
    setBusyId("__all__");
    try {
      const results = await Promise.allSettled(sessions.map((session) => casdoorUnregisterSession(session.sessionId)));
      const failed = results.filter((result) => result.status === "rejected").length;
      await reload();
      setMessage({
        kind: failed === 0 ? "ok" : "warn",
        text: failed === 0 ? `已注销 ${sessions.length} 个会话` : `${sessions.length - failed} 成功，${failed} 失败`,
      });
    } finally {
      setBusyId(null);
    }
  }, [sessions, reload]);

  return (
    <SectionShell
      title="会话管理"
      desc="查看当前租户下活跃的桌面/Web/自动化/团队会话，并可逐条或批量注销。注销会立即让 Gateway 在后续请求中拒绝该 sessionId。"
    >
      {!tenantId ? (
        <p className="settings-hint">请先登录并选择租户，再查看会话列表。</p>
      ) : (
        <p className="settings-hint">
          当前租户：<strong>{tenantId}</strong> · 共 {sessions.length} 个活跃会话
          {Array.from(byKind.entries()).map(([kind, count]) => ` · ${KIND_LABEL[kind]}=${count}`).join("")}
        </p>
      )}

      <div className="account-section" data-testid="session-management-section">
        <div className="account-section__header">
          <h3 className="account-section__title">
            <Users size={16} /> 活跃会话
          </h3>
          <div className="account-section__actions">
            <button className="settings-btn" onClick={reload} disabled={loading}>
              <RefreshCw size={14} /> 刷新
            </button>
            <button
              className="settings-btn settings-btn--ghost"
              onClick={handleUnregisterAll}
              disabled={sessions.length === 0 || busyId !== null}
              data-testid="session-management-unregister-all"
            >
              <Trash2 size={14} /> 批量注销
            </button>
          </div>
        </div>
        {loading && sessions.length === 0 ? (
          <p className="settings-hint">正在加载会话…</p>
        ) : sessions.length === 0 ? (
          <p className="settings-hint">当前没有活跃会话。</p>
        ) : (
          <ul className="shortcuts-list" data-testid="session-management-list">
            {sessions.map((session) => (
              <li key={session.sessionId} className="shortcuts-list__row" data-testid={`session-row-${session.sessionId}`}>
                <div className="shortcuts-list__row-meta">
                  <span className="shortcuts-list__action">
                    <Laptop size={12} /> {KIND_LABEL[session.kind]} · {session.subject}
                  </span>
                  <span className="shortcuts-list__key">
                    sessionId：{session.sessionId}
                    {session.deviceFingerprint ? ` · 设备指纹：${session.deviceFingerprint}` : ""}
                  </span>
                  <span className="shortcuts-list__key">
                    范围：{session.scopes.length > 0 ? session.scopes.join(", ") : "—"}
                  </span>
                  <span className="shortcuts-list__key">
                    开始 {new Date(session.startedAt).toLocaleString()} · 最近活跃 {new Date(session.lastSeenAt).toLocaleString()}
                  </span>
                </div>
                <button
                  className="settings-btn settings-btn--ghost"
                  data-testid={`session-unregister-${session.sessionId}`}
                  onClick={() => handleUnregister(session.sessionId)}
                  disabled={busyId === session.sessionId || busyId === "__all__"}
                >
                  <Trash2 size={14} /> 注销
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {message && (
        <p
          className={`settings-msg ${message.kind === "ok" ? "settings-msg--ok" : message.kind === "warn" ? "settings-msg--warn" : "settings-msg--err"}`}
          data-testid="session-management-message"
          role={message.kind === "err" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </SectionShell>
  );
}

export default SessionManagementPanel;
