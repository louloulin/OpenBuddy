// Smoke test - try to import agentHost with minimal mocks
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-smoke", on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
  shell: { openExternal: vi.fn() },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  clipboard: { writeText: vi.fn(), readText: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    createAgentSession: vi.fn(),
    DefaultResourceLoader: vi.fn(),
    SessionManager: vi.fn(),
    ModelRuntime: vi.fn(),
    ModelRegistry: vi.fn(),
  };
});

vi.mock("@openbuddy/cordis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openbuddy/cordis")>();
  return { ...actual, Context: vi.fn() };
});

vi.mock("@openbuddy/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openbuddy/storage")>();
  return { ...actual, HarnessCursorStore: vi.fn() };
});

vi.mock("@openbuddy/team-team", () => ({}));

vi.mock("@openbuddy/plugin-host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openbuddy/plugin-host")>();
  return actual;
});

vi.mock("../casdoor/casdoor-auth", () => ({
  casdoorAuth: {
    status: vi.fn().mockReturnValue({ config: { configured: true, issuer: "" }, identity: null, tenantContext: { activeTenantId: "" } }),
    setStatusListener: vi.fn(),
  },
}));

describe("agentHost import smoke", () => {
  it("imports without error", async () => {
    try {
      const mod = await import("../agent/agent-host");
      expect(mod.agentHost).toBeTruthy();
      expect(typeof mod.agentHost.syncWorkbenchScope).toBe("function");
      expect(typeof mod.agentHost.bindCurrentSessionToTenant).toBe("function");
    } catch (e) {
      console.error("Import failed:", e instanceof Error ? e.message : e);
      throw e;
    }
  });
});
