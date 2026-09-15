/**
 * openbuddy-plugin-hello — 在 home.scene.tab 注册 "Hello" tab
 *
 * 加载后用户可以在 HomePage 的场景切换栏看到新 tab，点击触发 alert。
 */
import { defineExtension } from "@openbuddy/plugin-sdk";

export default defineExtension({
  manifest: {
    name: "openbuddy-plugin-hello",
    version: "0.1.0",
    description: "在 HomePage 注册一个 'Hello' 场景 tab，点击弹出问候。",
    author: "OpenBuddy Team",
    contributes: {
      slots: [
        {
          name: "home.scene.tab",
          kind: "list",
          scope: "root",
        },
      ],
    },
  },
  setup: (api) => {
    api.registerSlot("home.scene.tab", "list", "root", {
      id: "hello-world-tab",
      label: "👋 Hello",
      icon: "👋",
      onActivate: () => {
        // eslint-disable-next-line no-alert
        if (typeof window !== "undefined") window.alert("Hello, World! 👋");
      },
    });
  },
});
