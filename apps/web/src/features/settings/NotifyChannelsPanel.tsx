import { useCallback, useEffect, useState } from "react";
import {
  notifyChannelsDelete,
  notifyChannelsList,
  notifyChannelsSave,
  notifyChannelsTest,
} from "@openbuddy/client/agent-client";
import { CHANNEL_KIND_LABELS, type ChannelKind, type NotifyChannel } from "@/features/settings/notify-channels";

/**
 * 通知渠道设置 (20261116-pii W4.6)：渠道配置存主进程 settings，发送也在主进程完成
 * （webhook 走 fetch、邮件走系统 mailto、桌面通知交给应用的系统通知器）。
 * 这里的「测试」是一次真实发送，结果按渠道返回。
 */
export function NotifyChannelsPanel({ onToast }: { onToast?: (msg: string) => void }) {
  const [channels, setChannels] = useState<NotifyChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  // 新渠道表单。
  const [newKind, setNewKind] = useState<ChannelKind>("slack-webhook");
  const [newLabel, setNewLabel] = useState("");
  const [newEndpoint, setNewEndpoint] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await notifyChannelsList();
      setChannels(Array.isArray(list) ? list : []);
    } catch {
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async () => {
    const label = newLabel.trim() || CHANNEL_KIND_LABELS[newKind];
    setSaving(true);
    try {
      await notifyChannelsSave({ label, kind: newKind, endpoint: newEndpoint.trim() || undefined, enabled: true });
      setNewLabel("");
      setNewEndpoint("");
      await refresh();
      onToast?.(`已保存通知渠道 ${label}`);
    } catch (e) {
      onToast?.(`保存失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (channel: NotifyChannel) => {
    try {
      await notifyChannelsSave({ id: channel.id, kind: channel.kind, label: channel.label, endpoint: channel.endpoint, enabled: !channel.enabled });
      await refresh();
      onToast?.(channel.enabled ? `已停用 ${channel.label}` : `已启用 ${channel.label}`);
    } catch (e) {
      onToast?.(`操作失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  };

  const test = async (channel: NotifyChannel) => {
    setTesting(channel.id);
    try {
      const result = await notifyChannelsTest(channel.id);
      onToast?.(result.ok ? `测试消息已发送到 ${channel.label}` : `发送失败：${result.error ?? "未知错误"}`);
    } catch (e) {
      onToast?.(`测试失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setTesting(null);
    }
  };

  const remove = async (channel: NotifyChannel) => {
    try {
      await notifyChannelsDelete(channel.id);
      await refresh();
      onToast?.(`已移除 ${channel.label}`);
    } catch (e) {
      onToast?.(`移除失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  };

  return (
    <div className="notify-panel" role="region" aria-label="通知渠道">
      <div className="notify-panel__head">
        <span className="notify-panel__title">通知渠道</span>
        <span className="notify-panel__hint">
          渠道由主进程发送：审批请求、后台任务完成与失败都会推送到已启用的渠道。
        </span>
      </div>

      {/* 已配置渠道 */}
      {channels.length > 0 ? (
        <ul className="notify-panel__list">
          {channels.map((ch) => (
            <li key={ch.id} className={`notify-panel__row${ch.enabled ? "" : " disabled"}`}>
              <span className="notify-panel__row-kind">{CHANNEL_KIND_LABELS[ch.kind] ?? ch.kind}</span>
              <span className="notify-panel__row-label">{ch.label}</span>
              {ch.endpoint && (
                <span className="notify-panel__row-endpoint" title={ch.endpoint}>
                  {ch.endpoint.slice(0, 40)}
                  {ch.endpoint.length > 40 ? "…" : ""}
                </span>
              )}
              <div className="notify-panel__row-actions">
                <button
                  type="button"
                  className="notify-panel__btn"
                  onClick={() => void toggle(ch)}
                  title={ch.enabled ? "停用" : "启用"}
                  aria-label={ch.enabled ? `停用 ${ch.label}` : `启用 ${ch.label}`}
                >
                  <span className={`notify-dot${ch.enabled ? " notify-dot--on" : ""}`} />
                </button>
                <button
                  type="button"
                  className="notify-panel__btn"
                  onClick={() => void test(ch)}
                  disabled={testing === ch.id}
                  title="发送一条测试消息"
                >
                  {testing === ch.id ? "发送中" : "测试"}
                </button>
                <button
                  type="button"
                  className="notify-panel__btn notify-panel__btn--danger"
                  onClick={() => void remove(ch)}
                  title="移除"
                  aria-label={`移除 ${ch.label}`}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="notify-panel__empty">{loading ? "加载中…" : "暂无通知渠道"}</div>
      )}

      {/* 添加新渠道 */}
      <div className="notify-panel__add">
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as ChannelKind)} aria-label="渠道类型">
          {Object.entries(CHANNEL_KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
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
        <button type="button" className="notify-panel__add-btn" onClick={() => void add()} disabled={saving}>
          + 添加
        </button>
      </div>
    </div>
  );
}
