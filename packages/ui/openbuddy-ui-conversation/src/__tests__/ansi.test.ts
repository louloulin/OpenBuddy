/**
 * Unit coverage for the ANSI SGR parser that feeds `AnsiText`.
 *
 * These pin the behaviours the tool-output rendering depends on: the no-ESC
 * fast path, the common SGR codes CLI tools emit, extended color, and the
 * property that matters most for a chat transcript — the escape bytes never
 * survive into the rendered text.
 */
import { describe, expect, it } from "vitest";
import { ansiStyleToCss, hasAnsi, parseAnsi } from "../lib/ansi";

const ESC = "\x1b";

describe("parseAnsi", () => {
  it("returns a single unstyled segment for plain text (fast path)", () => {
    const segs = parseAnsi("just plain output");
    expect(segs).toEqual([{ text: "just plain output", style: {} }]);
    expect(hasAnsi("just plain output")).toBe(false);
  });

  it("colors a red run and resets back to default", () => {
    const segs = parseAnsi(`${ESC}[31mFAILED${ESC}[0m ok`);
    expect(segs.map((s) => s.text)).toEqual(["FAILED", " ok"]);
    expect(segs[0].style.color).toBeTruthy();
    expect(segs[1].style.color).toBeUndefined();
  });

  it("never leaves escape bytes in the rendered text", () => {
    const noisy = `${ESC}[1m${ESC}[32m✓ 12 passed${ESC}[0m\n${ESC}[31m✗ 1 failed${ESC}[0m`;
    const joined = parseAnsi(noisy).map((s) => s.text).join("");
    expect(joined).toBe("✓ 12 passed\n✗ 1 failed");
    expect(joined.includes(ESC)).toBe(false);
  });

  it("accumulates bold + underline until reset", () => {
    const segs = parseAnsi(`${ESC}[1m${ESC}[4mboth${ESC}[0mnone`);
    const both = segs.find((s) => s.text === "both")!;
    expect(both.style.bold).toBe(true);
    expect(both.style.underline).toBe(true);
    const none = segs.find((s) => s.text === "none")!;
    expect(none.style.bold).toBeUndefined();
    expect(none.style.underline).toBeUndefined();
  });

  it("supports 256-color and truecolor foregrounds", () => {
    const c256 = parseAnsi(`${ESC}[38;5;196mX`)[0];
    expect(c256.style.color).toBeTruthy();
    const truecolor = parseAnsi(`${ESC}[38;2;10;20;30mY`)[0];
    expect(truecolor.style.color).toBe("rgb(10,20,30)");
  });

  it("targeted reset (22) clears bold without touching color", () => {
    const segs = parseAnsi(`${ESC}[1m${ESC}[31mA${ESC}[22mB`);
    const a = segs.find((s) => s.text === "A")!;
    const b = segs.find((s) => s.text === "B")!;
    expect(a.style.bold).toBe(true);
    expect(b.style.bold).toBeUndefined();
    expect(b.style.color).toBe(a.style.color); // color survives the 22 reset
  });

  it("strips non-SGR CSI sequences (e.g. cursor moves) without styling", () => {
    const segs = parseAnsi(`${ESC}[2Kcleared${ESC}[1G line`);
    expect(segs.map((s) => s.text).join("")).toBe("cleared line");
    expect(segs.every((s) => Object.keys(s.style).length === 0)).toBe(true);
  });

  it("bare ESC[m is treated as a full reset", () => {
    const segs = parseAnsi(`${ESC}[31mred${ESC}[mplain`);
    expect(segs.find((s) => s.text === "plain")!.style.color).toBeUndefined();
  });
});

describe("ansiStyleToCss", () => {
  it("maps style flags to CSS properties", () => {
    expect(ansiStyleToCss({ bold: true })).toEqual({ fontWeight: 700 });
    expect(ansiStyleToCss({ italic: true })).toEqual({ fontStyle: "italic" });
    expect(ansiStyleToCss({ underline: true, strike: true })).toEqual({
      textDecoration: "underline line-through",
    });
    expect(ansiStyleToCss({ color: "#cd3131", background: "#000000" })).toEqual({
      color: "#cd3131",
      backgroundColor: "#000000",
    });
  });

  it("returns an empty object for the default style", () => {
    expect(ansiStyleToCss({})).toEqual({});
  });
});
