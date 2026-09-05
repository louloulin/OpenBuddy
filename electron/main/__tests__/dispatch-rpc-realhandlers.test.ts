// @vitest-environment node
/**
 * Real end-to-end test for `dispatchTypedRpc` (the core RPC router exported
 * from `electron/main/ipc.ts`). Covers the safe, deterministic cases that
 * do not require a fully initialized Pi runtime (host.* + RPC payload
 * validation + plugin.snapshot + deepseek-cordis + workspace + llm).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RpcId, type ClientRequest } from "@openbuddy/plugin-host";

vi.mock("electron", () => ({
  app: { getPath: (key: string) => key === "userData" ? "/tmp/openbuddy-dispatch-test" : "/tmp", on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn(), removeListener: vi.fn(), removeAllListeners: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: vi.fn(),
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ["/tmp/test-pick"] })),
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: "/tmp/test-save" })),
    showMessageBox: vi.fn(async () => ({ response: 0 })),
  },
  clipboard: { writeText: vi.fn(), readText: vi.fn() },
}));

let tempDir = "";
let dispatchTypedRpc: typeof import("../ipc/index").dispatchTypedRpc;

function rpc(method: string, payload: object = {}): ClientRequest {
  return { type: "client-request", rpcId: RpcId(`test-${Date.now()}-${Math.random()}`), method, payload };
}
function rawRpc(input: unknown): ClientRequest {
  return input as ClientRequest;
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-dispatch-"));
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

describe("dispatchTypedRpc 真实端到端", () => {
  describe("host.* 入口", () => {
    it("host.describe 返回产品元数据", async () => {
      const result = await dispatchTypedRpc(rpc("host.describe"));
      expect(result).toEqual({ product: "OpenBuddy", runtime: "pi", pluginHost: "openbuddy" });
    });

    it("host.pickDirectory 调用 dialog.showOpenDialog 并返回 path", async () => {
      const result = await dispatchTypedRpc(rpc("host.pickDirectory"));
      expect(result).toEqual({ path: "/tmp/test-pick" });
    });

    it("host.pickDirectory 在 canceled 时返回 path=null", async () => {
      const { dialog } = await import("electron");
      (dialog.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ canceled: true, filePaths: [] });
      const result = await dispatchTypedRpc(rpc("host.pickDirectory"));
      expect(result).toEqual({ path: null });
    });

    it("host.listDirectory 缺少 shellFsHandlers serviceRef 时抛错（验证需要 mountFsLocal）", async () => {
      await expect(dispatchTypedRpc(rpc("host.listDirectory", { path: tempDir }))).rejects.toThrow();
    });

    it("host.createDirectory 拒绝包含路径分隔符的 name（验证真实参数校验）", async () => {
      // 即使 serviceRef 未初始化，参数校验也会先失败
      await expect(dispatchTypedRpc(rpc("host.createDirectory", { path: tempDir, name: "../escape" }))).rejects.toThrow();
    });
  });

  describe("RPC 请求校验", () => {
    it("无效 method（空字符串）→ throw", async () => {
      await expect(dispatchTypedRpc(rawRpc({ method: "", payload: {} }))).rejects.toThrow();
    });

    it("payload 非对象 → throw", async () => {
      await expect(dispatchTypedRpc(rawRpc({ method: "host.describe", payload: null }))).rejects.toThrow();
    });

    it("payload 是数组 → throw", async () => {
      await expect(dispatchTypedRpc(rawRpc({ method: "host.describe", payload: [] }))).rejects.toThrow();
    });

    it("payload 含未知字段（host.describe）→ throw", async () => {
      await expect(dispatchTypedRpc(rawRpc({ method: "host.describe", payload: { unknownField: 1 } }))).rejects.toThrow();
    });

    it("未注册的 method → throw", async () => {
      await expect(dispatchTypedRpc(rawRpc({ method: "unregistered.method", payload: {} }))).rejects.toThrow();
    });
  });

  describe("deepseek / plugin 路径返回合理对象或 null", () => {
    it("plugin.snapshot 不抛异常", async () => {
      const result = await dispatchTypedRpc(rpc("plugin.snapshot"));
      expect(result === null || typeof result === "object").toBe(true);
    });

    it("deepseek-cordis.snapshot 不抛异常", async () => {
      const result = await dispatchTypedRpc(rpc("deepseek-cordis.snapshot"));
      expect(result === null || typeof result === "object").toBe(true);
    });

    it("deepseek-pi.describe 不抛异常", async () => {
      const result = await dispatchTypedRpc(rpc("deepseek-pi.describe"));
      expect(result === null || typeof result === "object").toBe(true);
    });
  });

  describe("workspace / llm RPC 入口不抛异常（不验证 Pi session）", () => {
    it("workspace.list 不抛异常", async () => {
      const result = await dispatchTypedRpc(rpc("workspace.list"));
      expect(result === null || typeof result === "object").toBe(true);
    });

    it("llm.providers 不抛异常", async () => {
      const result = await dispatchTypedRpc(rpc("llm.providers"));
      expect(result === null || typeof result === "object" || Array.isArray(result)).toBe(true);
    });

    it("llm.models 不抛异常", async () => {
      const result = await dispatchTypedRpc(rpc("llm.models"));
      expect(result === null || typeof result === "object" || Array.isArray(result)).toBe(true);
    });
  });

});
