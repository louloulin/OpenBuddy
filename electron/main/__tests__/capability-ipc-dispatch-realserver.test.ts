// @vitest-environment node
/**
 * Real end-to-end test for the capability.* dispatch layer in
 * `electron/main/ipc.ts`. Validates:
 *   - capability.automation snapshot via real automation store
 *
 * The IPC dispatch path (dispatchTypedRpc) is invoked directly, with the
 * underlying capability-* packages mounted into a real Cordis context so the
 * handlers operate on the real SQLite-backed stores.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RpcId, type ClientRequest } from "@openbuddy/plugin-host";

vi.mock("electron", () => ({
  app: { getPath: (key: string) => key === "userData" ? "/tmp/openbuddy-capability-ipc-test" : "/tmp", on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn(), removeListener: vi.fn(), removeAllListeners: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  clipboard: { writeText: vi.fn(), readText: vi.fn() },
}));

const { casdoorAuthMock } = vi.hoisted(() => ({
  casdoorAuthMock: { status: vi.fn().mockReturnValue({ config: { configured: false, issuer: "" }, identity: null, tenantContext: { activeTenantId: "" } }) },
}));
vi.mock("../casdoor/casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));

let tempDir = "";
let dispatchTypedRpc: typeof import("../ipc/index").dispatchTypedRpc;

function rpc(method: string, payload: object = {}): ClientRequest {
  return { type: "client-request", rpcId: RpcId(`test-${Date.now()}-${Math.random()}`), method, payload };
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-capability-ipc-"));
  process.env.PI_HOME = tempDir;
  process.env.PI_CODING_AGENT_DIR = tempDir;
  const ipc = await import("../ipc/index");
  dispatchTypedRpc = ipc.dispatchTypedRpc;
});

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("capability.automation dispatch 参数校验", () => {
  it("capability.automation 非法 action → throw", async () => {
    await expect(dispatchTypedRpc(rpc("capability.automation", { action: "invalid" }))).rejects.toThrow();
  });

  it("capability.automation status 非法 status → throw", async () => {
    await expect(dispatchTypedRpc(rpc("capability.automation", {
      action: "status",
      id: "x",
      status: "invalid",
    }))).rejects.toThrow();
  });

  it("capability.automation save 缺 automation → throw", async () => {
    await expect(dispatchTypedRpc(rpc("capability.automation", { action: "save" }))).rejects.toThrow();
  });
});
