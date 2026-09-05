/**
 * ansi.ts — parse ANSI SGR escape sequences into styled text segments.
 *
 * Tool output (bash logs, build progress, test runners, pi extension widgets
 * like pi-lens / rpiv-todo) routinely carries ANSI color codes. OpenBuddy
 * rendered that raw inside `<pre>` blocks, so a colored `ls` or a red test
 * failure showed up as literal `\x1b[31m…\x1b[0m` garbage.
 *
 * This is a self-contained SGR parser rather than a dependency + innerHTML.
 * pi-web's `AnsiText` uses `ansi_up().ansi_to_html()` piped through
 * `dangerouslySetInnerHTML`; we return plain data segments instead so the
 * caller renders them as React nodes. That keeps three properties:
 *   - no new runtime dependency,
 *   - no `dangerouslySetInnerHTML` (React escapes the text, so tool output can
 *     never inject markup — the exact risk `ansi_up` has to document around),
 *   - a trivial fast path: text with no ESC byte returns a single segment.
 *
 * Supported SGR codes (the set that actually appears in CLI output):
 *   0 reset · 1 bold · 2 dim · 3 italic · 4 underline · 9 strikethrough
 *   22/23/24/29 targeted resets
 *   30-37 / 90-97 foreground · 40-47 / 100-107 background
 *   38/48 extended color: `5;n` (256) and `2;r;g;b` (truecolor)
 *   39/49 default fg/bg
 * Unknown codes are ignored (state is preserved), matching terminal behavior.
 */

export interface AnsiStyle {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** CSS color string, or undefined for the terminal default. */
  color?: string;
  /** CSS background color string, or undefined for the terminal default. */
  background?: string;
}

export interface AnsiSegment {
  text: string;
  style: AnsiStyle;
}

/** Standard 16-color palette (indices 0-7 normal, 8-15 bright). */
const PALETTE_16 = [
  "#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
  "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff",
];

/** ESC (0x1b) — presence is the fast-path gate. */
const ESC = "\x1b";

/** Resolve a 256-color index to a CSS hex string. */
function color256(n: number): string {
  if (n < 16) return PALETTE_16[n];
  if (n >= 232) {
    // 24-step grayscale ramp.
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  // 6×6×6 color cube.
  const i = n - 16;
  const r = Math.floor(i / 36);
  const g = Math.floor((i % 36) / 6);
  const b = i % 6;
  const scale = (c: number) => (c === 0 ? 0 : 55 + c * 40);
  return `rgb(${scale(r)},${scale(g)},${scale(b)})`;
}

/** Whether a string contains any ANSI escape introducer. */
export function hasAnsi(text: string): boolean {
  return text.includes(ESC);
}

/**
 * Apply one SGR parameter list (the numbers between `ESC[` and `m`) to a style,
 * mutating and returning it. Handles the multi-parameter extended-color forms
 * by consuming ahead in `params`.
 */
function applySgr(style: AnsiStyle, params: number[]): AnsiStyle {
  for (let i = 0; i < params.length; i += 1) {
    const code = params[i];
    switch (true) {
      case code === 0: {
        // Full reset — replace every field.
        for (const k of Object.keys(style) as (keyof AnsiStyle)[]) delete style[k];
        break;
      }
      case code === 1: style.bold = true; break;
      case code === 2: style.dim = true; break;
      case code === 3: style.italic = true; break;
      case code === 4: style.underline = true; break;
      case code === 9: style.strike = true; break;
      case code === 22: style.bold = undefined; style.dim = undefined; break;
      case code === 23: style.italic = undefined; break;
      case code === 24: style.underline = undefined; break;
      case code === 29: style.strike = undefined; break;
      case code >= 30 && code <= 37: style.color = PALETTE_16[code - 30]; break;
      case code >= 90 && code <= 97: style.color = PALETTE_16[code - 90 + 8]; break;
      case code >= 40 && code <= 47: style.background = PALETTE_16[code - 40]; break;
      case code >= 100 && code <= 107: style.background = PALETTE_16[code - 100 + 8]; break;
      case code === 39: style.color = undefined; break;
      case code === 49: style.background = undefined; break;
      case code === 38 || code === 48: {
        const target: "color" | "background" = code === 38 ? "color" : "background";
        const mode = params[i + 1];
        if (mode === 5 && params.length > i + 2) {
          style[target] = color256(params[i + 2]);
          i += 2;
        } else if (mode === 2 && params.length > i + 4) {
          style[target] = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`;
          i += 4;
        }
        break;
      }
      default:
        // Unknown code — leave state unchanged (terminal semantics).
        break;
    }
  }
  return style;
}

// Matches a CSI SGR sequence: ESC [ <params> m. Only `m` (SGR) is styled;
// other CSI finals (cursor moves, clears) are stripped, not rendered.
const CSI = /\x1b\[([0-9;]*)([A-Za-z])/g;

/**
 * Parse `text` into contiguous styled segments. Adjacent runs sharing a style
 * are NOT merged (callers key on index); empty runs between back-to-back codes
 * are skipped.
 */
export function parseAnsi(text: string): AnsiSegment[] {
  if (!hasAnsi(text)) return [{ text, style: {} }];

  const segments: AnsiSegment[] = [];
  let style: AnsiStyle = {};
  let lastIndex = 0;
  CSI.lastIndex = 0;

  const pushText = (chunk: string) => {
    if (chunk.length === 0) return;
    // Clone the style so later mutations don't retroactively change segments.
    segments.push({ text: chunk, style: { ...style } });
  };

  let match: RegExpExecArray | null;
  while ((match = CSI.exec(text)) !== null) {
    pushText(text.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    if (match[2] === "m") {
      const params = match[1] === "" ? [0] : match[1].split(";").map((p) => Number(p) || 0);
      style = applySgr(style, params);
    }
    // Non-`m` finals: swallow the sequence, keep style.
  }
  pushText(text.slice(lastIndex));

  return segments.length > 0 ? segments : [{ text: "", style: {} }];
}

/** Translate a parsed style into an inline CSS object for a React element. */
export function ansiStyleToCss(style: AnsiStyle): Record<string, string | number> {
  const css: Record<string, string | number> = {};
  if (style.color) css.color = style.color;
  if (style.background) css.backgroundColor = style.background;
  if (style.bold) css.fontWeight = 700;
  if (style.dim) css.opacity = 0.7;
  if (style.italic) css.fontStyle = "italic";
  const decorations: string[] = [];
  if (style.underline) decorations.push("underline");
  if (style.strike) decorations.push("line-through");
  if (decorations.length > 0) css.textDecoration = decorations.join(" ");
  return css;
}
