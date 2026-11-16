// 通知渠道 (pii W4.6): DTO shared by the host channel service, the settings config and the UI.

export type NotifyLevel = "info" | "warn" | "error";

/** One notification message handed to the configured channels. */
export interface NotifyMessage {
  title: string;
  body?: string;
  level?: NotifyLevel;
  /** The session this message is about (generic webhook payload + in-app linkage). */
  sessionId?: string;
}

export type ChannelKind =
  | "slack-webhook"
  | "discord-webhook"
  | "generic-webhook"
  | "email"
  | "desktop";

/** A configured channel (persisted in the settings config, sent from the host). */
export interface NotifyChannel {
  id: string;
  label: string;
  kind: ChannelKind;
  /** Webhook URL or mailto address; unused by the desktop kind. */
  endpoint?: string;
  enabled: boolean;
}

/** Per-channel send result. */
export interface NotifyResult {
  id: string;
  ok: boolean;
  error?: string;
}

/** Create/update payload: id present = update; absent = create. */
export interface NotifyChannelDraft {
  id?: string;
  label?: string;
  kind: ChannelKind;
  endpoint?: string;
  enabled?: boolean;
}

// ---------- 载荷构造（纯函数；渲染层与主进程共用同一份） ----------

export interface SlackPayload {
  text: string;
  blocks?: Array<{ type: string; text: { type: string; text: string } }>;
}

export interface DiscordPayload {
  content: string;
  embeds?: Array<{ title: string; description?: string; color: number }>;
}

/** Slack webhook 载荷。 */
export function buildSlackPayload(msg: NotifyMessage): SlackPayload {
  const mark = msg.level === "error" ? "🔴" : msg.level === "warn" ? "🟡" : "🔵";
  return {
    text: `${mark} ${msg.title}`,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: `*${mark} ${msg.title}*${msg.body ? `\n${msg.body}` : ""}` } }],
  };
}

/** Discord webhook 载荷。 */
export function buildDiscordPayload(msg: NotifyMessage): DiscordPayload {
  const color = msg.level === "error" ? 0xdc2626 : msg.level === "warn" ? 0xd97706 : 0x0ea5e9;
  return { content: msg.title, embeds: [{ title: msg.title, description: msg.body, color }] };
}

/** 通用 webhook（JSON POST {title, body, level, sessionId, ts}）。 */
export function buildGenericPayload(msg: NotifyMessage): Record<string, unknown> {
  return { title: msg.title, body: msg.body ?? "", level: msg.level ?? "info", sessionId: msg.sessionId, ts: Date.now() };
}

/** 邮件：mailto URL（subject + body）。 */
export function buildMailtoUrl(channel: NotifyChannel, msg: NotifyMessage): string {
  const params = new URLSearchParams();
  params.set("subject", msg.title);
  if (msg.body) params.set("body", msg.body);
  return `mailto:${channel.endpoint ?? ""}?${params.toString()}`;
}

/** 按 kind 选择载荷构造器。 */
export function buildPayload(channel: NotifyChannel, msg: NotifyMessage): unknown {
  switch (channel.kind) {
    case "slack-webhook":
      return buildSlackPayload(msg);
    case "discord-webhook":
      return buildDiscordPayload(msg);
    case "email":
      return buildMailtoUrl(channel, msg);
    case "desktop":
    case "generic-webhook":
    default:
      return buildGenericPayload(msg);
  }
}

/** 渠道类型的中文名（渲染层与设置页共用）。 */
export const CHANNEL_KIND_LABELS: Record<ChannelKind, string> = {
  "slack-webhook": "Slack",
  "discord-webhook": "Discord",
  "generic-webhook": "Webhook",
  email: "邮件",
  desktop: "桌面通知",
};
