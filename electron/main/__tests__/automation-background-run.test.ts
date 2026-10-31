// @vitest-environment node
/**
 * 计划 0.3 — 自动化在后台独立会话里运行,不碰前台会话。
 *
 * 以前的执行器走 `newSession` → `replace()`:用户正在看的会话被换掉,随后
 * 发消息直接报「Pi session is not loaded」;用户回合进行中还只能拒绝运行。
 * 这里钉住新的契约:
 *   - 只调用后台运行器(没有 newSession / prompt 可调);
 *   - 运行记录关联到后台会话 id,摘要来自模型的回答;
 *   - 失败如实记为 failed,原因去掉 "Error:" 前缀。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const { registry } = vi.hoisted(() => ({ registry: new Map<string, Handler>() }));

vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.0-test", getPath: () => "/tmp", on: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => { registry.set(channel, handler); }),
    removeHandler: vi.fn(),
  },
}));
vi.mock("../memory/memory-store", () => ({ addMemory: vi.fn(async () => undefined) }));

let tempDir = "";
const runBackground = vi.fn();

function call<T = unknown>(channel: string, args?: unknown): Promise<T> {
  const handler = registry.get(channel);
  if (!handler) return Promise.reject(new Error(`no handler for ${channel}`));
  return Promise.resolve(handler({}, args) as T);
}

async function saveAutomation(name: string): Promise<string> {
  const saved = await call<{ id: string }>("automations_save", {
    automation: { name, prompt: "整理今天的待办", cwds: tempDir, status: "PAUSED", modelId: "demo/demo-model" },
  });
  return saved.id;
}

async function recordFor(runId: string) {
  const snap = await call<{ records: Array<{ id: string; status: string; sessionId?: string; summary?: string }> }>(
    "automations_snapshot",
  );
  return snap.records.find((record) => record.id === runId);
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-automation-bg-"));
  process.env.PI_HOME = tempDir;
  process.env.PI_CODING_AGENT_DIR = tempDir;
  const { registerAutomationIpc } = await import("../ipc/automations");
  const { stopAutomationScheduler } = await import("../automation/automation-store");
  registerAutomationIpc({
    ensureAgentHost: async () => undefined,
    agentHost: { getCwd: () => tempDir },
    runBackground,
  });
  stopAutomationScheduler();
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("automations_run 走后台独立会话", () => {
  it("调用后台运行器,运行记录关联会话并以回答作摘要", async () => {
    runBackground.mockImplementationOnce(async (input: { onSession?: (id: string) => Promise<void> }) => {
      await input.onSession?.("bg-session-1");
      return { sessionId: "bg-session-1", text: "已整理 3 条待办。" };
    });
    const id = await saveAutomation("每日待办");
    const { runId } = await call<{ runId: string }>("automations_run", { id });

    expect(runBackground).toHaveBeenCalledTimes(1);
    const input = runBackground.mock.calls[0]![0] as { cwd: string; name: string; modelId?: string; prompt: string };
    expect(input.cwd).toBe(tempDir);
    expect(input.name).toBe("自动化：每日待办");
    expect(input.modelId).toBe("demo/demo-model");
    expect(input.prompt).toContain("整理今天的待办");

    const record = await recordFor(runId);
    expect(record).toMatchObject({ status: "success", sessionId: "bg-session-1", summary: "已整理 3 条待办。" });
  });

  it("运行失败如实记为 failed,并把原因写进记录", async () => {
    runBackground.mockRejectedValueOnce(new Error("找不到模型 demo/demo-model"));
    const id = await saveAutomation("会失败的任务");
    await expect(call("automations_run", { id })).rejects.toThrow("找不到模型");

    const snap = await call<{ records: Array<{ automationId: string; status: string; summary?: string }> }>(
      "automations_snapshot",
    );
    const record = snap.records.find((item) => item.automationId === id);
    expect(record).toMatchObject({ status: "failed", summary: "找不到模型 demo/demo-model" });
  });
});
