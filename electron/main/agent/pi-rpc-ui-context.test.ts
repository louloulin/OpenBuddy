import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createOpenBuddyRpcUiContext } from "./pi-rpc-ui-context";

describe("OpenBuddy Pi RPC UI context", () => {
  it("matches Pi RPC fallbacks for terminal-only APIs", async () => {
    const emitted: Record<string, unknown>[] = [];
    let editorText = "draft";
    const ui = createOpenBuddyRpcUiContext({
      sessionId: "test-session",
      select: async () => "selected",
      confirm: async () => true,
      input: async () => "input",
      editor: async () => "edited",
      emit: (payload) => emitted.push(payload),
      getEditorText: () => editorText,
      setEditorText: (text) => { editorText = text; },
      getToolsExpanded: () => false,
      setToolsExpanded: () => undefined,
    });

    expect(await ui.custom(() => undefined as never)).toBeUndefined();
    expect(ui.getEditorComponent()).toBeUndefined();
    expect(ui.getAllThemes()).toEqual([]);
    expect(ui.getTheme("dark")).toBeUndefined();
    expect(ui.setTheme("dark")).toEqual({ success: false, error: "Theme switching not supported in RPC mode" });
    expect(ui.getEditorText()).toBe("draft");
    ui.addAutocompleteProvider(() => ({
      getSuggestions: async () => ({ items: [], prefix: "" }),
      applyCompletion: () => ({ lines: [], cursorLine: 0, cursorCol: 0 }),
    }));
    ui.setHeader(() => undefined as never);
    ui.setEditorComponent(() => undefined as never);
    ui.pasteToEditor(" + paste");
    expect(editorText).toBe("draft + paste");
    expect(emitted).toEqual([]);
  });

  it("loads an extension that exercises RPC-safe UI methods", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-rpc-ui-"));
    const packageRoot = join(root, "pi-package");
    const extensionPath = join(packageRoot, "extension.js");
    const agentDir = join(root, "agent");
    const cwd = join(root, "workspace");
    await mkdir(packageRoot, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "fixture-pi-rpc-ui",
      pi: { extensions: ["./extension.js"] },
    }));
    await writeFile(extensionPath, `
      export default function (pi) {
        pi.on("session_start", async (_event, ctx) => {
          await ctx.ui.custom(() => undefined);
          ctx.ui.setHeader(() => undefined);
          ctx.ui.addAutocompleteProvider(() => ({
            getSuggestions: async () => ({ items: [], prefix: "" }),
            applyCompletion: () => ({ lines: [], cursorLine: 0, cursorCol: 0 }),
          }));
          ctx.ui.setEditorComponent(() => undefined);
          if (ctx.ui.getEditorComponent() !== undefined) throw new Error("RPC editor component should be undefined");
        });
      }
    `);

    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    try {
      const loader = new DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: [packageRoot] });
      await loader.reload();
      const created = await createAgentSession({
        cwd,
        agentDir,
        noTools: "builtin",
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(cwd),
      });
      session = created.session;
      const ui = createOpenBuddyRpcUiContext({
        sessionId: session.sessionId,
        select: async () => undefined,
        confirm: async () => false,
        input: async () => undefined,
        editor: async () => undefined,
        emit: () => undefined,
        getEditorText: () => "",
        setEditorText: () => undefined,
        getToolsExpanded: () => false,
        setToolsExpanded: () => undefined,
      });
      await session.bindExtensions({ uiContext: ui, mode: "rpc" });
      expect(loader.getExtensions().errors).toEqual([]);
      expect(created.extensionsResult.errors).toEqual([]);
    } finally {
      session?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});
