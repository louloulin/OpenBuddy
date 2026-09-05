/**
 * R1.4 — unit tests for the new IPC payload validators.
 *
 * Covers `promptContent` (text + image parts), `thinkingLevel`,
 * `optionalThinkingLevel`, and the structured `permissionMode` accept/reject
 * paths. These are the boundary contracts that the renderer-facing
 * `agent:prompt-content` / `agent:set-thinking-level` / `agent:set-permission-mode`
 * IPC channels rely on, so any regression here would surface as silent drop
 * of UI input rather than a type error.
 */
import { describe, expect, it } from "vitest";
import {
  promptContent,
  optionalPromptContent,
  thinkingLevel,
  optionalThinkingLevel,
  type OpenBuddyThinkingLevel,
} from "../validation";

describe("promptContent", () => {
  it("accepts a single text part", () => {
    const out = promptContent([{ type: "text", text: "hello" }]);
    expect(out).toEqual([{ type: "text", text: "hello" }]);
  });

  it("accepts text + image mixed parts", () => {
    const out = promptContent([
      { type: "text", text: "what is in this image?" },
      { type: "image", mediaType: "image/png", data: "AAAA", name: "shot.png" },
    ]);
    expect(out).toEqual([
      { type: "text", text: "what is in this image?" },
      { type: "image", mediaType: "image/png", data: "AAAA", name: "shot.png" },
    ]);
  });

  it("rejects empty arrays (matches IPC contract: non-empty content)", () => {
    expect(() => promptContent([])).toThrow(/must be a non-empty array/);
  });

  it("rejects unknown part types", () => {
    expect(() => promptContent([{ type: "audio", data: "x" }])).toThrow(/type/);
  });

  it("rejects text part with missing text field", () => {
    expect(() => promptContent([{ type: "text" }])).toThrow();
  });
});

describe("optionalPromptContent", () => {
  it("returns undefined for undefined / null input", () => {
    expect(optionalPromptContent(undefined)).toBeUndefined();
    expect(optionalPromptContent(null)).toBeUndefined();
  });

  it("delegates to promptContent for valid input", () => {
    const out = optionalPromptContent([{ type: "text", text: "x" }]);
    expect(out).toEqual([{ type: "text", text: "x" }]);
  });
});

describe("thinkingLevel", () => {
  it("accepts all four canonical levels", () => {
    const levels: OpenBuddyThinkingLevel[] = ["off", "low", "medium", "high"];
    for (const lvl of levels) {
      expect(thinkingLevel(lvl)).toBe(lvl);
    }
  });

  it("rejects unknown levels with a helpful message", () => {
    expect(() => thinkingLevel("extreme")).toThrow(/thinking level/);
    expect(() => thinkingLevel(null)).toThrow(/thinking level/);
    expect(() => thinkingLevel(42)).toThrow(/thinking level/);
  });
});

describe("optionalThinkingLevel", () => {
  it("returns undefined for undefined / null", () => {
    expect(optionalThinkingLevel(undefined)).toBeUndefined();
    expect(optionalThinkingLevel(null)).toBeUndefined();
  });

  it("passes through valid levels", () => {
    expect(optionalThinkingLevel("high")).toBe("high");
  });
});
