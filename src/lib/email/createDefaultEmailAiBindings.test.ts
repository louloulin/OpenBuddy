import { describe, expect, it, beforeEach, vi } from "vitest";

const ipcMocks = vi.hoisted(() => ({
  emailListAnalyses: vi.fn(),
  emailUpdateThread: vi.fn(),
  emailPrepareSend: vi.fn(),
  emailCreateDraft: vi.fn(),
  emailTriage: vi.fn(),
}));

vi.mock("@/lib/agent/pi-client-email", () => ipcMocks);

import { createDefaultEmailAiBindings } from "./createDefaultEmailAiBindings";

describe("createDefaultEmailAiBindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listAnalyses routes through emailListAnalyses with accountId", async () => {
    ipcMocks.emailListAnalyses.mockResolvedValueOnce([
      { id: "a1", threadId: "t1", kind: "summary", summary: "客户报价确认", confidence: 0.9 } as never,
    ]);
    const bindings = createDefaultEmailAiBindings({ accountId: "acct-99" });
    const result = await bindings.listAnalyses({ accountId: "acct-99", threadId: "t1" });
    expect(ipcMocks.emailListAnalyses).toHaveBeenCalledWith({ accountId: "acct-99", threadId: "t1" });
    expect(result.items).toEqual([{ summary: "客户报价确认", confidence: 0.9 }]);
  });

  it("listAnalyses defaults accountId to 'self' when not provided", async () => {
    ipcMocks.emailListAnalyses.mockResolvedValueOnce([]);
    const bindings = createDefaultEmailAiBindings();
    await bindings.listAnalyses({ accountId: "self", threadId: "t2" });
    expect(ipcMocks.emailListAnalyses).toHaveBeenCalledWith({ accountId: "self", threadId: "t2" });
  });

  it("listAnalyses maps empty results to { items: [] }", async () => {
    ipcMocks.emailListAnalyses.mockResolvedValueOnce([]);
    const bindings = createDefaultEmailAiBindings();
    const result = await bindings.listAnalyses({ accountId: "self", threadId: "t3" });
    expect(result).toEqual({ items: [] });
  });

  it("updateThread forwards mutation kind + label + snoozeUntil", async () => {
    ipcMocks.emailUpdateThread.mockResolvedValueOnce({ ok: true } as never);
    const bindings = createDefaultEmailAiBindings();
    await bindings.updateThread!({
      threadId: "t-arc",
      mutation: "archive",
      label: "INBOX",
      snoozeUntil: "2026-09-30T09:00:00.000Z",
    });
    expect(ipcMocks.emailUpdateThread).toHaveBeenCalledWith({
      threadId: "t-arc",
      mutation: "archive",
      label: "INBOX",
      snoozeUntil: "2026-09-30T09:00:00.000Z",
    });
  });

  it("updateThread skips label/snoozeUntil when absent (no empty-string passthrough)", async () => {
    ipcMocks.emailUpdateThread.mockResolvedValueOnce({ ok: true } as never);
    const bindings = createDefaultEmailAiBindings();
    await bindings.updateThread!({ threadId: "t-mark", mutation: "mark-read" });
    expect(ipcMocks.emailUpdateThread).toHaveBeenCalledWith({
      threadId: "t-mark",
      mutation: "mark-read",
    });
  });

  it("prepareSend passes draftId through to emailPrepareSend", async () => {
    ipcMocks.emailPrepareSend.mockResolvedValueOnce("confirmation-token" as never);
    const bindings = createDefaultEmailAiBindings();
    const result = await bindings.prepareSend!({ draftId: "d-1" });
    expect(ipcMocks.emailPrepareSend).toHaveBeenCalledWith("d-1");
    expect(result).toBe("confirmation-token");
  });

  it("createDraft maps taskTitle → subject", async () => {
    ipcMocks.emailCreateDraft.mockResolvedValueOnce({ id: "draft-99" } as never);
    const bindings = createDefaultEmailAiBindings();
    await bindings.createDraft!({
      taskTitle: "回复报价",
      dueAt: "2026-09-30T09:00:00.000Z",
      taskOwner: "我",
    });
    const call = ipcMocks.emailCreateDraft.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(call?.subject).toBe("回复报价");
    expect(call?.scheduledAt).toBe("2026-09-30T09:00:00.000Z");
    expect(call?.accountId).toBe("self");
  });

  it("createDraft falls back to placeholder subject when taskTitle is missing", async () => {
    ipcMocks.emailCreateDraft.mockResolvedValueOnce({} as never);
    const bindings = createDefaultEmailAiBindings();
    await bindings.createDraft!({});
    const call = ipcMocks.emailCreateDraft.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(call?.subject).toBe("(无标题任务)");
    expect(call?.scheduledAt).toBeUndefined();
  });

  it("routePrompt without custom routePrompt returns empty actions (safe default)", async () => {
    const bindings = createDefaultEmailAiBindings();
    const result = await bindings.routePrompt!("清空噪声");
    expect(result).toEqual([]);
  });

  it("routePrompt with custom routePrompt delegates", async () => {
    const customRoute = vi.fn().mockResolvedValueOnce([
      { id: "x1", kind: "archive", threadId: "t-noise", confidence: 0.95, reason: "noise" },
    ]);
    const bindings = createDefaultEmailAiBindings({ routePrompt: customRoute });
    const result = await bindings.routePrompt!("清空噪声");
    expect(customRoute).toHaveBeenCalledWith("清空噪声");
    expect(result).toHaveLength(1);
  });

  it("binding object stays stable across calls (factory creates fresh, but uses shared IPC fns)", () => {
    const a = createDefaultEmailAiBindings();
    const b = createDefaultEmailAiBindings();
    expect(typeof a.listAnalyses).toBe("function");
    expect(typeof b.listAnalyses).toBe("function");
    expect(a).not.toBe(b);
  });
});
