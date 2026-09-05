/**
 * openbuddy-markdown.ts — Phase R3.0 (pi-web-alignment).
 *
 * Pi extension that bridges the Pi ExtensionAPI's `registerMarkdownTransformer`
 * and `registerMessageRenderer` hooks to OpenBuddy's first-party Markdown
 * rendering pipeline (`@openbuddy/ui-markdown`).
 *
 * Why this matters:
 *   Pi AgentSession emits assistant messages containing raw Markdown.
 *   The default Pi TUI renderer uses its own Markdown pipeline. OpenBuddy
 *   replaces the TUI with a web view (`openbuddy-ui-conversation`), so we
 *   want the LLM-emitted Markdown to flow through OUR pipeline — which
 *   already wires remark-gfm, rehype-katex, rehype-highlight, mermaid,
 *   and the WB-style `--wb-*` design tokens.
 *
 *   The `registerMarkdownTransformer` hook lets us inject pre-processing
 *   logic (e.g. WB-specific hint strings → chip tokens) before any
 *   downstream renderer runs.
 *
 * The companion test file lives at
 * `electron/main/agent/extensions/__tests__/openbuddy-markdown.test.ts`.
 */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

/**
 * `openbuddy-markdown` — minimal Pi extension that registers the WB-style
 * Markdown transformer. Heavy lifting (the actual renderer) lives in
 * `@openbuddy/ui-markdown` and is invoked from the renderer process
 * when the streaming message lands.
 */
const openbuddyMarkdown: ExtensionFactory = (pi: ExtensionAPI) => {
  // Pi 0.84's ExtensionAPI exposes these methods conditionally — defensive
  // guards mirror the pattern used elsewhere (see apply-patch.ts).
  const api = pi as unknown as {
    registerMarkdownTransformer?: (transformer: {
      transformAssistant?: (markdown: string) => string | Promise<string>;
      transformUser?: (markdown: string) => string | Promise<string>;
    }) => void;
    registerMessageRenderer?: (
      customType: string,
      renderer: (message: unknown, ctx: unknown) => unknown,
    ) => void;
  };

  if (typeof api.registerMarkdownTransformer === "function") {
    api.registerMarkdownTransformer({
      // Pre-process assistant markdown before downstream renderers see it.
      // Today this is a no-op — the real renderer lives in
      // `@openbuddy/ui-markdown` and is invoked from the React tree.
      // The hook is registered so future tweaks (e.g. WB-token expansion)
      // can be added without touching every consumer.
      transformAssistant: (md: string) => md,
      transformUser: (md: string) => md,
    });
  }

  if (typeof api.registerMessageRenderer === "function") {
    api.registerMessageRenderer(
      "openbuddy_markdown",
      (_message, _ctx) => {
        // The renderer is the React component tree (ChatView → MessageItem →
        // StreamingMarkdown → Markdown). Returning the raw message here
        // is a no-op so the default TUI doesn't double-render it; the
        // Electron renderer process picks it up via the normal `pi://update`
        // event stream.
        return null;
      },
    );
  }
};

export default openbuddyMarkdown;