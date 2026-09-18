/**
 * `sessions:rename` 必须把 cwd 转发给 host —— 回归守卫。
 *
 * 背景(R91):`agentHost.renameSession(sessionId, title, cwd)` 用 cwd 去
 * `SessionManager.list(cwd, piSessionDir(cwd))` 里定位会话文件。这条 IPC
 * handler 之前只传了 `(sessionId, title)`,第三个参数是 `undefined`,于是
 * `SessionManager.open(undefined)` 在 node:path 里炸:
 *
 *   TypeError [ERR_INVALID_ARG_TYPE]: The "paths[0]" argument must be of
 *   type string. Received undefined
 *
 * 用户可见后果:**任何**重命名都失败 —— 侧边栏右键改名、专家召唤后的会话
 * 命名、WorkBuddy 导入的会话落名。而且因为它只在 IPC 边界炸,单测里直接调
 * `renameSession` 是绿的,所以一直没被抓到。
 *
 * 这个测试用假的 agentHost 驱动真实 handler,断言第三参不是 undefined。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, args: unknown) => Promise<unknown>;

const handlers = new Map<string, Handler>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
  },
}));

vi.mock("../../agent/agent-host-log", () => ({
  hostDispatched: vi.fn(),
  hostFailed: vi.fn(),
  hostReceived: vi.fn(),
}));

const { registerSessionsIpc } = await import("../sessions");

function loadHandler(overrides: Partial<Record<string, unknown>> = {}) {
  handlers.clear();
  const agentHost = {
    getCwd: () => "/tmp/fallback-cwd",
    listSessions: vi.fn(async () => []),
    listWorkspaces: vi.fn(async () => []),
    renameSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    ...overrides,
  };
  registerSessionsIpc({
    agentHost,
    casdoorAuth: { authorize: vi.fn() },
    ensureAgentHost: vi.fn(async () => undefined),
  } as never);
  return { agentHost, handler: handlers.get("sessions:rename")! };
}

describe("sessions:rename 转发 cwd (R91)", () => {
  beforeEach(() => { handlers.clear(); });

  it("payload 带 cwd 时原样转发", async () => {
    const { agentHost, handler } = loadHandler();
    await handler({}, { sessionId: "s-1", title: "新标题", cwd: "/tmp/ws" });
    expect(agentHost.renameSession).toHaveBeenCalledWith("s-1", "新标题", "/tmp/ws");
  });

  it("cwd 为 null 时回落到 host 当前目录,绝不传 undefined", async () => {
    const { agentHost, handler } = loadHandler();
    await handler({}, { sessionId: "s-2", title: "标题", cwd: null });
    const call = (agentHost.renameSession as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[2]).toBe("/tmp/fallback-cwd");
    expect(call[2]).not.toBeUndefined();
    expect(call[2]).not.toBeNull();
  });

  it("payload 完全省略 cwd 时也回落到 host 当前目录", async () => {
    const { agentHost, handler } = loadHandler();
    await handler({}, { sessionId: "s-3", title: "标题" });
    const call = (agentHost.renameSession as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[2]).toBe("/tmp/fallback-cwd");
  });

  it("三个位置参数都是字符串 —— 直接对着崩溃现场断言", async () => {
    const { agentHost, handler } = loadHandler();
    await handler({}, { sessionId: "s-4", title: "标题", cwd: "/tmp/ws" });
    const call = (agentHost.renameSession as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call).toHaveLength(3);
    for (const [index, value] of call.entries()) {
      expect(typeof value, `arg[${index}] should be a string, got ${String(value)}`).toBe("string");
    }
  });

  it("缺少 sessionId / title 仍然抛错(原有校验不回退)", async () => {
    const { handler } = loadHandler();
    await expect(handler({}, { title: "没有 id" })).rejects.toThrow();
    await expect(handler({}, { sessionId: "s-5" })).rejects.toThrow();
  });
});
