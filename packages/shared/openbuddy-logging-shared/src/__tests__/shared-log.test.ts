import { describe, expect, it } from "vitest";
import { generateTraceId, isLogLevel, LOG_LEVELS, redactText } from "../index";

describe("shared logging primitives", () => {
  it("exposes the six supported levels", () => expect(LOG_LEVELS).toEqual(["trace", "debug", "info", "warn", "error", "fatal"]));
  it("validates levels", () => { expect(isLogLevel("info")).toBe(true); expect(isLogLevel("verbose")).toBe(false); });
  it("generates UUID-shaped trace IDs", () => expect(generateTraceId()).toMatch(/^[0-9a-f-]{36}$/));
  it("redacts long text without logging the full value", () => expect(redactText("a".repeat(100), 10)).toBe("aaaaaaaaaa…[TRUNC 100]"));
  it("handles absent diagnostic text", () => expect(redactText(undefined)).toBe(""));
});
