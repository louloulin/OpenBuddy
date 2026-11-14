import { text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `notifications` module. In-app notification list and system notification preference. */
export function notificationsModule(ctx: HostContext): HostModule {
  const { settings, update } = ctx;
  const commands: Record<string, Handler> = {
    notification_list: () =>
      settings.config.read().notifications.slice().reverse(),
    notification_append: (p) => {
      update((c) => {
        const last = c.notifications.at(-1)?.id ?? 0;
        c.notifications.push({
          id: Math.max(Date.now(), last + 1),
          kind: text(p.kind),
          at: new Date().toISOString(),
          title: text(p.title),
          body: typeof p.body === "string" ? p.body : undefined,
          sessionId: typeof p.sessionId === "string" ? p.sessionId : undefined,
          severity: typeof p.severity === "string" ? p.severity : "info",
          read: false,
        });
        c.notifications = c.notifications.slice(-200);
      });
    },
    notification_mark_read: (p) => {
      if (typeof p.id !== "number") throw Error("id必须为数字");
      update((c) => {
        const item = c.notifications.find((n) => n.id === p.id);
        if (!item) throw Error("通知不存在");
        item.read = true;
      });
    },
    notification_mark_all_read: () =>
      update((c) => {
        for (const n of c.notifications) n.read = true;
      }),
    notification_prefs_get: () => ({ system: settings.config.read().notifyPrefs?.system !== false }),
    notification_prefs_set: (p) => {
      if (typeof p.system !== "boolean") throw Error("system必须为布尔值");
      update((c) => { c.notifyPrefs = { ...c.notifyPrefs, system: p.system === true }; });
      return { system: p.system === true };
    },
    notification_clear: () =>
      update((c) => {
        c.notifications = [];
      }),
  };
  return { id: "notifications", commands };
}
