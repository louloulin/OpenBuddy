// §5.3 `notifications` module: notification_list / append / mark_read / mark_all_read / clear, notification_prefs_get / set,
// and 通知渠道 (W4.6): notify_channels_list / save / delete / test.
import { invoke } from "../ipc";
import type { NotificationEntry, NotificationKind } from "@openbuddy/protocol/dto";
import type { NotifyChannel, NotifyChannelDraft, NotifyResult } from "@openbuddy/protocol/notifications";

// ---------- 通知渠道 (W4.6): configured here, sent by the host ----------

export const notifyChannelsList = () => invoke<NotifyChannel[]>("notify_channels_list");
export const notifyChannelsSave = (channel: NotifyChannelDraft) => invoke<NotifyChannel>("notify_channels_save", { channel });
export const notifyChannelsDelete = (id: string) => invoke<void>("notify_channels_delete", { id });
export const notifyChannelsTest = (id: string) => invoke<NotifyResult>("notify_channels_test", { id });

// ---------- notification log (智能体邮箱) ----------

export async function notificationAppend(
  kind: NotificationKind | string,
  title: string,
  body?: string,
  sessionId?: string,
  severity?: "info" | "warn" | "error",
): Promise<void> {
  await invoke<void>("notification_append", {
    kind,
    title,
    body: body ?? null,
    sessionId: sessionId ?? null,
    severity: severity ?? null,
  });
}

/** List notifications (newest first). */
export async function notificationList(): Promise<NotificationEntry[]> {
  return invoke<NotificationEntry[]>("notification_list");
}

/** Mark a notification as read. */
export async function notificationMarkRead(id: number): Promise<void> {
  await invoke<void>("notification_mark_read", { id });
}

/** Mark all as read. */
export async function notificationMarkAllRead(): Promise<void> {
  await invoke<void>("notification_mark_all_read");
}

/** Clear all notifications. */
/** 系统通知开关 (20261115-ui U6.1): background completions / approvals / failures. */
export const notificationPrefsGet = () => invoke<{ system: boolean }>("notification_prefs_get");
export const notificationPrefsSet = (system: boolean) => invoke<{ system: boolean }>("notification_prefs_set", { system });

export async function notificationClear(): Promise<void> {
  await invoke<void>("notification_clear");
}
