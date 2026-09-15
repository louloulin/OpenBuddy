/**
 * openbuddy-plugin-toolbar — 在 Composer 工具栏注入一个 "插入时间戳" 按钮
 */
import { defineExtension } from "@openbuddy/plugin-sdk";

export default defineExtension({
  manifest: {
    name: "openbuddy-plugin-toolbar",
    version: "0.1.0",
    description: "在 Composer 工具栏注入「插入时间戳」按钮。",
    author: "OpenBuddy Team",
    contributes: {
      slots: [
        {
          name: "composer.toolbar.action",
          kind: "list",
          scope: "session",
        },
      ],
    },
  },
  setup: (api) => {
    api.registerSlot("composer.toolbar.action", "list", "session", {
      id: "insert-timestamp",
      label: "插入时间戳",
      icon: "🕐",
      onClick: (ctx) => {
        const ts = new Date().toISOString();
        ctx?.insertText?.(`\n[${ts}]\n`);
      },
    });
  },
});
