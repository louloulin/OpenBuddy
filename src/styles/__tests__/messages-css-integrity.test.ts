/**
 * messages-css-integrity — P0-AI-Chat-Audit regression guard.
 *
 * Why this test exists:
 *
 *   fdb766a (Phase A.1 ChatView split + R5 minimal UI redesign) accidentally
 *   dropped the closing `}` of `.msg--assistant .msg__bubble`, which then
 *   swallowed ~20 selectors (msg__bubble-text, msg__revision-pager,
 *   msg__edit*, msg__action-btn--primary, msg__bubble--editable) as nested
 *   CSS. Modern Chromium silently accepts nested rules; the inner rules
 *   then scope to `<descendant of .msg--assistant .msg__bubble>` which
 *   never matches in the live DOM (assistant renders via `.msg__body`, no
 *   `.msg__bubble`). The user-bubble inline editor, revision pager and
 *   primary action button therefore shipped unstyled for several weeks.
 *
 *   This guard fails loud if a sibling structural regression slips back in.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "messages.css"), "utf8");

function stripComments(s: string): string {
  // Strip /* ... */ and // ... --- first-line comments only. The file is
  // hand-curated so this crude approach is safe.
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

function lineOf(offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (css[i] === "\n") line++;
  return line;
}

/**
 * Walk the cleaned CSS tracking brace depth. Each time we enter a new
 * outermost rule, we record its `selector + open offset`. When the matching
 * close brace fires, we check whether the rule body ever reached depth
 * >= 2 (meaning there were **nested rules** inside it). That's the
 * fdb766a regression shape.
 *
 * We deliberately ignore `@media { ... }` blocks: dark-theme overrides are
 * legitimate CSS nesting sites (declared via `[data-theme="dark"] .foo`)
 * and aren't the regression we're guarding against.
 */
function findSwallowingOutermostRules(): Array<{ selector: string; openLine: number; closeLine: number }> {
  const cleaned = stripComments(css);
  const offenders: Array<{ selector: string; openLine: number; closeLine: number }> = [];
  const stack: Array<{ openOffset: number; selector: string; depth: number }> = [];
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "{") {
      // selector = text between previous ";" / `}` / at-rule close / file start
      // and the `{` — use the last 100 chars, trimmed, last token.
      const head = cleaned.slice(Math.max(0, i - 100), i).trim();
      const sel = head.split(/[\s,{:>+~;]+/).pop() ?? "";
      stack.push({ openOffset: i, selector: sel, depth: 1 });
      continue;
    }
    if (ch === "}") {
      const top = stack.pop();
      if (!top) continue;
      // After closing, check whether the body ever reached depth >= 2 (i.e.
      // the rule swallowed children). The first/top-most non-at-rule
      // ancestor with depth > 1 is the swallowing rule.
      // We approximate: track depth in stack.
    }
    // Track depth per stack frame.
  }
  // Simpler approach: scan and flag any rule whose body contains another
  // rule selector (e.g. `.msg__edit {`). This is what fdb766a produced.
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] !== "{") continue;
    // Find matching close
    let depth = 1;
    let j = i + 1;
    while (j < cleaned.length && depth > 0) {
      if (cleaned[j] === "{") depth++;
      else if (cleaned[j] === "}") depth--;
      j++;
    }
    if (depth !== 0) continue;
    const body = cleaned.slice(i + 1, j - 1);
    // Body must NOT contain a nested rule (e.g. `.foo { ... }` inside body).
    // Detect by checking for `}\.[A-Za-z_-][\w-]*[^{};]*\{` — a class
    // selector followed by `{`. CSS nesting is a Chromium feature, but
    // hand-curated code in this repo shouldn't use it.
    const headRaw = cleaned.slice(Math.max(0, i - 80), i);
    // Skip at-rules (@media / @supports / @keyframes / @layer / @container).
    // Those legitimately contain rules; the regression we guard against is a
    // plain selector rule swallowing its siblings. Detection: if the head
    // contains `@` followed by an identifier word, treat the rule as an
    // at-rule and skip.
    if (/@\s*[A-Za-z_-][\w-]*[^{};]*$/.test(headRaw)) continue;
    const sel = headRaw.trim().split(/[\s,{:>+~;]+/).pop() ?? "";
    if (/\n\s*\.[A-Za-z_-][\w-]*[^{};]*\{/.test(body)) {
      offenders.push({ selector: sel, openLine: lineOf(i), closeLine: lineOf(j) });
    }
  }
  return offenders;
}

describe("messages.css structural integrity", () => {
  it("braces are balanced overall", () => {
    const cleaned = stripComments(css);
    let depth = 0;
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth < 0) throw new Error(`unbalanced brace at offset ${i}`);
    }
    expect(depth).toBe(0);
  });

  it("no outermost rule silently swallows sibling rules via CSS nesting", () => {
    const offenders = findSwallowingOutermostRules();
    if (offenders.length > 0) {
      const dump = offenders.map((o) => `  L${o.openLine}-${o.closeLine}: ${o.selector}`).join("\n");
      throw new Error(
        `Found ${offenders.length} outermost rule(s) containing nested rules. ` +
          `A missing closing brace causes downstream selectors to be re-scoped ` +
          `as descendants of the parent (Chromium CSS nesting). ` +
          `This is the regression that broke .msg__edit / .msg__revision-pager / ` +
          `.msg__action-*.primary button styles in fdb766a.\n${dump}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it(".msg--assistant .msg__bubble is properly closed (fdb766a anchor)", () => {
    // Body must not contain another top-level rule selector. (The selector
    // text is excluded by checking only the body after the opening `{`.)
    const open = css.indexOf(".msg--assistant .msg__bubble {");
    expect(open).toBeGreaterThanOrEqual(0);
    const brace = open + ".msg--assistant .msg__bubble ".length;
    const close = css.indexOf("}", brace);
    expect(close).toBeGreaterThan(brace);
    const body = css.slice(brace, close);
    expect(body).not.toMatch(/^\s*\.[A-Za-z_][\w-]*(?:[\s,{:>+~])/m);
  });

  it("conversation-view tabs / result / content classes have CSS rules", () => {
    // P0-AI-Chat-Audit: conversation.view componentization registered
    // `result` / `content` views but never shipped CSS. Without styles,
    // even if the tabs render they're unstyled.
    // Use the class **prefix** (not `cls + " {"`) because CSS groups
    // selectors with commas (`.conversation-view-result,\n.conversation-view-content {`).
    for (const cls of [
      ".conversation-view-tabs",
      ".conversation-view-tabs__tab--active",
      ".conversation-view-result",
      ".conversation-view-content",
      ".conversation-view-hint",
      ".chatview__tabs",
    ]) {
      expect(css.includes(cls), `missing CSS for ${cls}`).toBe(true);
    }
  });

  it("inline edit / revision pager / editable bubble rules are top-level", () => {
    // fdb766a regression: those got swallowed inside `.msg--assistant .msg__bubble`
    // as nested rules. Make sure the literal selector text exists in the file.
    for (const sel of [
      ".msg__edit {",
      ".msg__edit-input {",
      ".msg__edit-actions {",
      ".msg__revision-pager {",
      ".msg__revision-btn {",
      ".msg__action-btn--primary {",
      ".msg__bubble--editable {",
      ".msg__bubble-text {",
    ]) {
      expect(css.includes(sel), `missing top-level rule: ${sel}`).toBe(true);
    }
  });
});
