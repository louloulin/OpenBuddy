import { describe, expect, it } from "vitest";
import {
  formatBranchSummaryText,
  textOfBranchSummaryMessageContent,
} from "./branch-summary-format";

describe("formatBranchSummaryText", () => {
  it("quotes user prompts with > and caps assistant text", () => {
    const messages = [
      { role: "user", content: "Find the broken handler." },
      { role: "assistant", content: "Reading src/handler.ts to see why it throws." },
    ];
    expect(formatBranchSummaryText(messages)).toBe(
      "> Find the broken handler.\nReading src/handler.ts to see why it throws.",
    );
  });

  it("returns null when no usable text survives the budget", () => {
    expect(formatBranchSummaryText([])).toBeNull();
    expect(formatBranchSummaryText([{ role: "user", content: "   " }])).toBeNull();
    expect(formatBranchSummaryText([{ role: "tool", content: "" }])).toBeNull();
  });

  it("caps each user prompt at maxUser and assistant at maxAssistant", () => {
    const user = { role: "user" as const, content: "x".repeat(500) };
    const assistant = { role: "assistant" as const, content: "y".repeat(800) };
    const out = formatBranchSummaryText([user, assistant], { maxUser: 50, maxAssistant: 100 });
    expect(out).toBe(`> ${"x".repeat(50)}\n${"y".repeat(100)}`);
  });

  it("caps total output at maxTotal", () => {
    const messages = Array.from({ length: 10 }, () => ({ role: "assistant" as const, content: "abcdefghij" }));
    const out = formatBranchSummaryText(messages, { maxTotal: 25 });
    expect(out?.length).toBe(25);
  });

  it("respects option overrides for maxTotal", () => {
    const messages = [
      { role: "user" as const, content: "hi" },
      { role: "assistant" as const, content: "world" },
    ];
    // slice(0, 5) of "> hi\nworld" is "> hi\n" — the trailing newline is
    // preserved when the cap clips mid-line.
    expect(formatBranchSummaryText(messages, { maxTotal: 5 })).toBe("> hi\n");
  });

  it("flattens array content into a single line of text", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text", text: "first" },
          { type: "image" },
          { type: "text", text: "second" },
        ],
      },
    ];
    expect(formatBranchSummaryText(messages)).toBe("> first second");
  });
});

describe("textOfBranchSummaryMessageContent", () => {
  it("returns string content verbatim", () => {
    expect(textOfBranchSummaryMessageContent("hello")).toBe("hello");
  });

  it("returns empty string for non-string non-array content", () => {
    expect(textOfBranchSummaryMessageContent(42)).toBe("");
    expect(textOfBranchSummaryMessageContent(null)).toBe("");
    expect(textOfBranchSummaryMessageContent(undefined)).toBe("");
  });

  it("joins array content text parts with single spaces", () => {
    expect(
      textOfBranchSummaryMessageContent([
        { type: "text", text: "a" },
        { type: "image", text: "ignored" },
        { type: "text", text: "b" },
      ]),
    ).toBe("a b");
  });
});