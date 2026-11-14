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
  type NotifyChannel,
  type ChannelKind,
} from "@/features/settings/notify-channels";

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
  }, [refreshKey]);

  const add = () => {
    const id = `ch_${Date.now()}`;
    const label = newLabel.trim() || KIND_LABELS[newKind];
    registerNotifyChannel({
      id,
      label,
      kind: newKind,
      endpoint: newEndpoint.trim() || undefined,
      enabled: false,
    });
    setNewLabel("");
    setNewEndpoint("");
    setRefreshKey((k) => k + 1);
    onToast?.(`已保存本地渠道草稿 ${label}，尚未接入发送`);
  };

  const remove = (id: string) => {
    unregisterNotifyChannel(id);
    setRefreshKey((k) => k + 1);
    onToast?.("已移除渠道");
  };

  return (
    <div className="notify-panel" role="region" aria-label="通知渠道">
      <div className="notify-panel__head">
        <span className="notify-panel__title">通知渠道</span>
        <span className="notify-panel__hint">渠道配置尚未接入主进程，当前仅可管理本地草稿；外部发送与测试暂不可用。</span>
      </div>

      {/* 已注册渠道列表 */}
      {channels.length > 0 ? (
        <ul className="notify-panel__list">
          {channels.map((ch) => (
            <li key={ch.id} className="notify-panel__row disabled">
              <span className="notify-panel__row-kind">{KIND_LABELS[ch.kind]}</span>
              <span className="notify-panel__row-label">{ch.label}</span>
              {ch.endpoint && <span className="notify-panel__row-endpoint" title={ch.endpoint}>{ch.endpoint.slice(0, 40)}{ch.endpoint.length > 40 ? "…" : ""}</span>}
              <div className="notify-panel__row-actions">
                <span>未接入发送</span>
                <button type="button" className="notify-panel__btn" disabled title="渠道尚未接入主进程，不能启用发送">
                  <span className="notify-dot" />
                </button>
                <button type="button" className="notify-panel__btn" disabled title="发送测试尚未接入主进程">
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
