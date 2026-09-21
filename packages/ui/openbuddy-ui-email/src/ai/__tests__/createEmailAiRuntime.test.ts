import { describe, expect, it, vi } from "vitest";
import { createEmailAiRuntime, createEmailDataProvider, type CreateEmailAiRuntimeInputs } from "../createEmailAiRuntime";
import type { AiAction, AiActionReceipt } from "../types";

function makeInputs(overrides: Partial<CreateEmailAiRuntimeInputs> = {}): CreateEmailAiRuntimeInputs {
  return {
    listAccounts: overrides.listAccounts ?? vi.fn().mockResolvedValue([]),
    threadsPage: overrides.threadsPage ?? vi.fn().mockResolvedValue({ items: [] }),
    counts: overrides.counts ?? vi.fn().mockResolvedValue({ today: 0, later: 0, done: 0, inbox: 0, drafts: 0, scheduled: 0, snoozed: 0 }),
    listAnalyses: overrides.listAnalyses ?? vi.fn().mockResolvedValue({ items: [] }),
    updateThread: overrides.updateThread ?? vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe("createEmailAiRuntime", () => {
  it("summarize reads from listAnalyses cache", async () => {
    const inputs = makeInputs({
      listAnalyses: vi.fn().mockResolvedValue({ items: [{ summary: "缓存摘要", confidence: 0.95 }] }),
    });
    const runtime = createEmailAiRuntime(inputs);
    const summary = await runtime.summarize("t1");
    expect(summary.oneLiner).toBe("缓存摘要");
    expect(summary.confidence).toBe(0.95);
  });

  it("summarize falls back to generateSummary when cache empty", async () => {
    const inputs = makeInputs({
      listAnalyses: vi.fn().mockResolvedValue({ items: [] }),
      generateSummary: vi.fn().mockResolvedValue({
        threadId: "t1",
        oneLiner: "LLM 生成",
        keyPoints: ["p1"], actionItems: [], confidence: 0.9,
        citations: [], generatedAt: "2026-09-21",
      }),
    });
    const runtime = createEmailAiRuntime(inputs);
    const summary = await runtime.summarize("t1");
    expect(summary.oneLiner).toBe("LLM 生成");
  });

  it("summarize returns placeholder when nothing available", async () => {
    const inputs = makeInputs();
    const runtime = createEmailAiRuntime(inputs);
    const summary = await runtime.summarize("t1");
    expect(summary.oneLiner).toContain("尚未生成");
  });

  it("execute calls updateThread for archive action (IPC spy)", async () => {
    const updateThread = vi.fn().mockResolvedValue({});
    const inputs = makeInputs({ updateThread });
    const runtime = createEmailAiRuntime(inputs);
    const action: AiAction = { id: "a1", kind: "archive", threadId: "t1", confidence: 0.9, reason: "" };
    const receipts = await runtime.execute([action]);
    expect(updateThread).toHaveBeenCalledWith({ accountId: "self", threadId: "t1", kind: "archive" });
    expect(receipts[0].status).toBe("executed");
  });

  it("execute calls updateThread for snooze with snoozeUntil", async () => {
    const updateThread = vi.fn().mockResolvedValue({});
    const inputs = makeInputs({ updateThread });
    const runtime = createEmailAiRuntime(inputs);
    await runtime.execute([
      { id: "a1", kind: "snooze", threadId: "t1", confidence: 0.9, reason: "", snoozeUntil: "2026-09-30" },
    ]);
    expect(updateThread).toHaveBeenCalledWith({
      accountId: "self", threadId: "t1", kind: "snooze", snoozeUntil: "2026-09-30",
    });
  });

  it("execute captures failures as receipts", async () => {
    const updateThread = vi.fn().mockRejectedValue(new Error("403"));
    const inputs = makeInputs({ updateThread });
    const runtime = createEmailAiRuntime(inputs);
    const receipts = await runtime.execute([
      { id: "a1", kind: "archive", threadId: "t1", confidence: 0.9, reason: "" },
    ]);
    expect(receipts[0].status).toBe("failed");
    expect(receipts[0].reason).toContain("403");
  });

  it("plan delegates to routePrompt", async () => {
    const routePrompt = vi.fn().mockImplementation(async () => [
      { id: "a1", kind: "archive", threadId: "t1", confidence: 0.9, reason: "" },
    ]);
    const inputs = makeInputs({ routePrompt });
    const runtime = createEmailAiRuntime(inputs);
    const actions = await runtime.plan("归档噪声", ["t1"]);
    expect(actions).toHaveLength(1);
    expect(routePrompt).toHaveBeenCalledWith("归档噪声");
  });

  it("plan falls back to mark-read when no routePrompt", async () => {
    const inputs = makeInputs();
    inputs.routePrompt = undefined;
    const runtime = createEmailAiRuntime(inputs);
    const actions = await runtime.plan("x", ["t1", "t2"]);
    expect(actions.every((a: AiAction) => a.kind === "mark-read")).toBe(true);
  });

  it("undo calls undoAction for each executed receipt", async () => {
    const undoAction = vi.fn().mockResolvedValue(undefined);
    const inputs = makeInputs({ undoAction });
    const runtime = createEmailAiRuntime(inputs);
    const receipts: AiActionReceipt[] = [
      { actionId: "a1", threadId: "t1", kind: "archive", status: "executed" },
      { actionId: "a2", threadId: "t2", kind: "snooze", status: "failed" },
    ];
    await runtime.undo(receipts);
    expect(undoAction).toHaveBeenCalledTimes(1);
    expect(undoAction).toHaveBeenCalledWith(receipts[0]);
  });
});

describe("createEmailDataProvider", () => {
  it("listThreads forwards filters and returns items", async () => {
    const inputs = makeInputs({
      threadsPage: vi.fn().mockResolvedValue({
        items: [
          { id: "t1", accountId: "a1", subject: "Q4", from: { name: "Lin", address: "lin@x" }, date: "2026-09-21", unread: true, messageCount: 1, labels: [] },
        ],
      }),
    });
    const provider = createEmailDataProvider(inputs);
    const threads = await provider.listThreads({ view: "today", folder: "inbox" });
    expect(threads).toHaveLength(1);
    expect(inputs.threadsPage).toHaveBeenCalledWith({ view: "today", folder: "inbox" });
  });

  it("triage maps categories to chips", async () => {
    const inputs = makeInputs({
      triage: vi.fn().mockResolvedValue({
        items: [
          { threadId: "t1", categories: ["urgent", "needs-reply"] },
          { threadId: "t2", categories: ["noise"] },
        ],
      }),
    });
    const provider = createEmailDataProvider(inputs);
    const chips = await provider.triage!({});
    expect(chips.t1).toContain("priority");
    expect(chips.t1).toContain("reply");
    expect(chips.t2).toContain("muted");
  });
});
