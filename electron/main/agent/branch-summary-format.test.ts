import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatBranchSummary,
  formatBranchSummaryText,
  formatBranchSummaryWithPi,
  textOfBranchSummaryMessageContent,
} from "./branch-summary-format";

// Mock the pi SDK so we can drive generateBranchSummary's behaviour from
// the test without touching the network.
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    generateBranchSummary: vi.fn(),
    prepareBranchEntries: actual.prepareBranchEntries,
  };
});

import { generateBranchSummary, prepareBranchEntries } from "@earendil-works/pi-coding-agent";

const mockedGenerate = vi.mocked(generateBranchSummary);

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

describe("formatBranchSummaryWithPi", () => {
  // Cast a sentinel object as pi's Model<any>. The pi path only forwards
  // it through; the mocked generateBranchSummary intercepts before any
  // real Model validation runs.
  const fakeModel = { id: "fake/model", provider: "fake" } as unknown as Parameters<typeof formatBranchSummaryWithPi>[1]["model"];

  beforeEach(() => {
    mockedGenerate.mockReset();
  });

  it("returns the LLM summary when pi returns a non-empty summary", async () => {
    mockedGenerate.mockResolvedValueOnce({ summary: "  rewound branch covered A and B  " } as never);
    const out = await formatBranchSummaryWithPi(
      [{ type: "message", id: "a", parentId: null, timestamp: 0, message: { role: "user", content: "hi", timestamp: 0 } }] as never,
      { model: fakeModel, signal: new AbortController().signal },
    );
    expect(out).toBe("rewound branch covered A and B");
  });

  it("returns null when pi returns aborted=true", async () => {
    mockedGenerate.mockResolvedValueOnce({ aborted: true } as never);
    const out = await formatBranchSummaryWithPi([], { model: fakeModel, signal: new AbortController().signal });
    expect(out).toBeNull();
  });

  it("returns null when pi returns an error string", async () => {
    mockedGenerate.mockResolvedValueOnce({ error: "rate limited" } as never);
    const out = await formatBranchSummaryWithPi([], { model: fakeModel, signal: new AbortController().signal });
    expect(out).toBeNull();
  });

  it("returns null when pi throws", async () => {
    mockedGenerate.mockRejectedValueOnce(new Error("network down"));
    const out = await formatBranchSummaryWithPi([], { model: fakeModel, signal: new AbortController().signal });
    expect(out).toBeNull();
  });

  it("forwards reserveTokens + customInstructions to pi", async () => {
    mockedGenerate.mockResolvedValueOnce({ summary: "ok" } as never);
    await formatBranchSummaryWithPi([], {
      model: fakeModel,
      signal: new AbortController().signal,
      reserveTokens: 4096,
      customInstructions: "be terse",
    });
    expect(mockedGenerate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ reserveTokens: 4096, customInstructions: "be terse" }),
    );
  });
});

describe("formatBranchSummary router (G5 PR 1)", () => {
  const fakeModel = { id: "fake/model", provider: "fake" } as unknown as Parameters<typeof formatBranchSummaryWithPi>[1]["model"];

  beforeEach(() => {
    mockedGenerate.mockReset();
  });

  it("returns null immediately when signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const out = await formatBranchSummary([], { model: fakeModel, signal: ctrl.signal });
    expect(out).toBeNull();
    expect(mockedGenerate).not.toHaveBeenCalled();
  });

  it("uses pi path when model is provided and pi returns a summary", async () => {
    mockedGenerate.mockResolvedValueOnce({ summary: "pi said hi" } as never);
    const out = await formatBranchSummary(
      [{ type: "message", id: "u1", parentId: null, timestamp: 0, message: { role: "user", content: "hi", timestamp: 0 } }] as never,
      { model: fakeModel, signal: new AbortController().signal },
    );
    expect(out).toBe("pi said hi");
  });

  it("falls back to text formatter when pi returns null", async () => {
    mockedGenerate.mockResolvedValueOnce({ aborted: true } as never);
    const out = await formatBranchSummary(
      [{ type: "message", id: "u1", parentId: null, timestamp: 0, message: { role: "user", content: "fallback me", timestamp: 0 } }] as never,
      { model: fakeModel, signal: new AbortController().signal },
    );
    // prepareBranchEntries preserves the message in `messages`; the text
    // formatter then wraps it with `> ` and caps it.
    expect(out).toBe("> fallback me");
  });

  it("uses text formatter directly when no model is provided", async () => {
    const out = await formatBranchSummary(
      [{ type: "message", id: "u1", parentId: null, timestamp: 0, message: { role: "user", content: "offline path", timestamp: 0 } }] as never,
      { signal: new AbortController().signal },
    );
    expect(out).toBe("> offline path");
    expect(mockedGenerate).not.toHaveBeenCalled();
  });

  it("returns null when both pi and text fallback produce no output", async () => {
    mockedGenerate.mockResolvedValueOnce({ summary: "" } as never);
    const out = await formatBranchSummary([], {
      model: fakeModel,
      signal: new AbortController().signal,
    });
    // text fallback gets [] from prepareBranchEntries → null
    expect(out).toBeNull();
  });
});