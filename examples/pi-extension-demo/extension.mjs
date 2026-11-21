/**
 * OpenBuddy 示例 Pi 扩展 (B1a JS 扩展试点).
 *
 * Pi's loader imports this file and calls the default export with `ExtensionAPI`; the extension
 * then registers a custom tool (`demo_echo`) and a slash command (`demo`) exactly like a
 * third-party extension would. Install it from 扩展中心 or:
 *
 *   agent_extensions_add({ path: "<repo>/examples/pi-extension-demo/extension.mjs" })
 *   agent_extensions_set_enabled({ enabled: true })
 *
 * The tool is intentionally side-effect free so it is safe to run in any permission mode.
 */
export default function demoExtension(pi) {
  pi.registerTool({
    name: "demo_echo",
    label: "Demo Echo",
    description: "Echo the provided text. Example Pi extension shipped with OpenBuddy.",
    promptSnippet: "demo_echo: echo a short string through the example extension",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "Text to echo" } },
      required: ["text"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `demo:${String(params.text ?? "")}` }],
        details: { extension: "pi-extension-demo" },
      };
    },
  });

  pi.registerCommand("demo", {
    description: "OpenBuddy 示例扩展：回显参数",
    async handler(args, ctx) {
      ctx.ui.notify(`demo: ${args || "(空)"}`, "info");
    },
  });
}
