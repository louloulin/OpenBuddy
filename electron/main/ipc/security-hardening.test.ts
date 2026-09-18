import { beforeEach, describe, expect, it, vi } from "vitest";

const writeTextFile = vi.hoisted(() => vi.fn(async (path: string) => path));
const exportTextFile = vi.hoisted(() => vi.fn(async (path: string) => path));
const makeDirectory = vi.hoisted(() => vi.fn(async (path: string) => path));
const listDir = vi.hoisted(() => vi.fn(async (path: string, cwd: string) => [{ path, cwd }]));
const reveal = vi.hoisted(() => vi.fn(async (path: string, cwd: string) => ({ path, cwd })));
const openPath = vi.hoisted(() => vi.fn(async (path: string, cwd: string) => ({ path, cwd })));
const statPath = vi.hoisted(() => vi.fn(async (path: string, cwd: string) => ({ path, cwd })));
const cliAuth = vi.hoisted(() => vi.fn(async (root: string) => root));

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("@openbuddy/fs-fs-local", () => ({ shellFsHandlers: { writeTextFile, exportTextFile, makeDirectory, listDir, reveal, openPath, stat: statPath } }));
vi.mock("../connectors", async () => {
  const actual = await import("../connectors");
  return { ...actual, candidateRoots: (cwd: string) => ["/allowed/connectors", cwd], cliAuth };
});

const handlers = new Map<string, (event: unknown, args: unknown) => Promise<unknown>>();

vi.doMock("./agent-host-proxy", () => ({
  agentHost: { getCwd: () => "/workspace", waitUntilReady: async () => undefined },
  ensureAgentHostLoaded: async () => ({ getCwd: () => "/workspace", waitUntilReady: async () => undefined }),
  bindRendererEventEmitter: vi.fn(),
}));

vi.doMock("./validation", async () => await import("./validation"));
vi.doMock("../agent/pi-resources", () => ({ readStorageSources: async () => ["/workspace/storage"] }));

const { registerMiscIpc } = await import("./misc");
const { registerConnectorsIpc } = await import("./connectors");

describe("main-process file and connector containment", () => {
  it("rejects a write root that was not registered in the main process", async () => {
    registerMiscIpc(() => null);
    handlers.clear();
    const { ipcMain } = await import("electron");
    (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.forEach(([channel, handler]) => handlers.set(channel, handler));
    const handler = handlers.get("shellfs:write-text")!;
    await expect(handler({}, { path: "file.txt", content: "x", workspaceRoot: "/tmp" })).rejects.toThrow("workspaceRoot 必须是已注册的工作区");
    expect(writeTextFile).not.toHaveBeenCalled();
		await expect(handler({}, { path: "file.txt", content: "x", workspaceRoot: "/workspace/storage" })).resolves.toBe("file.txt");
		expect(writeTextFile).toHaveBeenCalledWith("file.txt", "x", expect.stringMatching(/\/workspace\/storage$/));
  });

  it("treats an explicit null cwd as \"use the host workspace\" on every shellfs channel", async () => {
    // 渲染进程统一发 `cwd ?? null`(JSON.stringify 会吃掉 undefined),但历史上
    // 只有一半 handler 接受这种写法 —— 另一半抛 "cwd must be a non-empty string",
    // 表现是整列文件树渲染成空态、「在文件夹中显示」静默失败。这条用例把契约
    // 钉在两处:null 与 undefined 必须等价,且都必须落到 agentHost 的工作区。
    registerMiscIpc(() => null);
    handlers.clear();
    const { ipcMain } = await import("electron");
    (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.forEach(([channel, handler]) => handlers.set(channel, handler));

    const listDirHandler = handlers.get("shellfs:list-dir")!;
    await expect(listDirHandler({}, { path: "/workspace/src", cwd: null })).resolves.toEqual([
      { path: "/workspace/src", cwd: "/workspace" },
    ]);
    await expect(listDirHandler({}, { path: "/workspace/src" })).resolves.toEqual([
      { path: "/workspace/src", cwd: "/workspace" },
    ]);
    await expect(listDirHandler({}, { path: "/workspace/src", cwd: "/elsewhere" })).resolves.toEqual([
      { path: "/workspace/src", cwd: "/elsewhere" },
    ]);

    for (const channel of ["shellfs:reveal", "shellfs:open-path", "shellfs:stat"]) {
      const handler = handlers.get(channel)!;
      await expect(handler({}, { path: "/workspace/a.md", cwd: null })).resolves.toEqual({
        path: "/workspace/a.md",
        cwd: "/workspace",
      });
    }
  });

  it("only permits connector commands inside main-process candidate roots", async () => {
    registerConnectorsIpc(() => null);
    handlers.clear();
    const { ipcMain } = await import("electron");
    (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.forEach(([channel, handler]) => handlers.set(channel, handler));
    const handler = handlers.get("connectors_cli_auth")!;
    await expect(handler({}, { root: "/tmp/evil", source: "github" })).rejects.toThrow("connector root 不在允许的连接器目录内");
    await expect(handler({}, { root: "/allowed/connectors/github", source: "github" })).resolves.toBe("/allowed/connectors/github");
  });
});
