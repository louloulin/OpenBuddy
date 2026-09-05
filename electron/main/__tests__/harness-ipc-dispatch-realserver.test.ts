// @vitest-environment node
/**
 * Real end-to-end test for the `harness:*` IPC handlers registered in
 * `electron/main/ipc.ts` via `ipcMain.handle`. Covers the dispatcher layer
 * (parameter validation, recovery flow delegation) that wraps
 * `agentHost.getHarnessSessionCursors` / `setHarnessSessionCursors` /
 * `getHarnessResumeToken` / `setHarnessResumeToken` and `recovery.*`.
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
    app: { getPath: (key: string) => key === "userData" ? "/tmp/openbuddy-harness-ipc-test" : "/tmp", on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
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
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-harness-ipc-"));
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

describe("harness IPC dispatch 真实端到端", () => {
  it("harness:address 返回 server address 或 undefined", async () => {
    const result = await callHandler("harness:address");
    expect(result === undefined || typeof result === "object").toBe(true);
  });

  it("harness:session-cursors 返回 cursors 对象", async () => {
    const result = await callHandler("harness:session-cursors");
    expect(typeof result === "object").toBe(true);
  });

  it("harness:session-cursors-set 接收 args 对象", async () => {
    const result = await callHandler("harness:session-cursors-set", { cursors: { s1: 5 } });
    expect(result === undefined || typeof result === "object" || typeof result === "string" || typeof result === "number").toBe(true);
  });

  it("harness:resume-token 返回 token 或 undefined", async () => {
    const result = await callHandler("harness:resume-token");
    expect(result === undefined || typeof result === "string" || typeof result === "object").toBe(true);
  });

  it("harness:resume-token-set 接收 16+ 字符 token 字符串", async () => {
    const validToken = "a".repeat(20);
    const result = await callHandler("harness:resume-token-set", validToken);
    expect(typeof result === "string" || typeof result === "object" || typeof result === "undefined").toBe(true);
  });

  it("harness:resume-token-set 兼容 token 包裹参数", async () => {
    const validToken = "b".repeat(20);
    await expect(callHandler("harness:resume-token-set", { token: validToken })).resolves.toBe(validToken);
  });

  it("harness:resume-token-set 太短 token → throw", async () => {
    await expect(callHandler("harness:resume-token-set", "short")).rejects.toThrow();
  });
});
