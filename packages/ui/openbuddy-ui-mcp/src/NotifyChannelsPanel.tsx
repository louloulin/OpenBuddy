/**
 * 通知渠道管理面板 —— IM 渠道替代的 UI。
 *
 * 列出已注册通知渠道(Slack/Discord/webhook/email/desktop),支持添加/移除/测试发送。
 */
import { useEffect, useState } from "react";
import {
  listAllNotifyChannels,
  registerNotifyChannel,
  unregisterNotifyChannel,
  dispatchNotification,
  type NotifyChannel,
  type ChannelKind,
} from "@/lib/notify/notify-channels";
import { invoke } from "@/lib/platform/electron-api";

const KIND_LABELS: Record<ChannelKind, string> = {
  "slack-webhook": "Slack",
  "discord-webhook": "Discord",
  "generic-webhook": "Webhook",
  email: "邮件",
  desktop: "桌面通知",
};

export function NotifyChannelsPanel({ onToast }: { onToast?: (msg: string) => void }) {
  const [channels, setChannels] = useState<NotifyChannel[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  // 新渠道表单。
  const [newKind, setNewKind] = useState<ChannelKind>("slack-webhook");
  const [newLabel, setNewLabel] = useState("");
  const [newEndpoint, setNewEndpoint] = useState("");

  useEffect(() => {
    setChannels(listAllNotifyChannels());
    void invoke<NotifyChannel[]>("notify-channels:list").then((stored) => {
      stored.forEach((channel) => registerNotifyChannel(channel));
      setChannels(listAllNotifyChannels());
    }).catch(() => undefined);
  }, [refreshKey]);

  const persist = (next: NotifyChannel[]) => {
    void invoke("notify-channels:save", { channels: next }).catch(() => onToast?.("通知渠道已更新，但 Electron 持久化失败"));
  };

  const add = () => {
    const id = `ch_${Date.now()}`;
    const label = newLabel.trim() || KIND_LABELS[newKind];
    registerNotifyChannel({
      id,
      label,
      kind: newKind,
      endpoint: newEndpoint.trim() || undefined,
      enabled: true,
    });
    setNewLabel("");
    setNewEndpoint("");
    setRefreshKey((k) => k + 1);
    persist([...channels.filter((channel) => channel.id !== id), { id, label, kind: newKind, endpoint: newEndpoint.trim() || undefined, enabled: true }]);
    onToast?.(`已添加渠道 ${label}`);
  };

  const remove = (id: string) => {
    unregisterNotifyChannel(id);
    setRefreshKey((k) => k + 1);
    persist(channels.filter((channel) => channel.id !== id));
    onToast?.("已移除渠道");
  };

  const toggle = (id: string) => {
    // 注销再重新注册(toggle enabled)。
    const ch = channels.find((c) => c.id === id);
    if (!ch) return;
    unregisterNotifyChannel(id);
    registerNotifyChannel({ ...ch, enabled: !ch.enabled });
    setRefreshKey((k) => k + 1);
    persist(channels.map((channel) => channel.id === id ? { ...channel, enabled: !channel.enabled } : channel));
  };

  const testSend = async (id: string) => {
    const res = await dispatchNotification({ title: "测试通知", body: "来自 OpenBuddy 的测试消息", level: "info" });
    const hit = res.find((r) => r.id === id);
    onToast?.(hit?.ok ? "测试通知已发送" : "发送失败(检查 endpoint)");
  };

  return (
    <div className="notify-panel" role="region" aria-label="通知渠道">
      <div className="notify-panel__head">
        <span className="notify-panel__title">通知渠道</span>
        <span className="notify-panel__hint">推送 agent 通知到外部渠道(Slack/Discord/Webhook/邮件/桌面)</span>
      </div>

      {/* 已注册渠道列表 */}
      {channels.length > 0 ? (
        <ul className="notify-panel__list">
          {channels.map((ch) => (
            <li key={ch.id} className={"notify-panel__row" + (ch.enabled ? "" : " disabled")}>
              <span className="notify-panel__row-kind">{KIND_LABELS[ch.kind]}</span>
              <span className="notify-panel__row-label">{ch.label}</span>
              {ch.endpoint && <span className="notify-panel__row-endpoint" title={ch.endpoint}>{ch.endpoint.slice(0, 40)}{ch.endpoint.length > 40 ? "…" : ""}</span>}
              <div className="notify-panel__row-actions">
                <button type="button" className="notify-panel__btn" onClick={() => toggle(ch.id)} title={ch.enabled ? "禁用" : "启用"}>
                  <span className={ch.enabled ? "notify-dot notify-dot--on" : "notify-dot"} />
                </button>
                <button type="button" className="notify-panel__btn" onClick={() => void testSend(ch.id)} disabled={!ch.enabled} title="测试发送">
                  测试
                </button>
                <button type="button" className="notify-panel__btn notify-panel__btn--danger" onClick={() => remove(ch.id)} title="移除">
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="notify-panel__empty">暂无通知渠道</div>
      )}

      {/* 添加新渠道 */}
      <div className="notify-panel__add">
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as ChannelKind)}>
          {Object.entries(KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="显示名(可选)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
        />
        <input
          type="text"
          placeholder={newKind === "email" ? "邮箱地址" : newKind === "desktop" ? "(桌面通知无需 endpoint)" : "Webhook URL"}
          value={newEndpoint}
          onChange={(e) => setNewEndpoint(e.target.value)}
          disabled={newKind === "desktop"}
        />
        <button type="button" className="notify-panel__add-btn" onClick={add}>
          + 添加
        </button>
      </div>
    </div>
  );
}
