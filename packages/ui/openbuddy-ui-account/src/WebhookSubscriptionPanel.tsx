/**
 * OpenBuddy Webhook 订阅面板。
 *
 * 列出当前租户已订阅的 Casdoor webhook 事件类型（用户/组织/角色/权限变更等），
 * 支持多选切换并保存到 Gateway。Webhooks 用于把 Casdoor 中的身份与权限变化
 * 实时广播到企业 SIEM、Slack、企业微信机器人或 OpenBuddy 自身的回调处理。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { SquareCheck, RefreshCw, Save, Webhook } from "lucide-react";
import {
  casdoorListWebhookSubscriptions,
  casdoorUpdateWebhookSubscriptions,
  casdoorStatus,
  CASDOOR_WEBHOOK_EVENT_TYPES,
} from "@/lib/casdoor/casdoor-client";
import type { CasdoorWebhookEventType } from "@/lib/casdoor/casdoor-client";

function SectionShell({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <h2 className="settings-section__title">{title}</h2>
      {desc && <p className="settings-section__desc">{desc}</p>}
      <div className="settings-section__body">{children}</div>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  "user.add": "新增用户",
  "user.update": "更新用户",
  "user.delete": "删除用户",
  "user.add-user": "加入用户到角色",
  "user.remove-user": "从角色移除用户",
  "organization.update": "更新组织",
  "organization.delete": "删除组织",
  "group.update": "更新组",
  "group.delete": "删除组",
  "group.add-user": "加入用户到组",
  "group.remove-user": "从组移除用户",
  "role.update": "更新角色",
  "role.delete": "删除角色",
  "permission.update": "更新权限",
  "permission.delete": "删除权限",
};

function describeError(error: unknown): string {
  if (!error) return "操作失败";
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, "");
  return String(error).replace(/^Error:\s*/, "");
}

export function WebhookSubscriptionPanel() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<CasdoorWebhookEventType>>(new Set());
  const [source, setSource] = useState<"default-all" | "explicit">("default-all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const session = await casdoorStatus().catch(() => null);
      const active = session?.tenantContext.activeTenantId ?? null;
      setTenantId(active);
      if (!active) {
        setSelected(new Set());
        return;
      }
      const snap = await casdoorListWebhookSubscriptions(active).catch((error) => {
        setMessage({ kind: "warn", text: `加载订阅失败：${describeError(error)}` });
        return null;
      });
      if (snap) {
        setSource(snap.source);
        setSelected(new Set(snap.eventTypes));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const allChecked = useMemo(() => CASDOOR_WEBHOOK_EVENT_TYPES.every((t) => selected.has(t)), [selected]);
  const noneChecked = useMemo(() => CASDOOR_WEBHOOK_EVENT_TYPES.every((t) => !selected.has(t)), [selected]);

  const toggle = useCallback((type: CasdoorWebhookEventType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === CASDOOR_WEBHOOK_EVENT_TYPES.length) return new Set();
      return new Set(CASDOOR_WEBHOOK_EVENT_TYPES);
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      const snap = await casdoorUpdateWebhookSubscriptions({
        tenantId,
        eventTypes: CASDOOR_WEBHOOK_EVENT_TYPES.filter((t) => selected.has(t)),
      });
      setSource(snap.source);
      setSelected(new Set(snap.eventTypes));
      setMessage({ kind: "ok", text: `已保存 ${snap.eventTypes.length} 个事件订阅（${snap.source === "default-all" ? "默认全集" : "显式列表"}）` });
    } catch (error) {
      setMessage({ kind: "err", text: describeError(error) });
    } finally {
      setSaving(false);
    }
  }, [tenantId, selected]);

  return (
    <SectionShell
      title="Webhook 订阅"
      desc="为当前租户选择希望 Gateway 接收的 Casdoor 事件类型。OpenBuddy 收到事件后会写入 SIEM（syslog / webhook / CSV）并刷新前端授权决策；事件可通过 casdoor:webhook-deliver 手动投递或经 Gateway 自动转发。"
    >
      {!tenantId ? (
        <p className="settings-hint">请先登录并选择租户，再管理 Webhook 订阅。</p>
      ) : (
        <p className="settings-hint">当前租户：<strong>{tenantId}</strong> · 当前源：<strong>{source === "default-all" ? "默认全集" : "显式列表"}</strong></p>
      )}

      <div className="account-section" data-testid="webhook-subscription-section">
        <div className="account-section__header">
          <h3 className="account-section__title">
            <Webhook size={16} /> 事件类型
          </h3>
          <div className="account-section__actions">
            <button className="settings-btn" onClick={toggleAll} disabled={loading || !tenantId}>
              <SquareCheck size={14} /> {allChecked ? "全部取消" : "全部选择"}
            </button>
            <button className="settings-btn" onClick={reload} disabled={loading}>
              <RefreshCw size={14} /> 刷新
            </button>
            <button className="settings-btn" onClick={handleSave} disabled={saving || !tenantId || noneChecked}>
              <Save size={14} /> 保存
            </button>
          </div>
        </div>
        {loading ? (
          <p className="settings-hint">正在加载订阅列表…</p>
        ) : (
          <ul className="shortcuts-list" data-testid="webhook-subscription-list">
            {CASDOOR_WEBHOOK_EVENT_TYPES.map((type) => {
              const checked = selected.has(type);
              return (
                <li key={type} className="shortcuts-list__row">
                  <label className="shortcuts-list__row-meta" htmlFor={`webhook-event-${type}`}>
                    <span className="shortcuts-list__action">
                      <input
                        id={`webhook-event-${type}`}
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(type)}
                        data-testid={`webhook-subscription-toggle-${type}`}
                      /> {EVENT_LABEL[type] ?? type}
                    </span>
                    <span className="shortcuts-list__key">{type}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {message && (
        <p
          className={`settings-msg ${message.kind === "ok" ? "settings-msg--ok" : message.kind === "warn" ? "settings-msg--warn" : "settings-msg--err"}`}
          data-testid="webhook-subscription-message"
          role={message.kind === "err" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </SectionShell>
  );
}

export default WebhookSubscriptionPanel;
