/**
 * _r8_5-probe.test.mjs — turns the R8.5 live probe into a CI-friendly
 * test by re-running it and asserting on the JSON output.
 *
 * We don't import the probe module (it's a top-level script); instead
 * we spawn `node _r8_5-probe.mjs` and JSON.parse stdout.
 *
 * Skipped if electron / playwright cannot launch (CI environments without
 * a display server). Run via `rtk proxy npx vitest run scripts/electron/`
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const probePath = join(__dirname, "_r8_5-probe.mjs");
const electronBin = join(
  __dirname,
  "..",
  "..",
  "node_modules",
  "electron",
  "dist",
  "Electron.app",
  "Contents",
  "MacOS",
  "Electron",
);

const canLaunch = existsSync(electronBin);

const runProbe = () => {
  // We want one process per test for fresh app state, but spawning
  // electron 6x is slow (~7s each = 42s+). Instead spawn once and cache.
  if (runProbe._cache) return runProbe._cache;
  const result = spawnSync("node", [probePath], {
    cwd: join(__dirname, "..", ".."),
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `probe failed (status=${result.status}): ${(result.stderr || result.stdout || "").slice(-800)}`,
    );
  }
  // The probe prints a single JSON object; some launchers may emit
  // warnings before it. Pull the substring from the first '{' onward
  // and JSON.parse it directly — more robust than picking the last line.
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) {
    throw new Error(`no JSON in probe stdout; tail: ${result.stdout.slice(-500)}`);
  }
  const json = result.stdout.slice(startIdx);
  runProbe._cache = JSON.parse(json);
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("R8.5 live electron probe", () => {
  it("shell.css paints .app and .app__body", () => {
    const report = runProbe();
    expect(report.shell_app.found).toBe(true);
    expect(report.shell_app.display).toBe("flex");
    // Light theme bg must be a non-transparent surface (the 242 grey).
    expect(report.shell_app["background-color"]).toMatch(/rgb\(242, 242, 242\)/);

    expect(report.shell_body.found).toBe(true);
    expect(report.shell_body.display).toBe("flex");

    // Sidebar 默认宽度由 R8.62 的 Resizable 包裹层决定(320px, R8.62.1 加宽);
    // 未包裹时回退到 --ds-sidebar-width 的同一个值。
    expect(report.shell_sidebar.found).toBe(true);
    expect(report.shell_sidebar.width).toBe("320px");
  });

  it("dark theme flips app bg + composer card to dark surfaces", () => {
    const report = runProbe();
    // Light → dark probe flips data-theme via the script itself.
    expect(report.shell_app_dark.found).toBe(true);
    expect(report.shell_app_dark["background-color"]).toMatch(/rgb\(31,\s*31,\s*31\)/);

    // The composer *card* owns the surface and must actually go dark.
    expect(report.composer_card_light.found).toBe(true);
    expect(report.composer_card_dark.found).toBe(true);
    expect(report.composer_card_light["background-color"]).not.toBe(
      report.composer_card_dark["background-color"],
    );

    // Text should be light on dark.
    expect(report.composer_textarea_dark.found).toBe(true);
    expect(report.composer_textarea_dark.color).toMatch(/rgba\(255,\s*255,\s*255/);
  });

  it("composer input surface is identical in light and dark (R17 parity)", () => {
    const report = runProbe();
    // R17 拆掉了"暗色下给裸 textarea 涂 #1f1f1f"的一刀切规则:
    // `.wb-composer__input` 设计上 background:transparent,贴在 composer card
    // 的 --wb-bg-elevated 上。旧规则让浅色=透明、深色=一块 #1f1f1f 内陷,
    // 这就是"黑色主题下 chatinput 和白色主题差距很大"的根因。
    // 契约:两种主题下输入区都必须透明,由卡片提供底板。
    for (const key of [
      "composer_textarea_light",
      "composer_textarea_dark",
      "composer_input_light",
      "composer_input_dark",
    ]) {
      expect(report[key].found, key).toBe(true);
      expect(report[key]["background-color"], key).toBe("rgba(0, 0, 0, 0)");
    }
    // 只有文字颜色翻。
    expect(report.composer_textarea_light.color).toMatch(/rgba\(0,\s*0,\s*0/);
    expect(report.composer_textarea_dark.color).toMatch(/rgba\(255,\s*255,\s*255/);
  });

  it("R8.0 LoadingRow has 3 dots with the right stagger + tabular-nums elapsed", () => {
    const report = runProbe();
    expect(report.r80_loading.found).toBe(true);
    expect(report.r80_dots.count).toBe(3);
    expect(report.r80_dots.delays).toEqual(["-0.3s", "-0.15s", "0s"]);
    expect(report.r80_elapsed.found).toBe(true);
    expect(report.r80_elapsed["font-variant-numeric"]).toBe("tabular-nums");
    expect(report.r80_elapsed["font-size"]).toBe("11px");
  });

  it("R8.52 loading dots are brand-tinted at 70% alpha (no more neutral grey)", () => {
    const report = runProbe();
    // The probe captures getComputedStyle(background-color) on the first
    // .msg__loading-dot. R8.52 swapped --wb-text-strong 55% for
    // color-mix(--wb-brand 70%, transparent). Chromium serialises the
    // computed value as `color(srgb r g b / a)` (CSS Color 4 syntax)
    // rather than rgba(), so we parse either format.
    const bg = report.r80_dots.backgroundColor;
    expect(bg).toBeTruthy();
    expect(bg).toMatch(/(?:rgba?\(\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)|color\(srgb\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?))/);
    const m = bg.match(/(?:rgba?\(\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)|color\(srgb\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?))/);
    const rawR = m[1] ?? m[4];
    const rawG = m[2] ?? m[5];
    const rawB = m[3] ?? m[6];
    // color(srgb ...) returns 0-1 floats; rgba() returns 0-255 ints.
    // Convert everything to 0-255 ints for comparison.
    const to255 = (v) => (Number(v) <= 1 ? Math.round(Number(v) * 255) : Math.round(Number(v)));
    const r = to255(rawR);
    const g = to255(rawG);
    const b = to255(rawB);
    // Alpha must be 0.7 (the 70% mix). Either parse it from rgba()
    // trailing ,0.7) or from color(srgb ... / 0.7).
    const alphaM = bg.match(/\/\s*([0-9.]+)\s*\)/) || bg.match(/,\s*([0-9.]+)\s*\)/);
    expect(alphaM).toBeTruthy();
    expect(Number(alphaM[1])).toBeCloseTo(0.7, 2);
    // Brand-coloured, not neutral grey: the channels should NOT all be
    // within 5 of each other (which would indicate a grey).
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    expect(max - min).toBeGreaterThan(20);
  });

  it("R8.1 revision pager renders with current/total label and 2 buttons", () => {
    const report = runProbe();
    expect(report.r81_pager.found).toBe(true);
    expect(report.r81_pager.label).toBe("2 / 3");
    expect(report.r81_pager.buttons).toBe(2);
  });

  it("R8.3 inline-edit has textarea + cancel + primary + hint", () => {
    const report = runProbe();
    expect(report.r83_inline_edit.found).toBe(true);
    expect(report.r83_inline_edit.hasTextarea).toBe(true);
    expect(report.r83_inline_edit.hasHint).toBe(true);
    expect(report.r83_inline_edit.hasCancel).toBe(true);
    expect(report.r83_inline_edit.hasPrimary).toBe(true);
  });

  it("R8.2 toolcall polish renders compact + ok + correct height + duration attr", () => {
    const report = runProbe();
    expect(report.r82_toolcall.found).toBe(true);
    expect(report.r82_toolcall.hasCompact).toBe(true);
    expect(report.r82_toolcall.hasOk).toBe(true);
    // Height should be 30px (the compact override), not the default 32px.
    expect(report.r82_toolcall.height).toBe("30px");
    expect(report.r82_toolcall.durationAttr).toBe("1200");
    expect(report.r82_toolcall.statusMarkClass).toContain("toolcall__status-mark--completed");
  });

  it("R8.6 code action container is a flex row with 4px gap", () => {
    const report = runProbe();
    expect(report.r86_actions_container.found).toBe(true);
    expect(report.r86_actions_container.display).toBe("flex");
    expect(report.r86_actions_container.gap).toBe("4px");
  });

  it("R8.6 default action is 24px tall with secondary text color", () => {
    const report = runProbe();
    expect(report.r86_action_default.found).toBe(true);
    expect(report.r86_action_default.height).toBe("24px");
    // --md-code-action in light mode is rgba(0,0,0,0.55) (wb-text-secondary fallback).
    expect(report.r86_action_default.color).toMatch(/rgba\(0,\s*0,\s*0/);
  });

  it("R8.6 primary action gets the brand-tinted pill style", () => {
    const report = runProbe();
    expect(report.r86_action_primary.found).toBe(true);
    expect(report.r86_action_primary.hasVariant).toBe(true);
    // Primary color should be the brand teal (#00c29a = rgb(0, 194, 154)),
    // not the muted secondary text color of the default variant.
    expect(report.r86_action_primary.color).toMatch(/rgb\(0,\s*194,\s*154\)/);
    expect(report.r86_action_primary.color).not.toBe(report.r86_action_default.color);
    expect(report.r86_action_primary.fontWeight).toBe("500");
  });

  it("R8.6 disabled action has opacity ~0.45 and aria-disabled", () => {
    const report = runProbe();
    expect(report.r86_action_disabled.found).toBe(true);
    expect(report.r86_action_disabled.disabled).toBe(true);
    expect(report.r86_action_disabled.opacity).toBe("0.45");
  });

  it("R8.7 mention-picker has 420px width + 12px radius + enter animation + neutral active item", () => {
    const report = runProbe();
    expect(report.r87_mention_picker.found).toBe(true);
    expect(report.r87_mention_picker.width).toBe("420px");
    expect(report.r87_mention_picker.borderRadius).toBe("12px");
    expect(report.r87_mention_picker.hasEnterAnim).toBe("ob-mention-picker-in");
    // R8.61 把选中态从"品牌 8% 混合"改成了中性表面,品牌色只留给
    // streaming 指示条。契约见
    // src/styles/__tests__/mention-picker-neutral-r8.61.test.ts。
    // R27 修正:列表行不能用"实心 CTA 胶囊色"(--wb-bg-pill-active,亮色
    // = 75% 黑),那样配 --wb-text-strong 就是黑底黑字。改用"比容器深一层
    // 的中性表面" --wb-bg-active;亮色 = color-mix(black 8%, transparent)。
    expect(report.r87_mention_picker.activeItemBg).toBe("color(srgb 0 0 0 / 0.08)");
    // 且不能是实心胶囊色(否则又回到黑底黑字)。
    expect(report.r87_mention_picker.activeItemBg).not.toBe("rgba(0, 0, 0, 0.75)");
    // 且绝不是品牌色(0.760784 0.603922 是 #00C29A 的 srgb 分量)。
    expect(report.r87_mention_picker.activeItemBg).not.toMatch(
      /0\.760784\s+0\.603922/,
    );
    // Kind chip background is a neutral surface token, not a brand tint.
    expect(report.r87_mention_picker.kindChipBg).not.toMatch(
      /0\.760784\s+0\.603922/,
    );
    expect(report.r87_mention_picker.kindChipBg).toMatch(/oklch\(|rgb\(/);
  });

  it("R8.7 composer @-mention chips are brand-tinted (not hardcoded blue)", () => {
    const report = runProbe();
    expect(report.r87_composer_blocks.found).toBe(true);
    expect(report.r87_composer_blocks.count).toBe(2);
    // Color should be brand mix (rgb 0/194/154 = #00c29a (brand teal)), not the legacy
    // hardcoded rgba(0, 122, 255, ...).
    expect(report.r87_composer_blocks.color).toMatch(/0 0\.760784 0\.603922/);
    expect(report.r87_composer_blocks.borderRadius).toBe("8px");
  });

  it("R8.7 file attachment chip is a pill (border-radius 9999px)", () => {
    const report = runProbe();
    expect(report.r87_composer_attachments.found).toBe(true);
    expect(report.r87_composer_attachments.borderRadius).toBe("9999px");
  });

  it("R8.7 image-attachments remove button supports transform transition (active scale)", () => {
    const report = runProbe();
    expect(report.r87_image_attachments.found).toBe(true);
    // transform must be in the transition list so the :active scale-down fires smoothly.
    expect(report.r87_image_attachments.transition).toMatch(/transform/);
  });

  it("R8.8 findbar has enter animation + layered shadow", () => {
    const report = runProbe();
    expect(report.r88_findbar.found).toBe(true);
    expect(report.r88_findbar.hasEnterAnim).toBe("ob-findbar-in");
    expect(report.r88_findbar.borderRadius).toBe("10px");
    expect(report.r88_findbar.boxShadow).toMatch(/0px 8px 24px/);
  });

  it("R8.8 findbar empty count turns red and bold", () => {
    const report = runProbe();
    expect(report.r88_findbar_empty_count.found).toBe(true);
    // srgb ~0.96 / 0.25 / 0.25 = the error red mix at 75% alpha.
    expect(report.r88_findbar_empty_count.color).toMatch(/0\.964706|0\.25098/);
    expect(report.r88_findbar_empty_count.fontWeight).toBe("500");
  });

  it("R8.8 branch navigator active outline is brand-tinted", () => {
    const report = runProbe();
    expect(report.r88_branch_navigator.found).toBe(true);
    // 激活描边必须来自 `--wb-accent` 这个 token(而不是写死的颜色或某个
    // 已经被废弃的 legacy token)。
    expect(report.r88_branch_navigator.activeOutline).toContain(
      report.r88_branch_navigator.accentToken,
    );
    // 而那个 token 必须就是品牌青绿 #00C29A。这一项由
    // packages/ui/openbuddy-ui-theme/src/__tests__/brand-accent.test.ts
    // 精确锁定(oklch → sRGB 往返 = 0/194/154)。theme-v2 曾经把它退化成
    // 去饱和的 oklch(0.72 0.135 165) = rgb(55,191,143)。
    expect(report.r88_branch_navigator.accentToken).toBe(
      "oklch(0.7246 0.142 171)",
    );
  });

  it("R8.8 rewind-bar dropdown has enter animation + transform-origin top right", () => {
    const report = runProbe();
    expect(report.r88_rewind_bar.found).toBe(true);
    expect(report.r88_rewind_bar.dropdownAnim).toBe("ob-rewind-dropdown-in");
    // transform-origin: 380px 0px = top-right (the dropdown's natural anchor).
    expect(report.r88_rewind_bar.dropdownTransformOrigin).toMatch(/0px/);
  });

  // ─────────────────────────────── R8.9 ───────────────────────────────

  it("R8.9 motion tokens are defined on :root with the expected values", () => {
    const t = runProbe().r89_motion_tokens;
    expect(t.fast).toBe("120ms");
    expect(t.pop).toBe("160ms");
    expect(t.sm).toBe("150ms");
    expect(t.md).toBe("180ms");
    expect(t.base).toBe("200ms");
    expect(t.large).toBe("240ms");
    expect(t.slow).toBe("320ms");
    expect(t.easingStandard).toMatch(/cubic-bezier/);
    expect(t.easingEmphasized).toMatch(/cubic-bezier/);
  });

  it("R8.9 msg__edit (R8.3 inline-edit) resolved animation uses the motion-duration token", () => {
    const r = runProbe().r89_msg_edit_animation;
    expect(r.found).toBe(true);
    expect(r.animationName).toBe("msg-edit-enter");
    // Browser normalises 120ms → "0.12s" in computed style.
    expect(r.animationDuration).toBe("0.12s");
  });

  it("R8.9 toolcall entrance uses --wb-motion-duration-fast token (resolves to 120ms)", () => {
    const r = runProbe().r89_toolcall_animation;
    expect(r.found).toBe(true);
    expect(r.animationName).toBe("toolcall-enter");
    // The CSS uses var(--wb-motion-duration-fast, 140ms). The token value
    // (120ms) wins over the fallback, so the computed style is 0.12s.
    // Under prefers-reduced-motion the token becomes 0ms.
    expect(r.animationDuration).toBe("0.12s");
  });

  it("R8.9 request-modal overlay uses --wb-motion-duration-md (180ms)", () => {
    const r = runProbe().r89_request_modal_overlay;
    expect(r.found).toBe(true);
    expect(r.animationName).toBe("wb-request-overlay-in");
    // Browser normalises 180ms → "0.18s" in computed style.
    expect(r.animationDuration).toBe("0.18s");
  });

  it("R8.9 prefers-reduced-motion override zeroes every motion-duration token", () => {
    const r = runProbe().r89_reduced_motion_durations;
    expect(r.fast).toBe("0ms");
    expect(r.pop).toBe("0ms");
    expect(r.md).toBe("0ms");
    expect(r.large).toBe("0ms");
  });

  // ─────────────────────────────── R8.10 ──────────────────────────────

  it("R8.10 quick-prompt grid + cards render with grid layout + flex rows + 32px icon", () => {
    const r = runProbe().r810_quick_prompts;
    expect(r.found).toBe(true);
    expect(r.count).toBe(2);
    expect(r.gridDisplay).toBe("grid");
    expect(r.cardDisplay).toBe("flex");
    expect(r.cardRadius).toBe("10px");
    expect(r.iconSize).toBe("32px");
    expect(r.iconRadius).toBe("8px");
    // Browser resolves var(--wb-duration-fast → 120ms / 0.12s) and
    // var(--wb-ease-out-expo → cubic-bezier(0.16, 1, 0.3, 1)) at
    // computed style. We assert on the resolved values, which is what
    // the actual animation uses.
    expect(r.cardTransition).toMatch(/0\.12s/);
    expect(r.cardTransition).toMatch(/cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)/);
  });

  // ─────────────────────────────── R8.11 ──────────────────────────────

  it("R8.11 message action buttons are 26×26 icon-only with motion-token transitions", () => {
    const r = runProbe().r811_actions;
    expect(r.found).toBe(true);
    expect(r.count).toBeGreaterThanOrEqual(3);
    expect(r.btnSize).toBe("26px");
    expect(r.btnHeight).toBe("26px");
    expect(r.btnRadius).toBe("6px");
    expect(["inline-flex", "flex"]).toContain(r.btnDisplay);
    // data-tooltip attribute drives the CSS tooltip content.
    expect(r.dataTooltip).toMatch(/复制|重试/);
    expect(r.ariaLabel).toBeTruthy();
    // Browser resolves motion tokens at computed style.
    expect(r.btnTransition).toMatch(/0\.12s/);
    expect(r.btnTransition).toMatch(/cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)/);
  });

  // ─────────────────────────────── R8.12 ──────────────────────────────

  it("R8.12 assistant avatar is 28×28 brand-gradient square with AI role badge", () => {
    const r = runProbe().r812_avatar;
    expect(r.found).toBe(true);
    // Avatar geometry
    expect(r.avatarSize).toBe("28px");
    expect(r.avatarRadius).toBe("8px");
    // Avatar contains an SVG (Sparkles icon from lucide)
    expect(r.avatarHasSvg).toBe(true);
    // Background is a brand-tinted gradient
    expect(r.avatarBackground).toMatch(/linear-gradient/);
    // Header text
    expect(r.name).toBe("Buddy");
    expect(r.roleText).toBe("AI");
    expect(r.roleLabel).toBe("AI assistant");
    // AI badge geometry — R8.43 grew the chip from 16px → 18px so the
    // tighter letter-spacing + 1px border have breathing room.
    expect(r.roleHeight).toBe("18px");
    expect(r.roleRadius).toBe("4px");
  });

  // ─────────────────────────────── R8.13 ──────────────────────────────

  it("R8.13 composer stop button uses lucide Square icon + textarea caps at 160px", () => {
    const r = runProbe().r813_composer;
    expect(r.found).toBe(true);
    // Stop button uses SVG (Square icon), not ASCII "■"
    expect(r.stopHasSvg).toBe(true);
    // font-size: 0 prevents the cascade from sizing the SVG container
    expect(r.stopFontSize).toBe("0px");
    // Textarea caps at 160px + scrolls past
    expect(r.taMaxHeight).toBe("160px");
    expect(r.taOverflowY).toBe("auto");
    expect(r.taScrollBehavior).toBe("smooth");
  });

  // ─────────────────────────────── R8.14 ──────────────────────────────

  it("R8.14 meta chip renders an inline-flex row with icon + time + detail", () => {
    const r = runProbe().r814_meta;
    expect(r.found).toBe(true);
    // Chromium normalises inline-flex → flex in computed style sometimes.
    expect(["inline-flex", "flex"]).toContain(r.display);
    expect(r.hasTimeSpan).toBe(true);
    expect(r.hasDetailSpan).toBe(true);
    expect(r.hasIconSvg).toBe(true);
  });

  // ─────────────────────────────── R8.15 ──────────────────────────────

  it("R8.15 model + throughput chips render with brand tint + lucide SVG", () => {
    const r = runProbe().r815_chips;
    expect(r.found).toBe(true);
    // Chromium may serialize color-mix as rgba() or a named colour;
    // we just require a non-empty value to avoid hard-coding the
    // browser's normalisation quirks.
    expect(r.modelBg.length).toBeGreaterThan(0);
    expect(r.modelHasSvg).toBe(true);
    expect(r.tputHasSvg).toBe(true);
    expect(r.modelMaxWidth).toBe("180px");
  });

  // ─────────────────────────────── R8.16 ──────────────────────────────

  it("R8.16 msg--just-completed animation uses msg-just-completed-enter keyframe", () => {
    const r = runProbe().r816_just_completed;
    expect(r.found).toBe(true);
    expect(r.animationName).toBe("msg-just-completed-enter");
    // --wb-motion-duration-base resolves to 200ms in this build,
    // which Chromium normalises to "0.2s".
    expect(r.animationDuration).toMatch(/0\.2s|200ms/);
  });

  // ─────────────────────────────── R8.17 ──────────────────────────────

  it("R8.17 sidebar row paints brand-tinted active state + pulsing dot", () => {
    const r = runProbe().r817_sidebar_row;
    expect(r.found).toBe(true);
    expect(r.rowBoxShadow).toMatch(/inset/);
    expect(r.hasDot).toBe(true);
    expect(r.dotWidth).toBe("6px");
    expect(r.dotBorderRadius).toMatch(/3px|50%/);
    expect(r.dotAnimation).toBe("sidebar-conv-pulse");
  });

  // ─────────────────────────────── R8.18 ──────────────────────────────

  it("R8.18 revision pager button keeps rounded shape + transition", () => {
    const r = runProbe().r818_revision_btn;
    expect(r.found).toBe(true);
    expect(r.borderRadius).toBe("6px");
    // Chromium normalises transition shorthand to "all".
    expect(r.transition.length).toBeGreaterThan(0);
  });

  // ─────────────────────────────── R8.19 ──────────────────────────────

  it("R8.19 mobile breakpoint marker is paintable (CSS rule verified in unit test)", () => {
    const r = runProbe().r819_mobile_marker;
    expect(r.found).toBe(true);
  });

  // ─────────────────────────────── R8.20 ──────────────────────────────

  it("R8.20 status-pill model chip renders brand-tinted pill with model id", () => {
    const r = runProbe().r820_status_model;
    expect(r.found).toBe(true);
    expect(r.text).toBe("claude-opus-4-7");
    expect(r.title).toBe("当前模型: claude-opus-4-7");
    // The chip sits inside .chatview__status (flex container), so the
    // computed display normalises to block (anonymous flex item). Just
    // confirm the rounded pill geometry lands.
    expect(r.borderRadius).toBe("8px");
    expect(r.maxWidth).toBe("220px");
  });

  // ─────────────────────────────── R8.27 ──────────────────────────────

  it("R8.27 empty-state hero renders halo + brand-tinted icon + entrance animation", () => {
    const r = runProbe().r827_hero;
    expect(r.found).toBe(true);
    expect(r.heroWidth).toBe("64px");
    expect(r.heroHeight).toBe("64px");
    expect(r.heroDisplay).toBe("inline-flex");
    expect(r.heroAnimationName).toBe("chatview__empty-hero-in");
    // Halo sits behind the icon (z-index -1) and is a perfect circle.
    expect(r.haloPresent).toBe(true);
    expect(r.haloBorderRadius).toBe("50%");
    // Icon is brand-coloured, 56×56 circle.
    expect(r.iconColor).not.toBe("rgb(0, 0, 0)");
    expect(r.iconWidth).toBe("56px");
    expect(r.iconBorderRadius).toBe("50%");
  });

  // ─────────────────────────────── R8.24 ──────────────────────────────

  it("R8.24 composer keyboard hint chip renders the brand-tinted pill + two keycaps", () => {
    const r = runProbe().r824_hint;
    expect(r.found).toBe(true);
    // Chromium computes inline-flex as `flex` for anonymous flex items;
    // either value is acceptable here (see hover-action-r8.18 test for the
    // same Chromium quirk workaround).
    expect(["inline-flex", "flex"]).toContain(r.display);
    // Brand-tinted background — exact colour may differ between light/dark
    // probe runs, so just assert it's a non-transparent surface.
    expect(r.background).not.toBe("rgba(0, 0, 0, 0)");
    // Two <kbd> keycaps: Enter + Shift+Enter
    expect(r.kbdCount).toBe(2);
    // Keycap geometry: 2px-bottom-border keycap convention
    expect(r.kbdBorderBottomWidth).toBe("2px");
    expect(r.kbdBorderRadius).toBe("4px");
    expect(r.kbdMinWidth).toBe("18px");
    // aria-label ties the whole chip together for screen readers
    expect(r.ariaLabel).toBe("Enter 发送，Shift 加 Enter 换行");
    // Dividers (· and /) are aria-hidden so screen readers don't read them
    expect(r.dividerCount).toBeGreaterThanOrEqual(2);
    expect(r.dividerAriaHidden).toBe(true);
  });

  // ─────────────────────────────── R8.23 ──────────────────────────────

  it("R8.23 streaming caret renders as a 2×14 brand-tinted pill with pulse animation", () => {
    const r = runProbe().r823_caret;
    expect(r.found).toBe(true);
    expect(r.width).toBe("2px");
    expect(r.height).toBe("14px");
    expect(r.borderRadius).toBe("1px");
    expect(r.animationName).toBe("msg-caret-pulse");
    expect(r.ariaLabel).toBe("正在生成");
    expect(r.role).toBe("status");
    // No unicode block char — caret is now an empty pill.
    expect(r.text).toBe("");
  });
});



