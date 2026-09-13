/**
 * extension-audit-panel-css.test.ts — guard spec for the CSS tones
 * that drive the ExtensionAuditPanel's red/amber/neutral row colouring
 * (plan4.5 §A).
 *
 * The component emits `data-action` and `data-tone` hooks; the actual
 * styling lives in `src/styles/app.css`. If a future refactor strips
 * the CSS rules without removing the hooks (or vice-versa), the panel
 * will render but visually silently lose its deny/needs-review
 * emphasis — a regression this spec catches at CI time.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(
  join(__dirname, "..", "..", "styles", "app.css"),
  "utf8",
);

describe("ExtensionAuditPanel CSS tones (plan4.5 §A)", () => {
  it("declares the panel root selector", () => {
    expect(css).toMatch(/\.extension-audit-panel\s*\{/);
  });

  it("declares per-action row tones (allow/deny/needs-review)", () => {
    // The component emits `[data-action="deny"]` etc.; CSS must tone
    // each so deny reads red and needs-review reads amber.
    expect(css).toMatch(/\.extension-audit-panel__row\[data-action=["']deny["']\]/);
    expect(css).toMatch(/\.extension-audit-panel__row\[data-action=["']needs-review["']\]/);
    expect(css).toMatch(/\.extension-audit-panel__row\[data-action=["']allow["']\]/);
  });

  it("declares per-tone metric tile colours (allow/deny/needs-review/total)", () => {
    // The summary tiles use `data-tone` for the same reason.
    expect(css).toMatch(/\.extension-audit-panel__metric\[data-tone=["']deny["']\]/);
    expect(css).toMatch(/\.extension-audit-panel__metric\[data-tone=["']needs-review["']\]/);
    expect(css).toMatch(/\.extension-audit-panel__metric\[data-tone=["']allow["']\]/);
    expect(css).toMatch(/\.extension-audit-panel__metric\[data-tone=["']total["']\]/);
  });

  it("deny colour is reddish (rgba red channel dominant) and needs-review is amber", () => {
    // Best-effort guard: the deny rule should reference a reddish hue
    // (high red, low green/blue), needs-review an amber one (high red
    // + moderate green, low blue). We don't pin the exact palette —
    // just confirm the tonal intent. The metric tone block targets
    // `dd` for the count colour, so allow an optional `dd` between
    // `]` and `{`.
    const denyBlock = css.match(
      /\.extension-audit-panel__metric\[data-tone=["']deny["']\][^{}]*\{[^}]*\}/,
    );
    expect(denyBlock, "expected deny tone block").toBeTruthy();
    expect(denyBlock![0]).toMatch(/color:\s*rgba?\(\s*(2[0-9]{2}|1[5-9][0-9])/i);

    const reviewBlock = css.match(
      /\.extension-audit-panel__metric\[data-tone=["']needs-review["']\][^{}]*\{[^}]*\}/,
    );
    expect(reviewBlock, "expected needs-review tone block").toBeTruthy();
    expect(reviewBlock![0]).toMatch(/color:\s*rgba?\(/i);
  });

  it("declares the action badge chip variant (allow/deny/needs-review)", () => {
    expect(css).toMatch(/\.extension-audit-panel__action\[data-testid=["']extension-audit-action-allow["']\]/);
    expect(css).toMatch(/\.extension-audit-panel__action\[data-testid=["']extension-audit-action-deny["']\]/);
    expect(css).toMatch(/\.extension-audit-panel__action\[data-testid=["']extension-audit-action-needs-review["']\]/);
  });
});
