import {
  buildDiscordPayload,
  buildGenericPayload,
  buildMailtoUrl,
  buildPayload,
  buildSlackPayload,
  type ChannelKind,
  type NotifyChannel,
  type NotifyChannelDraft,
  type NotifyMessage,
  type NotifyResult,
} from "@openbuddy/protocol/notifications";
import type { Settings } from "../settings/settings.js";

/**
 * 通知渠道 (20261116-pii W4.6): webhook / mail / desktop dispatch moved out of the renderer.
 *
 * - Configuration lives in the settings config (`notifyChannels`), edited by 设置 · 通知渠道.
 * - Sending happens in the main process: webhooks use `fetch` (desktop may inject `net.fetch`),
 *   mail opens the user's mail client through the host shell, desktop is handled by the app's
 *   own system notifier (this service only records the switch).
 * - `observe()` turns engine events into pushes: an approval request and a background turn's
 *   completion (running → idle/failed) are delivered to every enabled channel.
 * - The renderer never sees endpoint secrets in logs; errors are truncated and never echo bodies.
 */

const KINDS: readonly ChannelKind[] = ["slack-webhook", "discord-webhook", "generic-webhook", "email", "desktop"];
const WEBHOOK_KINDS: readonly ChannelKind[] = ["slack-webhook", "discord-webhook", "generic-webhook"];
const MAX_ENDPOINT = 2048;

export interface NotificationChannelsOptions {
  /** Defaults to the runtime's global fetch; desktop injects Electron's net.fetch later. */
  fetchImpl?: typeof fetch;
  /** Native mailto opener (`shell.openExternal`). Without it the email channel reports unsupported. */
  openExternal?: (url: string) => unknown;
}

export { buildDiscordPayload, buildGenericPayload, buildMailtoUrl, buildPayload, buildSlackPayload };

/** Normalise + validate one channel draft; throws `invalid_payload: <field>`. */
export function validateChannelDraft(input: NotifyChannelDraft, existing?: NotifyChannel): NotifyChannel {
  if (!input || typeof input !== "object") throw Error("invalid_payload: channel");
  if (!KINDS.includes(input.kind)) throw Error("invalid_payload: kind");
  const label = (input.label ?? existing?.label ?? "").trim().slice(0, 80) || input.kind;
  const endpoint = (input.endpoint ?? existing?.endpoint ?? "").trim();
  if (endpoint.length > MAX_ENDPOINT) throw Error("invalid_payload: endpoint");
  if (endpoint.includes("\0")) throw Error("invalid_payload: endpoint");
  if (WEBHOOK_KINDS.includes(input.kind)) {
    if (!endpoint) throw Error("invalid_payload: endpoint");
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw Error("invalid_payload: endpoint");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw Error("invalid_payload: endpoint");
  }
  if (input.kind === "email" && !/^[^@\s]+@[^@\s]+$/.test(endpoint)) throw Error("invalid_payload: endpoint");
  return {
    id: input.id || existing?.id || "",
    label,
    kind: input.kind,
    ...(input.kind === "desktop" ? {} : { endpoint }),
    enabled: input.enabled ?? existing?.enabled ?? true,
  };
}

export class NotifyChannelsService {
  private readonly fetchImpl: typeof fetch;
  private readonly openExternal?: (url: string) => unknown;
  /** Sessions seen running, so only a real completion is pushed. */
  private readonly running = new Set<string>();

  constructor(private settings: Settings, options: NotificationChannelsOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.openExternal = options.openExternal;
  }

  list(): NotifyChannel[] {
    return [...(this.settings.config.read().notifyChannels ?? [])];
  }

  get(id: string): NotifyChannel | undefined {
    return this.list().find((channel) => channel.id === id);
  }

  save(input: NotifyChannelDraft): NotifyChannel {
    const all = this.list();
    const existing = input.id ? all.find((channel) => channel.id === input.id) : undefined;
    if (input.id && !existing) throw Error("notify_channel_not_found: 找不到这个通知渠道");
    const channel = validateChannelDraft(input, existing);
    if (!channel.id) channel.id = `ch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const index = all.findIndex((item) => item.id === channel.id);
    if (index >= 0) all[index] = channel;
    else all.push(channel);
    this.write(all);
    return channel;
  }

  remove(id: string) {
    const all = this.list();
    const next = all.filter((channel) => channel.id !== id);
    if (next.length === all.length) throw Error("notify_channel_not_found: 找不到这个通知渠道");
    this.write(next);
  }

  /** Send one test message to one channel (enabled or not). */
  async test(id: string): Promise<NotifyResult> {
    const channel = this.get(id);
    if (!channel) throw Error("notify_channel_not_found: 找不到这个通知渠道");
    return this.sendOne(channel, { title: "OpenBuddy 测试通知", body: "这条消息来自 设置 · 通知渠道 的测试按钮。", level: "info" });
  }

  /** Deliver to every enabled channel; failures are reported per channel, never thrown. */
  async dispatch(msg: NotifyMessage): Promise<NotifyResult[]> {
    const enabled = this.list().filter((channel) => channel.enabled);
    return Promise.all(enabled.map((channel) => this.sendOne(channel, msg)));
  }

  /**
   * Engine event → push. Approvals always push; a completion pushes once (running → idle/failed).
   * `task completion` covers ordinary turns, automation background sessions and sub-agents.
   */
  observe(event: string, payload: unknown): void {
    const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const sessionId = typeof data.sessionId === "string" ? data.sessionId : "";
    if (!sessionId) return;
    if (event === "agent://permission") {
      const toolKind = typeof data.toolKind === "string" ? data.toolKind : "操作";
      void this.dispatch({
        title: data.destructive ? "OpenBuddy 想删除文件，需要你确认" : "OpenBuddy 需要你的确认",
        body: `等待批准：${toolKind}`,
        level: "warn",
        sessionId,
      }).catch(() => {});
      return;
    }
    if (event !== "agent://session-status") return;
    if (data.status === "running") {
      this.running.add(sessionId);
      return;
    }
    if (!this.running.delete(sessionId)) return;
    const failed = data.status === "failed";
    void this.dispatch({
      title: failed ? "OpenBuddy 任务失败" : "OpenBuddy 任务完成",
      body: "打开 OpenBuddy 查看详情",
      level: failed ? "error" : "info",
      sessionId,
    }).catch(() => {});
  }

  private async sendOne(channel: NotifyChannel, msg: NotifyMessage): Promise<NotifyResult> {
    try {
      if (channel.kind === "desktop") {
        // The app's own notifier shows system notifications; the channel records the preference.
        return { id: channel.id, ok: true };
      }
      if (channel.kind === "email") {
        if (!this.openExternal) return { id: channel.id, ok: false, error: "email_not_supported" };
        await this.openExternal(buildMailtoUrl(channel, msg));
        return { id: channel.id, ok: true };
      }
      if (!channel.endpoint) return { id: channel.id, ok: false, error: "missing_endpoint" };
      const response = await this.fetchImpl(channel.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(channel, msg)),
        signal: AbortSignal.timeout(8000),
      });
      return { id: channel.id, ok: response.ok, ...(response.ok ? {} : { error: `http_${response.status}` }) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { id: channel.id, ok: false, error: message.slice(0, 200) };
    }
  }

  private write(channels: NotifyChannel[]) {
    const config = this.settings.config.read();
    this.settings.config.write({ ...config, notifyChannels: channels });
  }
}
