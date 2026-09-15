/**
 * openbuddy-plugin-slash — 注册 /greet 命令
 */
import { defineExtension } from "@openbuddy/plugin-sdk";

export default defineExtension({
  manifest: {
    name: "openbuddy-plugin-slash",
    version: "0.1.0",
    description: "注册 /greet <name> slash 命令，输出问候。",
    author: "OpenBuddy Team",
    contributes: {
      slots: [],
      commands: [
        { id: "greet", label: "/greet — 输出问候", shortcut: "/greet" },
      ],
    },
  },
  setup: (api) => {
    api.registerCommand("greet", "/greet", (ctx?: { args?: string }) => {
      const name = ctx?.args ?? "World";
      // eslint-disable-next-line no-console
      console.log(`Hello, ${name}!`);
    });
  },
});
