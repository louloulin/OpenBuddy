import { Notification, shell } from "electron";
import type { OpenBuddyNotifyChannel } from "./agent/pi-resources";

export type MainNotificationMessage = {
  title: string;
  body?: string;
  level?: "info" | "warn" | "error";
  sessionId?: string;
};

function payloadFor(channel: OpenBuddyNotifyChannel, message: MainNotificationMessage): unknown {
  const level = message.level ?? "info";
  if (channel.kind === "slack-webhook") {
    const emoji = level === "error" ? "🔴" : level === "warn" ? "🟡" : "🔵";
    return {
      text: `${emoji} ${message.title}`,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `*${emoji} ${message.title}*${message.body ? `\n${message.body}` : ""}` } }],
    };
  }
  if (channel.kind === "discord-webhook") {
    return {
      content: message.title,
      embeds: [{ title: message.title, description: message.body ?? "", color: level === "error" ? 0xdc2626 : level === "warn" ? 0xd97706 : 0x0ea5e9 }],
    };
  }
  if (channel.kind === "email") {
    const address = channel.endpoint ?? "";
    const params = new URLSearchParams({ subject: message.title });
    if (message.body) params.set("body", message.body);
    return `mailto:${address}?${params.toString()}`;
  }
  return { title: message.title, body: message.body ?? "", level, ts: Date.now(), sessionId: message.sessionId };
}

async function send(channel: OpenBuddyNotifyChannel, message: MainNotificationMessage): Promise<boolean> {
  const payload = payloadFor(channel, message);
  if (channel.kind === "desktop") {
    if (!Notification.isSupported()) return false;
    new Notification({ title: message.title, body: message.body ?? "" }).show();
    return true;
  }
  if (channel.kind === "email") {
    await shell.openExternal(String(payload));
    return true;
  }
  if (!channel.endpoint) return false;
  const endpoint = new URL(channel.endpoint);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new Error("notification endpoint must use http or https");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.ok;
}

export async function dispatchMainNotifications(
  channels: OpenBuddyNotifyChannel[],
  message: MainNotificationMessage,
): Promise<Array<{ id: string; ok: boolean }>> {
  const results: Array<{ id: string; ok: boolean }> = [];
  for (const channel of channels.filter((entry) => entry.enabled)) {
    try {
      results.push({ id: channel.id, ok: await send(channel, message) });
    } catch {
      results.push({ id: channel.id, ok: false });
    }
  }
  return results;
}
