import { describe, expect, it } from "vitest";
import { applyIfCurrent, createGenerationGate } from "./generation-gate";

describe("generation gate", () => {
  it("invalidates captured work after advance", () => {
    const gate = createGenerationGate(4);
    const token = gate.capture();
    expect(token.generation).toBe(4);
    expect(token.isCurrent()).toBe(true);
    expect(gate.advance()).toBe(5);
    expect(token.isCurrent()).toBe(false);
    expect(applyIfCurrent(gate, token, () => "stale")).toBeUndefined();
  });

  it("applies work for the current generation", () => {
    const gate = createGenerationGate();
    const token = gate.capture();
    expect(applyIfCurrent(gate, token, () => "fresh")).toBe("fresh");
  });

  it("rejects invalid and exhausted generations", () => {
    expect(() => createGenerationGate(-1)).toThrow(RangeError);
    expect(() => createGenerationGate(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    const gate = createGenerationGate(Number.MAX_SAFE_INTEGER);
    expect(() => gate.advance()).toThrow("generation exhausted");
  });
});
