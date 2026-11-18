import { describe, expect, it, vi } from "vitest";
import { handoff } from "../src/features/handoff";
import type { EngineContext } from "../src/engine-context";

function fakeEngine(options: { busy?: boolean } = {}) {
  const entries: Array<[string, unknown]> = [];
  const write = vi.fn();
  const metadata = vi.fn();
  const context = {
    slot: () => ({
      busy: options.busy ?? false,
      session: {
        sessionManager: { getCwd: () => "/work/project" },
        messages: [
          { role: "user", content: "帮我整理一个重构方案" },
          { role: "assistant", content: [{ type: "text", text: "先拆分协议层，再拆宿主。" }] },
          { role: "user", content: [{ type: "text", text: "把第二步展开" }] },
          { role: "assistant", content: "第二步包括宿主模块化和调度管线。" },
        ],
        sessionName: "重构方案",
      },
    }),
    settings: { config: { read: () => ({ sessions: { old: { title: "重构方案" } } }), write } },
    newSession: async () => "new-id",
    slots: new Map([["new-id", { session: { sessionManager: { appendCustomEntry: (type: string, data: unknown) => entries.push([type, data]) } } }]]),
    metadata,
    invalidateList: vi.fn(),
  } as unknown as EngineContext;
  return { context, entries, metadata };
}

describe("交接到新任务 (pii W1.7)", () => {
  it("opens a new session with a self-contained draft and keeps the old one untouched", async () => {
    const { context, entries, metadata } = fakeEngine();
    const result = await handoff(context, "old", "实现到团队版里");
    expect(result.sessionId).toBe("new-id");
    expect(result.from).toEqual({ sessionId: "old", title: "重构方案" });
    expect(result.prompt).toContain("## 背景接手（来自「重构方案」）");
    expect(result.prompt).toContain("- 帮我整理一个重构方案");
    expect(result.prompt).toContain("- 把第二步展开");
    expect(result.prompt).toContain("第二步包括宿主模块化和调度管线。");
    expect(result.prompt).toContain("## 下一步任务\n实现到团队版里");
    // Provenance lives in the session file and in the settings metadata (survives a reload).
    expect(entries[0][0]).toBe("openbuddy.handoff");
    expect(entries[0][1]).toMatchObject({ sessionId: "old", title: "重构方案", goal: "实现到团队版里" });
    expect(metadata).toHaveBeenCalledWith("new-id", {
      title: "交接 · 实现到团队版里",
      handoffFrom: { sessionId: "old", title: "重构方案" },
    });
  });

  it("refuses while the source session is running", async () => {
    const { context } = fakeEngine({ busy: true });
    await expect(handoff(context, "old", "继续")).rejects.toThrow(/session_busy/);
  });
});
