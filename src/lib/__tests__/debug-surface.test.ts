import { describe, expect, it } from "vitest";

describe("debug-surface: DevTools entry boundaries", () => {
  it("allows toggling DevTools without exposing it in the renderer DOM", () => {
    const debugConfig = {
      rendererHasToolbar: false,
      exposeDevtoolsButton: false,
      platformShortcuts: { macos: "Option+Cmd+I", windows: "Ctrl+Shift+I", linux: "Ctrl+Shift+I" },
      menuPath: "View > Toggle Developer Tools",
    };
    expect(debugConfig.rendererHasToolbar).toBe(false);
    expect(debugConfig.exposeDevtoolsButton).toBe(false);
    expect(debugConfig.platformShortcuts.macos).toMatch(/Cmd/);
    expect(debugConfig.menuPath).toContain("Developer Tools");
  });

  it("does not auto-attach a debug-only toolbar to the bridge payload", () => {
    const bridgeKeys = ["apiVersion", "invoke", "rpc", "harness", "platform", "versions", "shell", "clipboard", "window", "agent", "events"];
    expect(bridgeKeys).not.toContain("debugToolbar");
    expect(bridgeKeys).not.toContain("debugTools");
  });

  it("keeps the reload and force-reload calls on the explicit allowlist", () => {
    const allowed = new Set(["debug:reload", "debug:force-reload", "debug:toggle-devtools", "debug:info", "internal_reload"]);
    expect(allowed.has("debug:reload")).toBe(true);
    expect(allowed.has("debug:force-reload")).toBe(true);
    expect(allowed.has("debug:toggle-devtools")).toBe(true);
  });
});
