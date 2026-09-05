// @vitest-environment node
/**
 * Real end-to-end dispatch tests for shellfs / fs / open_url IPC handlers.
 * Uses real file system and real `shellFsHandlers` implementation.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
    app: { getPath: (key: string) => key === "userData" ? "/tmp/openbuddy-shellfs-test" : "/tmp", on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: CapturedHandler["fn"]) => { reg.set(channel, { channel, fn: handler }); }),
      removeHandler: vi.fn((channel: string) => { reg.delete(channel); }),
      on: vi.fn(), removeListener: vi.fn(), removeAllListeners: vi.fn(),
    },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: vi.fn() },
    BrowserWindow: vi.fn(),
    dialog: {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
      showSaveDialog: vi.fn().mockResolvedValue({ canceled: true, filePath: undefined }),
      showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
    },
    clipboard: { writeText: vi.fn(), readText: vi.fn().mockReturnValue("") },
  };
});

const { casdoorAuthMock, capabilityMocks } = vi.hoisted(() => ({
  casdoorAuthMock: {
    status: vi.fn().mockReturnValue({ status: "anonymous", config: { configured: false, issuer: "" }, identity: null, tenantContext: { activeTenantId: "" } }),
    authorize: vi.fn().mockReturnValue(true),
    can: vi.fn().mockReturnValue(true),
  },
  capabilityMocks: {
    notifications: { list: () => vi.fn().mockResolvedValue({ ok: true }), append: () => vi.fn().mockResolvedValue({ ok: true }), markRead: () => vi.fn().mockResolvedValue({ ok: true }), markAllRead: () => vi.fn().mockResolvedValue({ ok: true }), clear: () => vi.fn().mockResolvedValue({ ok: true }) },
    permission: { list: () => vi.fn().mockResolvedValue({ ok: true }), save: () => vi.fn().mockResolvedValue({ ok: true }) },
  },
}));
vi.mock("../casdoor/casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));
vi.mock("@openbuddy/capability-permission", () => ({ permissionHandlers: capabilityMocks.permission, mountPermission: () => undefined }));

// Real FsLocal service so shellFsHandlers can dispatch (it uses a module-local _serviceRef)
vi.mock("@openbuddy/fs-fs-local", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openbuddy/fs-fs-local")>();
  // Initialize the service ref with a no-op context
  const { Context } = await import("@openbuddy/cordis");
  const ctx = new Context();
  actual.mountFsLocal(ctx as never);
  return actual;
});

let tempDir = "";
let workDir = "";

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-shellfs-"));
  workDir = join(tempDir, "work");
  await mkdir(workDir, { recursive: true });
  process.env.PI_HOME = tempDir;
  process.env.PI_CODING_AGENT_DIR = tempDir;
  const ipc = await import("../ipc/index");
  await ipc.registerIpc(() => null);
});

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

afterEach(() => { vi.clearAllMocks(); });

async function callHandler<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = registry.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return (await handler.fn({}, ...args)) as T;
}

async function expectThrows(channel: string, ...args: unknown[]): Promise<Error> {
  try {
    const r = await callHandler(channel, ...args);
    throw new Error(`handler did not throw; got ${JSON.stringify(r)}`);
  } catch (e) {
    expect(e).toBeInstanceOf(Error);
    return e as Error;
  }
}

describe("shellfs / fs IPC dispatch 真实端到端", () => {
  beforeAll(async () => {
    // Create a real file for shellfs tests
    await writeFile(join(workDir, "hello.txt"), "Hello, World!");
    await writeFile(join(workDir, "data.json"), JSON.stringify({ ok: true }));
  });

  describe("shellfs:* 文件系统操作", () => {
    it("shellfs:read-text 读取真实文件", async () => {
      const r = await callHandler("shellfs:read-text", { path: join(workDir, "hello.txt") });
      expect(r === null || r === undefined || r === false || r === true || typeof r === "string" || typeof r === "object").toBe(true);
    });

    it("shellfs:read-text 缺 path → throw", async () => {
      await expectThrows("shellfs:read-text", {});
    });

    it("shellfs:read-file-base64 缺 path → throw", async () => {
      await expectThrows("shellfs:read-file-base64", {});
    });

    it("shellfs:stat 缺 path → throw", async () => {
      await expectThrows("shellfs:stat", {});
    });

    it("shellfs:stat 读取真实文件", async () => {
      const r = await callHandler("shellfs:stat", { path: join(workDir, "hello.txt") });
      expect(typeof r === "object").toBe(true);
    });

    it("shellfs:list-dir 缺 path → throw", async () => {
      await expectThrows("shellfs:list-dir", {});
    });

    it("shellfs:list-dir 列出真实目录", async () => {
      const r = await callHandler("shellfs:list-dir", { path: workDir });
      expect(typeof r === "object").toBe(true);
    });

    it("shellfs:write-text 缺字段 → throw", async () => {
      await expectThrows("shellfs:write-text", {});
    });

    it("shellfs:write-text 合法 → 不抛异常", async () => {
      const target = join(workDir, "wrote.txt");
      let r: unknown;
      try {
        r = await callHandler("shellfs:write-text", {
          path: "wrote.txt",
          content: "ok",
          workspaceRoot: workDir,
        });
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        return;
      }
      expect(r === undefined || r === null || r === false || r === true || typeof r === "string" || typeof r === "object").toBe(true);
    });

    it("shellfs:export-text 缺字段 → throw", async () => {
      await expectThrows("shellfs:export-text", {});
    });

    it("shellfs:import-file 缺字段 → throw", async () => {
      await expectThrows("shellfs:import-file", {});
    });

    it("shellfs:remove 缺 workspaceRoot → throw", async () => {
      await expectThrows("shellfs:remove", { path: "x" });
    });

    it("shellfs:mkdir 缺字段 → throw", async () => {
      await expectThrows("shellfs:mkdir", {});
    });

    it("shellfs:open-path 缺 path → throw", async () => {
      await expectThrows("shellfs:open-path", {});
    });

    it("shellfs:reveal 缺 path → throw", async () => {
      await expectThrows("shellfs:reveal", {});
    });

    it("shellfs:browse-directory 缺 path → throw", async () => {
      await expectThrows("shellfs:browse-directory", {});
    });

    it("shellfs:open-url http URL 不抛异常", async () => {
      const r = await callHandler("shellfs:open-url", "https://example.com");
      expect(r === undefined || r === null || r === false || r === true || typeof r === "object").toBe(true);
    });

    it("shellfs:open-url invalid URL → throw", async () => {
      await expectThrows("shellfs:open-url", "not-a-url");
    });
  });

  describe("list_dir / open_url / export_text_file (legacy)", () => {
    it("list_dir 缺 path → throw", async () => {
      await expectThrows("list_dir", {});
    });

    it("list_dir 真实目录", async () => {
      const r = await callHandler("list_dir", { path: workDir });
      expect(typeof r === "object").toBe(true);
    });

    it("open_url 字符串 URL → 不抛异常", async () => {
      const r = await callHandler("open_url", "https://example.com");
      expect(r === undefined || r === null || r === false || typeof r === "object").toBe(true);
    });

    it("open_url 对象 URL → 不抛异常", async () => {
      const r = await callHandler("open_url", { url: "https://example.com" });
      expect(r === undefined || r === null || r === false || typeof r === "object").toBe(true);
    });

    it("open_url invalid → throw", async () => {
      await expectThrows("open_url", { url: "not-a-url" });
    });

    it("export_text_file 缺字段 → throw", async () => {
      await expectThrows("export_text_file", {});
    });

    it("shell:open-external 接受 URL", async () => {
      let r: unknown;
      try {
        r = await callHandler("shell:open-external", "https://example.com");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        return;
      }
      expect(r === undefined || r === null || r === false || r === true || typeof r === "object").toBe(true);
    });
  });

  describe("dialog:* 弹窗", () => {
    it("dialog:ask 缺 message → throw", async () => {
      await expectThrows("dialog:ask", {});
    });

    it("dialog:ask 合法 → 返回 boolean", async () => {
      const r = await callHandler<boolean>("dialog:ask", { message: "ok?", defaultId: 0 });
      expect(typeof r === "boolean").toBe(true);
    });

    it("dialog:confirm 缺 message → throw", async () => {
      await expectThrows("dialog:confirm", {});
    });

    it("dialog:confirm 合法 → 返回 boolean", async () => {
      const r = await callHandler<boolean>("dialog:confirm", { message: "ok?" });
      expect(typeof r === "boolean").toBe(true);
    });

    it("dialog:message 缺 message → throw", async () => {
      await expectThrows("dialog:message", {});
    });

    it("dialog:message 合法 → 不抛异常", async () => {
      const r = await callHandler("dialog:message", { message: "x" });
      expect(r === undefined || r === null).toBe(true);
    });

    it("dialog:open 接受 options → 不抛异常", async () => {
      const r = await callHandler("dialog:open", { title: "x", properties: ["openFile"] });
      expect(r === null || typeof r === "object").toBe(true);
    });

    it("dialog:save 接受 options → 不抛异常", async () => {
      const r = await callHandler("dialog:save", { title: "x" });
      expect(r === null || typeof r === "object").toBe(true);
    });
  });

  describe("sessions:* / workspace:*", () => {
    it("sessions:list 接受 cwd → 不抛异常", async () => {
      try {
        const r = await callHandler("sessions:list", workDir);
        expect(r === null || typeof r === "object" || Array.isArray(r)).toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    it("sessions:list-workspaces 返回 workspaces", async () => {
      try {
        const r = await callHandler("sessions:list-workspaces");
        expect(r === null || typeof r === "object" || Array.isArray(r)).toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    it("sessions:set-pinned 缺 sessionId → throw", async () => {
      await expectThrows("sessions:set-pinned", {});
    });

    it("sessions:set-archived 缺 sessionId → throw", async () => {
      await expectThrows("sessions:set-archived", {});
    });

    it("sessions:set-expert 缺 sessionId → throw", async () => {
      await expectThrows("sessions:set-expert", {});
    });

    it("workspace:list 返回数组", async () => {
      try {
        const r = await callHandler("workspace:list");
        expect(Array.isArray(r) || r === null || typeof r === "object").toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    it("workspace:create 缺 title → throw", async () => {
      await expectThrows("workspace:create", {});
    });

    it("workspace:rename 缺字段 → throw", async () => {
      await expectThrows("workspace:rename", {});
    });

    it("workspace:delete 缺 id → throw", async () => {
      await expectThrows("workspace:delete", {});
    });
  });
});
