import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRUNCATION_OPTIONS,
  truncateDocumentBlocks,
  type TruncationOptions,
} from "./document-truncator";

function block(label: string, text: string): string {
  return `\n\n<document name=${JSON.stringify(label)} mediaType="application/pdf" page="1">\n${text}\n</document>`;
}

describe("document-truncator", () => {
  it("leaves the input alone when total chars are within the budget", () => {
    const blocks = [block("a", "hello"), block("b", "world")];
    const result = truncateDocumentBlocks(blocks, { maxChars: 1000, keepFirst: 2, keepLast: 1 });
    expect(result.truncated).toBe(false);
    expect(result.dropped).toBe(0);
    expect(result.totalChars).toBe(blocks.join("").length);
    expect(result.blocks).toEqual(blocks);
  });

  it("drops middle blocks when the budget is exceeded", () => {
    const blocks = Array.from({ length: 10 }, (_, i) =>
      block(`doc-${i}`, "x".repeat(200)),
    );
    const totalChars = blocks.join("").length;
    expect(totalChars).toBeGreaterThan(2000);
    const result = truncateDocumentBlocks(blocks, { maxChars: 1200, keepFirst: 2, keepLast: 2 });
    expect(result.truncated).toBe(true);
    expect(result.dropped).toBe(6); // 10 - 2 - 2
    expect(result.totalChars).toBeLessThan(totalChars);
    // First + last must survive verbatim.
    expect(result.blocks[0]).toBe(blocks[0]);
    expect(result.blocks[1]).toBe(blocks[1]);
    expect(result.blocks.at(-1)).toBe(blocks.at(-1));
    expect(result.blocks.at(-2)).toBe(blocks.at(-2));
  });

  it("emits a <document-truncated> marker so the model knows blocks were dropped", () => {
    const blocks = Array.from({ length: 6 }, (_, i) =>
      block(`doc-${i}`, "x".repeat(500)),
    );
    const result = truncateDocumentBlocks(blocks, { maxChars: 1500, keepFirst: 1, keepLast: 1 });
    const marker = result.blocks.find((b) => b.includes("<document-truncated"));
    expect(marker).toBeDefined();
    expect(marker).toContain("dropped=4");
    expect(marker).toContain("keptFirst=1");
    expect(marker).toContain("keptLast=1");
  });

  it("is a no-op when keepFirst + keepLast >= block count", () => {
    const blocks = [block("a", "abc"), block("b", "def"), block("c", "ghi")];
    const result = truncateDocumentBlocks(blocks, { maxChars: 10, keepFirst: 2, keepLast: 2 });
    expect(result.truncated).toBe(false);
    expect(result.dropped).toBe(0);
    expect(result.blocks).toEqual(blocks);
  });

  it("supports keepFirst=0 (drop everything but the tail)", () => {
    const blocks = Array.from({ length: 5 }, (_, i) =>
      block(`doc-${i}`, "y".repeat(400)),
    );
    const result = truncateDocumentBlocks(blocks, { maxChars: 200, keepFirst: 0, keepLast: 1 });
    expect(result.truncated).toBe(true);
    expect(result.dropped).toBe(4);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toBe(blocks[4]);
  });

  it("supports keepLast=0 (drop everything but the head)", () => {
    const blocks = Array.from({ length: 5 }, (_, i) =>
      block(`doc-${i}`, "y".repeat(400)),
    );
    const result = truncateDocumentBlocks(blocks, { maxChars: 200, keepFirst: 2, keepLast: 0 });
    expect(result.truncated).toBe(true);
    expect(result.dropped).toBe(3);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]).toBe(blocks[0]);
    expect(result.blocks[1]).toBe(blocks[1]);
  });

  it("counts only the *block* text, not the synthetic marker, toward the post-truncation budget", () => {
    // Regression guard: marker chars must not inflate the budget so much
    // that a second truncation pass keeps dropping the same content.
    const blocks = Array.from({ length: 4 }, (_, i) =>
      block(`doc-${i}`, "z".repeat(400)),
    );
    const opts: TruncationOptions = { maxChars: 600, keepFirst: 1, keepLast: 1 };
    const first = truncateDocumentBlocks(blocks, opts);
    const second = truncateDocumentBlocks(first.blocks, opts);
    expect(second.truncated).toBe(false);
    expect(second.dropped).toBe(0);
  });

  it("exposes a sensible default option set callers can spread", () => {
    expect(DEFAULT_TRUNCATION_OPTIONS.maxChars).toBeGreaterThan(0);
    expect(DEFAULT_TRUNCATION_OPTIONS.keepFirst).toBeGreaterThan(0);
    expect(DEFAULT_TRUNCATION_OPTIONS.keepLast).toBeGreaterThan(0);
  });
});