/**
 * 20261031 Phase 1.9 — 模型写入记忆前先让用户确认;无确认通道(自动化等无界面运行)照常写入。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ added: [] as unknown[] }));
vi.mock("../../memory/memory-store", () => ({
  addMemory: vi.fn(async (input: { title: string; scope: string }) => {
    store.added.push(input);
    return { id: "m-1", ...input };
  }),
  recallMemories: vi.fn(async () => []),
}));

import openBuddyMemory, { MEMORY_CONFIRM_TITLE } from "./memory";

type Tool = { name: string; execute: (...args: unknown[]) => Promise<{ details: Record<string, unknown> }> };

function saveTool(): Tool {
  const tools: Tool[] = [];
  openBuddyMemory({ cwd: "/w" })({ registerTool: (t: Tool) => tools.push(t) } as never);
  return tools.find((t) => t.name === "memory_save")!;
}

describe("memory_save confirmation", () => {
  beforeEach(() => {
    store.added.length = 0;
  });

  it("用户确认后才写入,确认卡展示标题与正文", async () => {
    const confirm = vi.fn(async (_title: string, _message: string) => true);
    const result = await saveTool().execute("c1", { title: "回答用中文", body: "所有回复使用简体中文" }, undefined, undefined, { ui: { confirm } });
    expect(confirm).toHaveBeenCalledWith(MEMORY_CONFIRM_TITLE, expect.stringContaining("回答用中文"));
    expect(confirm.mock.calls[0][1]).toContain("所有回复使用简体中文");
    expect(result.details.saved).toBe(true);
    expect(store.added).toHaveLength(1);
  });

  it("用户拒绝则不写入", async () => {
    const result = await saveTool().execute("c1", { title: "x" }, undefined, undefined, { ui: { confirm: async () => false } });
    expect(result.details).toMatchObject({ saved: false, declined: true });
    expect(store.added).toHaveLength(0);
  });

  it("无确认通道时照常写入", async () => {
    const result = await saveTool().execute("c1", { title: "x" });
    expect(result.details.saved).toBe(true);
    expect(store.added).toHaveLength(1);
  });
});
