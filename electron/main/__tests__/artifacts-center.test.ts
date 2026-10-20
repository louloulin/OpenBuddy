// @vitest-environment node
/**
 * 阶段 5 产物中心:artifacts:* IPC 在真实注册表上的端到端。
 *
 * 快照数据用 rewind 快照存储自己的文件格式写入(临时 PI home),验证
 * index 聚合 / history 过滤 / restore 走既有恢复实现 / diff 出文本。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

interface CapturedHandler {
  channel: string;
  fn: (event: unknown, ...args: unknown[]) => unknown;
}
const { registry } = vi.hoisted(() => {
  const registry = new Map<string, CapturedHandler>();
  (globalThis as unknown as { __artifactsRegistry: typeof registry }).__artifactsRegistry = registry;
  return { registry };
});

vi.mock("electron", () => {
  const reg = (globalThis as unknown as { __artifactsRegistry: Map<string, CapturedHandler> }).__artifactsRegistry;
  return {
    app: { getVersion: () => "0.0.0-test", getPath: (key: string) => (key === "userData" ? "/tmp/openbuddy-artifacts-test" : "/tmp"), on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: CapturedHandler["fn"]) => { reg.set(channel, { channel, fn: handler }); }),
      removeHandler: vi.fn((channel: string) => { reg.delete(channel); }),
      on: vi.fn(), removeListener: vi.fn(), removeAllListeners: vi.fn(),
    },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: vi.fn() },
    BrowserWindow: vi.fn(),
    dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
    clipboard: { writeText: vi.fn(), readText: vi.fn().mockReturnValue("") },
  };
});

let tempDir = "";
const SESSION = "session-artifacts";

function call<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = registry.get(channel);
  if (!handler) return Promise.reject(new Error(`no handler registered for ${channel}`));
  return Promise.resolve(handler.fn({}, ...args) as T);
}

/** 直接写快照存储(格式与 rewind-snapshot.ts 一致),不走捕获路径。 */
async function seedSnapshots(): Promise<void> {
  const payload = {
    sessions: {
      [SESSION]: {
        "prompt-1": [
          { toolCallId: "tc-1", promptId: "prompt-1", tool: "write", path: "/repo/a.txt", exists: true, content: "v1\n", capturedAt: 1000 },
        ],
        "prompt-2": [
          { toolCallId: "tc-2", promptId: "prompt-2", tool: "edit", path: "/repo/a.txt", exists: true, content: "v2\n", capturedAt: 2000 },
          { toolCallId: "tc-3", promptId: "prompt-2", tool: "write", path: "/repo/b.txt", exists: true, content: "b1\n", capturedAt: 2100 },
        ],
      },
    },
  };
  await writeFile(join(tempDir, "openbuddy-rewind-snapshots.json"), JSON.stringify(payload), "utf8");
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-artifacts-"));
  process.env.PI_HOME = tempDir;
  process.env.PI_CODING_AGENT_DIR = tempDir;
  await seedSnapshots();
  const ipc = await import("../ipc/index");
  await ipc.registerIpc(() => null);
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("artifacts IPC", () => {
  it("index 按文件聚合:revisions / 工具 / 时间线边界", async () => {
    const result = await call<{
      artifacts: Array<{ path: string; revisions: number; tools: string[]; lastTouchedAt: number }>;
      total: number;
    }>("artifacts:index", { sessionId: SESSION });
    expect(result.total).toBe(3);
    const a = result.artifacts.find((item) => item.path === "/repo/a.txt");
    expect(a?.revisions).toBe(2);
    expect([...(a?.tools ?? [])].sort()).toEqual(["edit", "write"]);
    // 最近改过的排前面。
    expect(result.artifacts[0].path).toBe("/repo/b.txt");
  });

  it("history 只回该文件的版本,按时间倒序,带字节数", async () => {
    const result = await call<{ versions: Array<{ tool: string; bytes: number; capturedAt: number }> }>(
      "artifacts:history",
      { sessionId: SESSION, path: "/repo/a.txt" },
    );
    expect(result.versions).toHaveLength(2);
    expect(result.versions[0].tool).toBe("edit");
    expect(result.versions[0].bytes).toBe(3);
  });

  it("history 缺参数 → throw", async () => {
    await expect(call("artifacts:history", { sessionId: SESSION })).rejects.toThrow();
    await expect(call("artifacts:index", {})).rejects.toThrow();
  });

  it("diff 产出 unified 文本(当前文件不存在时表现为整段删除)", async () => {
    const result = await call<{ path: string; patch: string }>("artifacts:diff", {
      path: "/repo/a.txt",
      content: "v1\n",
    });
    expect(result.path).toBe("/repo/a.txt");
    expect(result.patch).toContain("--- a//repo/a.txt");
    expect(result.patch).toContain("+");
  });

  it("restore 缺 promptId → throw", async () => {
    await expect(call("artifacts:restore", { sessionId: SESSION })).rejects.toThrow();
  });
});