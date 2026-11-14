// §5.3 `notifications` module: notification_list / append / mark_read / mark_all_read / clear, notification_prefs_get / set.
import { invoke } from "../ipc";
import type { NotificationEntry, NotificationKind } from "@openbuddy/protocol/dto";

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
