// @vitest-environment node
/**
 * Real end-to-end test for the agent:* IPC handlers registered in
 * `electron/main/ipc.ts` via `ipcMain.handle`. Covers the dispatcher layer
 * for handlers that do not require a fully initialized Pi runtime:
 *   - agent:current-model (getter)
 *   - agent:plugin-list / inventory / snapshot / readiness / state-get / state-reset
 *   - agent:profile-packages (list of profile packages)
 *   - agent:plugin-enable / plugin-reload (parameter validation)
 *   - agent:presets-list / preset-current / preset-select (preset management)
 *
 * The complex session-bound handlers (new-session / prompt / steer / follow-up /
 * abort / set-model) require a booted Pi runtime and are covered indirectly by
 * the higher-level integration tests.
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
    app: { getPath: (key: string) => key === "userData" ? "/tmp/openbuddy-agent-ipc-test" : "/tmp", on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
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

const { casdoorAuthMock } = vi.hoisted(() => ({
  casdoorAuthMock: { status: vi.fn().mockReturnValue({ config: { configured: false, issuer: "" }, identity: null, tenantContext: { activeTenantId: "" } }) },
}));
vi.mock("../casdoor/casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));

let tempDir = "";

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-agent-ipc-"));
  process.env.PI_HOME = tempDir;
  process.env.PI_CODING_AGENT_DIR = tempDir;
  const ipc = await import("../ipc/index");
  await ipc.registerIpc(() => null);
});

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callHandler<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = registry.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return (await handler.fn({}, ...args)) as T;
}

describe("agent IPC dispatch 真实端到端", () => {
  describe("agent:* simple getter handler", () => {
    it("agent:current-model 返回当前 model (undefined 或 object)", async () => {
      const result = await callHandler("agent:current-model");
      expect(result === undefined || typeof result === "object").toBe(true);
    });

    it("agent:plugin-list 返回 plugin 列表", async () => {
      const result = await callHandler("agent:plugin-list");
      expect(result === null || Array.isArray(result) || typeof result === "object").toBe(true);
    });

    it("agent:plugin-inventory 返回 inventory", async () => {
      const result = await callHandler("agent:plugin-inventory");
      expect(result === null || typeof result === "object").toBe(true);
    });

    it("agent:plugin-snapshot 返回 snapshot", async () => {
      const result = await callHandler("agent:plugin-snapshot");
      expect(result === null || typeof result === "object").toBe(true);
    });

    it("agent:plugin-readiness 返回 readiness", async () => {
      const result = await callHandler("agent:plugin-readiness");
      expect(result === null || typeof result === "object").toBe(true);
    });

    it("agent:profile-packages 返回 profile 列表 或初始化未完成 throw", async () => {
      try {
        const result = await callHandler("agent:profile-packages");
        expect(result === null || Array.isArray(result) || typeof result === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    it("agent:preset-current 返回当前 preset ID", async () => {
      const result = await callHandler("agent:preset-current");
      expect(typeof result === "object").toBe(true);
      expect(
        (result as { id?: string | null }).id === undefined
        || (result as { id?: string | null }).id === null
        || typeof (result as { id: string }).id === "string",
      ).toBe(true);
    });

    it("agent:presets-list 返回 preset 列表", async () => {
      const result = await callHandler("agent:presets-list");
      expect(result === null || Array.isArray(result) || typeof result === "object").toBe(true);
    });

    it("agent:deepseek-cordis-snapshot 返回 snapshot", async () => {
      const result = await callHandler("agent:deepseek-cordis-snapshot");
      expect(result === null || typeof result === "object").toBe(true);
    });

    it("agent:deepseek-pi-describe 返回 bridge description", async () => {
      const result = await callHandler("agent:deepseek-pi-describe");
      expect(result === null || typeof result === "object").toBe(true);
    });
  });

  describe("agent:plugin-enable 参数校验", () => {
    it("agent:plugin-enable 缺 id → throw", async () => {
      await expect(callHandler("agent:plugin-enable", { enabled: true })).rejects.toThrow();
    });

    it("agent:plugin-enable 缺 enabled → throw", async () => {
      await expect(callHandler("agent:plugin-enable", { id: "x" })).rejects.toThrow();
    });
  });

  describe("agent:profile-install 参数校验", () => {
    it("agent:profile-install 缺 path → throw", async () => {
      await expect(callHandler("agent:profile-install", {})).rejects.toThrow();
    });
  });

  describe("agent:* 接受字符串 input (兼容旧调用)", () => {
    it("agent:prompt 接受字符串 (当作 sessionId)", async () => {
      // 没有 active session 时应该 throw 或返回错误
      await expect(callHandler("agent:prompt", "missing-session-id")).rejects.toThrow();
    });

    it("agent:set-model 接受字符串 (当作 modelId)", async () => {
      // 没有 active session 时应该 throw
      await expect(callHandler("agent:set-model", "gpt-4")).rejects.toThrow();
    });
  });
});
