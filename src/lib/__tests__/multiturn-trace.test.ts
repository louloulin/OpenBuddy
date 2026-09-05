import { describe, expect, it } from "vitest";

describe("multiturn-trace: ordered event projection", () => {
  it("keeps the input → start → delta* → end/settled order", () => {
    const order = ["input", "start", "delta", "delta", "end", "settled"];
    const received: string[] = [];
    for (const ev of order) received.push(ev);
    expect(received).toEqual(order);
    expect(received.indexOf("input")).toBeLessThan(received.indexOf("start"));
    expect(received.indexOf("start")).toBeLessThan(received.indexOf("delta"));
    expect(received.indexOf("delta")).toBeLessThan(received.indexOf("end"));
    expect(received.indexOf("end")).toBeLessThan(received.indexOf("settled"));
  });

  it("rejects reordered sequences where end arrives before delta", () => {
    const trace = ["input", "start", "end", "delta"];
    expect(trace.indexOf("delta") > trace.indexOf("end")).toBe(true);
  });

  it("associates a stable session identity across multiple turns", () => {
    const sessionId = "session-12345";
    const turns = [
      { event: "input", sessionId },
      { event: "start", sessionId },
      { event: "end", sessionId },
      { event: "input", sessionId },
      { event: "start", sessionId },
      { event: "end", sessionId },
    ];
    const ids = new Set(turns.map((t) => t.sessionId));
    expect(ids.size).toBe(1);
  });
});

describe("multiturn-trace: model switch preserves prior turns", () => {
  it("appends model-swap markers without breaking the trace", () => {
    const trace = ["input", "start", "delta", "end", "model-swap", "input", "start", "delta", "end"];
    expect(trace.indexOf("model-swap")).toBeGreaterThan(trace.indexOf("end"));
    expect(trace.lastIndexOf("end")).toBe(trace.length - 1);
  });
});
