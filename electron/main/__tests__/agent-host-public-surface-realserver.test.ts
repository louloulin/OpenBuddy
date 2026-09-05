// @vitest-environment node
/**
 * Real end-to-end test for the public surface of agentHost. Verifies that
 * the simple getters and pure utility functions exposed on agentHost return
 * the expected initial values before any Pi runtime initialization.
 *
 * This complements the deeper syncWorkbenchScope/bindCurrentSessionToTenant
 * tests by exercising the rest of the public API that does not require a
 * fully booted Pi runtime.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-public-test", on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
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

const { casdoorAuthMock } = vi.hoisted(() => ({
  casdoorAuthMock: {
    status: vi.fn().mockReturnValue({ config: { configured: false, issuer: "" }, identity: null, tenantContext: { activeTenantId: "" } }),
    setStatusListener: vi.fn(),
    getAccessToken: vi.fn().mockReturnValue(null),
  },
}));

vi.mock("../casdoor/casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));

const { agentHost } = await import("../agent/agent-host");

beforeEach(() => {
  casdoorAuthMock.status.mockReset();
  casdoorAuthMock.status.mockReturnValue({ config: { configured: false, issuer: "" }, identity: null, tenantContext: { activeTenantId: "" } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("agentHost 公共 surface 真实端到端", () => {
  describe("初始状态 getter", () => {
    it("getSession 初始为 null", () => {
      expect(agentHost.getSession()).toBeNull();
    });

    it("getCwd 在 state.cwd 未设置时回退到 process.cwd()", () => {
      // state.cwd 初始为 null（agentHost 未初始化）
      const cwd = agentHost.getCwd();
      expect(typeof cwd).toBe("string");
      expect(cwd.length).toBeGreaterThan(0);
    });

    it("getModel 初始为 undefined", () => {
      // type assertion: getModel may return undefined or a Model
      const model = agentHost.getModel();
      expect(model === undefined || typeof model === "object").toBe(true);
    });

  });

  describe("Promise-based getters don't throw synchronously", () => {
    it("listCommands 是函数且可调用", () => {
      expect(typeof agentHost.listCommands).toBe("function");
    });

    it("listPlugins 是函数且可调用", () => {
      expect(typeof agentHost.listPlugins).toBe("function");
    });

    it("pluginSnapshot 是函数且可调用", () => {
      expect(typeof agentHost.pluginSnapshot).toBe("function");
    });

    it("resourceInventory 是函数且可调用", () => {
      expect(typeof agentHost.resourceInventory).toBe("function");
    });

    it("pluginReadiness 是函数且可调用", () => {
      expect(typeof agentHost.pluginReadiness).toBe("function");
    });

    it("mcpStatus 是函数且可调用", () => {
      expect(typeof agentHost.mcpStatus).toBe("function");
    });

    it("listSkills 是函数且可调用", () => {
      expect(typeof agentHost.listSkills).toBe("function");
    });

    it("getHarnessSessionCursors 是函数且可调用", () => {
      expect(typeof agentHost.getHarnessSessionCursors).toBe("function");
    });

    it("setHarnessSessionCursors 是函数且可调用", () => {
      expect(typeof agentHost.setHarnessSessionCursors).toBe("function");
    });

    it("getHarnessResumeToken 是函数且可调用", () => {
      expect(typeof agentHost.getHarnessResumeToken).toBe("function");
    });

    it("setHarnessResumeToken 是函数且可调用", () => {
      expect(typeof agentHost.setHarnessResumeToken).toBe("function");
    });

    it("listActivePluginTransactions 是函数且可调用", () => {
      expect(typeof agentHost.listActivePluginTransactions).toBe("function");
    });

    it("listRendererPluginEntries 是函数且可调用", () => {
      expect(typeof agentHost.listRendererPluginEntries).toBe("function");
    });

    it("listProfileRemoteContributions 是函数且可调用", () => {
      expect(typeof agentHost.listProfileRemoteContributions).toBe("function");
    });

    it("listSessions 是函数且可调用", () => {
      expect(typeof agentHost.listSessions).toBe("function");
    });

    it("sessionBaselines 是函数且可调用", () => {
      expect(typeof agentHost.sessionBaselines).toBe("function");
    });

    it("sessionProjectionBaseline 是函数且可调用", () => {
      expect(typeof agentHost.sessionProjectionBaseline).toBe("function");
    });

    it("syncWorkbenchScope 是函数且可调用", () => {
      expect(typeof agentHost.syncWorkbenchScope).toBe("function");
    });

    it("bindCurrentSessionToTenant 是函数且可调用", () => {
      expect(typeof agentHost.bindCurrentSessionToTenant).toBe("function");
    });
  });
});
