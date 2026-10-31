/**
 * 20261031 Phase 1.5 — 每次工具调用写一条审计记录(参数只存哈希)。
 */
import { describe, expect, it, vi } from "vitest";
import { createToolAudit, hashToolArgs } from "./tool-audit";

describe("toolAudit", () => {
  it("start → end 写一条带耗时与参数哈希的记录", async () => {
    const record = vi.fn(async () => undefined);
    let t = 1000;
    const audit = createToolAudit(record, () => t);
    audit.start("c1", "bash", "s1", { command: "ls" });
    t = 1250;
    audit.end("c1", false);
    expect(record).toHaveBeenCalledWith({
      event: "tool.call",
      outcome: "success",
      source: "main",
      subject: "bash",
      detail: { sessionId: "s1", toolCallId: "c1", durationMs: 250, argsHash: hashToolArgs({ command: "ls" }) },
    });
  });

  it("失败记为 failure;参数原文不出现在记录里", () => {
    const record = vi.fn(async (_entry: unknown) => undefined);
    const audit = createToolAudit(record);
    audit.start("c2", "write", "s1", { content: "SECRET-TOKEN" });
    audit.end("c2", true);
    const entry = record.mock.calls[0][0] as { outcome: string };
    expect(entry.outcome).toBe("failure");
    expect(JSON.stringify(entry)).not.toContain("SECRET-TOKEN");
  });

  it("没有对应 start 的 end 不记录;记录失败不抛", async () => {
    const audit = createToolAudit(async () => {
      throw new Error("disk full");
    });
    audit.end("unknown", false);
    audit.start("c3", "read", "s1", {});
    expect(() => audit.end("c3", false)).not.toThrow();
  });
});
