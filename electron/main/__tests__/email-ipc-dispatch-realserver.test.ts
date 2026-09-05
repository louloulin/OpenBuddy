// @vitest-environment node
/**
 * Real end-to-end test for the `email:*` IPC handlers registered in
 * `electron/main/ipc.ts` via `ipcMain.handle`. Covers the dispatcher layer
 * (parameter validation, error propagation, dynamic import of
 * @openbuddy/capability-email) that wraps `emailHandlers.*` — the latter
 * is tested by `capability-email`'s internal test suite.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CapturedHandler { channel: string; fn: (...args: unknown[]) => Promise<unknown> | unknown }
const { registry } = vi.hoisted(() => {
  const registry = new Map<string, CapturedHandler>();
  (globalThis as unknown as { __registry: typeof registry }).__registry = registry;
  return { registry };
});

vi.mock("electron", () => {
  const reg = (globalThis as unknown as { __registry: Map<string, CapturedHandler> }).__registry;
  return {
    app: { getPath: (key: string) => key === "userData" ? "/tmp/openbuddy-email-ipc-test" : "/tmp", on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: CapturedHandler["fn"]) => { reg.set(channel, { channel, fn: handler }); }),
      removeHandler: vi.fn((channel: string) => { reg.delete(channel); }),
      on: vi.fn(), removeListener: vi.fn(), removeAllListeners: vi.fn(),
    },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: vi.fn() },
    BrowserWindow: vi.fn(),
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
    clipboard: { writeText: vi.fn(), readText: vi.fn() },
  };
});

const { casdoorAuthMock, emailHandlersMock } = vi.hoisted(() => ({
  casdoorAuthMock: { status: vi.fn().mockReturnValue({ config: { configured: false, issuer: "" }, identity: null, tenantContext: { activeTenantId: "" } }) },
  emailHandlersMock: {
    providerDiagnostics: vi.fn(),
    accounts: vi.fn(),
    rules: vi.fn(),
    registryList: vi.fn(),
    registryReadiness: vi.fn(),
    registryDiagnostics: vi.fn(),
    registrySetEnabled: vi.fn(),
    registryReauthorize: vi.fn(),
    registryRegister: vi.fn(),
    registryRemove: vi.fn(),
  },
}));
vi.mock("../casdoor/casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));
vi.mock("@openbuddy/capability-email", () => ({ emailHandlers: emailHandlersMock }));

let tempDir = "";

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-email-ipc-"));
  process.env.PI_HOME = tempDir;
  process.env.PI_CODING_AGENT_DIR = tempDir;
  const ipc = await import("../ipc/index");
  await ipc.registerIpc(() => null);
});

// Helper: stub all emailHandlers methods to return a sensible default
function stubEmailHandlers(): void {
  const defaultArr: unknown[] = [];
  const defaultObj = {};
  for (const [k, fn] of Object.entries(emailHandlersMock)) {
    (fn as ReturnType<typeof vi.fn>).mockReset();
    if (k === "accounts" || k === "rules" || k === "registryList") (fn as ReturnType<typeof vi.fn>).mockReturnValue(defaultArr);
    else (fn as ReturnType<typeof vi.fn>).mockReturnValue(defaultObj);
  }
}

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  stubEmailHandlers();
});

async function callHandler<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = registry.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return (await handler.fn({}, ...args)) as T;
}

describe("email IPC dispatch 真实端到端", () => {
  describe("email:registry-* 邮件账户注册中心", () => {
    it("email:registry-list 透传到 emailHandlers.registryList", async () => {
      emailHandlersMock.registryList.mockReturnValue([{ id: "acc1" }]);
      const result = await callHandler("email:registry-list");
      expect(emailHandlersMock.registryList).toHaveBeenCalled();
      expect(result).toEqual([{ id: "acc1" }]);
    });

    it("email:registry-readiness 返回就绪状态", async () => {
      emailHandlersMock.registryReadiness.mockReturnValue({ ready: true });
      const result = await callHandler("email:registry-readiness");
      expect(emailHandlersMock.registryReadiness).toHaveBeenCalled();
      expect(result).toEqual({ ready: true });
    });

    it("email:registry-diagnostics 返回诊断信息", async () => {
      emailHandlersMock.registryDiagnostics.mockReturnValue({ ok: true });
      const result = await callHandler("email:registry-diagnostics");
      expect(emailHandlersMock.registryDiagnostics).toHaveBeenCalled();
      expect(result).toEqual({ ok: true });
    });

    it("email:registry-set-enabled 需要 id + enabled", async () => {
      emailHandlersMock.registrySetEnabled.mockReturnValue({ ok: true });
      await callHandler("email:registry-set-enabled", { id: "acc1", enabled: true });
      expect(emailHandlersMock.registrySetEnabled).toHaveBeenCalledWith("acc1", true);
    });

    it("email:registry-set-enabled 缺 enabled → throw", async () => {
      await expect(callHandler("email:registry-set-enabled", { id: "acc1" })).rejects.toThrow();
    });

    it("email:registry-reauthorize 需要 id", async () => {
      emailHandlersMock.registryReauthorize.mockReturnValue({ ok: true });
      await callHandler("email:registry-reauthorize", { id: "acc1" });
      expect(emailHandlersMock.registryReauthorize).toHaveBeenCalledWith("acc1");
    });

    it("email:registry-reauthorize 缺 id → throw", async () => {
      await expect(callHandler("email:registry-reauthorize", {})).rejects.toThrow();
    });

    it("email:registry-register 需要 providerType + displayName", async () => {
      emailHandlersMock.registryRegister.mockReturnValue({ id: "new-acc" });
      await callHandler("email:registry-register", { providerType: "gmail-api", displayName: "My Gmail" });
      expect(emailHandlersMock.registryRegister).toHaveBeenCalled();
    });

    it("email:registry-register 非法 providerType → throw", async () => {
      await expect(callHandler("email:registry-register", { providerType: "invalid", displayName: "X" })).rejects.toThrow();
    });

    it("email:registry-remove 需要 id", async () => {
      emailHandlersMock.registryRemove.mockReturnValue({ ok: true });
      await callHandler("email:registry-remove", { id: "acc1" });
      expect(emailHandlersMock.registryRemove).toHaveBeenCalledWith("acc1");
    });

    it("email:registry-remove 缺 id → throw", async () => {
      await expect(callHandler("email:registry-remove", {})).rejects.toThrow();
    });
  });

  describe("email:* 基础 API (accounts/rules/etc)", () => {
    it("email:provider-diagnostics 返回诊断信息", async () => {
      emailHandlersMock.providerDiagnostics.mockReturnValue({ status: "ok" });
      const result = await callHandler("email:provider-diagnostics");
      expect(emailHandlersMock.providerDiagnostics).toHaveBeenCalled();
      expect(result).toEqual({ status: "ok" });
    });

    it("email:accounts 返回账户列表", async () => {
      emailHandlersMock.accounts.mockReturnValue([{ id: "acc1" }]);
      const result = await callHandler("email:accounts");
      expect(emailHandlersMock.accounts).toHaveBeenCalled();
      expect(result).toEqual([{ id: "acc1" }]);
    });

    it("email:rules 返回规则列表", async () => {
      emailHandlersMock.rules.mockReturnValue([{ id: "rule1" }]);
      const result = await callHandler("email:rules");
      expect(emailHandlersMock.rules).toHaveBeenCalled();
      expect(result).toEqual([{ id: "rule1" }]);
    });
  });
});
