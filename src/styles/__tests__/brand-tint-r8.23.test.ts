/**
 * brand-tint-r8.23.test.ts — guard spec for the R8.23 hardcoded
 * `rgba(0, 122, 255, *)` → `color-mix(--wb-brand, *)` migration.
 *
 * Two surfaces migrated:
 *   - .msg__feedback-btn--active (thumbs-up/down active state)
 *   - .wb-composer__dropzone (composer file drop indicator)
 *
 * Both use brand-tinted backgrounds; both now route through the
 * theme-aware brand token so dark theme can override without per-
 * theme overrides.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prose = readFileSync(join(__dirname, "..", "prose.css"), "utf8");
const sidebarMenus = readFileSync(join(__dirname, "..", "sidebar-menus.css"), "utf8");

function ruleBody(css: string, selector: string): string | null {
  const idx = css.indexOf(selector + " {");
  if (idx < 0) return null;
  let depth = 0;
  let start = -1;
  for (let i = idx; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      depth++;
      if (start < 0) start = i + 1;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return css.slice(start, i);
    }
  }
  return null;
}

describe("R8.23 .msg__feedback-btn--active brand-tint migration", () => {
  it("uses color-mix on --wb-brand (12% alpha)", () => {
    const body = ruleBody(prose, ".msg__feedback-btn--active");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand/);
    expect(body!).toMatch(/var\(--wb-brand[\s\S]*?\)\s+12%/);
  });

  it("border colour also routes through the brand token", () => {
    const body = ruleBody(prose, ".msg__feedback-btn--active");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-color:\s*var\(--wb-brand/);
  });

  it("no longer carries the legacy rgba(0, 122, 255, *) hardcoded blue", () => {
    const body = ruleBody(prose, ".msg__feedback-btn--active");
    expect(body).toBeTruthy();
    expect(body!).not.toMatch(/rgba\(0,\s*122,\s*255/);
  });
});

describe("R8.61 .wb-composer__dropzone neutral contract", () => {
  it("background uses color-mix on neutral --wb-text-strong (6% alpha)", () => {
    const body = ruleBody(sidebarMenus, ".wb-composer__dropzone");
    expect(body).toBeTruthy();
    // R8.61 - Neutral contract: drop hint uses text-strong mix,
    // NOT brand colour-mix (per user instruction).
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-text-strong/);
    expect(body!).not.toMatch(/var\(--wb-brand/);
  });

  it("dashed border uses --wb-border-default (neutral), NOT brand token", () => {
    const body = ruleBody(sidebarMenus, ".wb-composer__dropzone");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border:\s*2px dashed var\(--wb-border-default\)/);
    expect(body!).not.toMatch(/dashed var\(--wb-brand/);
  });

  it("dropzone-text uses --wb-text-strong (neutral), NOT brand", () => {
    const body = ruleBody(sidebarMenus, ".wb-composer__dropzone-text");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color: var\(--wb-text-strong\)/);
    expect(body!).not.toMatch(/color: var\(--wb-brand/);
  });

  it("no legacy hardcoded brand colour anywhere in the rule", () => {
    const body = ruleBody(sidebarMenus, ".wb-composer__dropzone");
    expect(body).toBeTruthy();
    expect(body!).not.toMatch(/#00c29a/i);
    expect(body!).not.toMatch(/rgba\(0,\s*122,\s*255,\s*0\.08\)/);
  });
});

describe("R8.23 .msg__caret streaming indicator upgrade", () => {
  it("renders as a 2×14 brand-tinted pill (no longer a unicode block)", () => {
    const body = ruleBody(prose, ".msg__caret");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/width:\s*2px/);
    expect(body!).toMatch(/height:\s*14px/);
    expect(body!).toMatch(/border-radius:\s*1px/);
    // No more "▋" — JSX renders an empty span now.
  });

  it("uses a brand-tinted glow shadow for the live-streaming feel", () => {
    const body = ruleBody(prose, ".msg__caret");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/box-shadow:\s*0 0 6px color-mix\(in srgb,\s*var\(--wb-brand/);
  });

  it("animates via msg-caret-pulse keyframes (not the old hard blink)", () => {
    const body = ruleBody(prose, ".msg__caret");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/animation:\s*msg-caret-pulse/);
  });

  it("declares msg-caret-pulse keyframes that swing opacity 0.35 ↔ 1", () => {
    const start = prose.indexOf("@keyframes msg-caret-pulse");
    expect(start).toBeGreaterThanOrEqual(0);
    let depth = 0;
    let end = -1;
    for (let i = start; i < prose.length; i++) {
      if (prose[i] === "{") depth++;
      else if (prose[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    const kf = prose.slice(start, end);
    expect(kf).toMatch(/opacity:\s*0\.35/);
    expect(kf).toMatch(/opacity:\s*1/);
    // scaleY adds the subtle "breathing" feel.
    expect(kf).toMatch(/scaleY\(/);
  });

  it("disables the pulse under prefers-reduced-motion", () => {
    const reduced = prose.match(
      /@media\s+\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.msg__caret[\s\S]*?\}/,
    );
    expect(reduced).toBeTruthy();
    expect(reduced![0]).toMatch(/animation:\s*none/);
  });
});
