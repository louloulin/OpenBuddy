/**
 * R36 —— 工作区面板自适应布局求解。
 *
 * 背景(实机测量):面板默认 380 + 导航列默认 200 + sash 5 → 主列只剩 175px,
 * markdown 编辑器被压成十几个字符宽。这里的用例锁死"收敛"与"折成单栏"的边界。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_MIN_WIDTH,
  MAIN_MIN_WIDTH,
  NAV_COLLAPSED_WIDTH,
  NAV_DEFAULT_WIDTH,
  NAV_MAX_WIDTH,
  NAV_MIN_WIDTH,
  NAV_SASH_WIDTH,
  PANEL_DEFAULT_WIDTH,
  PANEL_MIN_WIDTH,
  clampNavWidth,
  clampPanelWidth,
  maxPanelWidth,
  resolvePanelLayout,
  resolvePanelMode,
} from "../tool-side-panel-layout";

describe("clampPanelWidth", () => {
  it("keeps a reasonable default on a wide viewport", () => {
    expect(clampPanelWidth(PANEL_DEFAULT_WIDTH, 1440)).toBe(380);
  });

  it("caps at 60% of the viewport", () => {
    expect(clampPanelWidth(900, 1280)).toBeCloseTo(768, 0);
  });

  it("never goes below the minimum width, even in a tiny window", () => {
    // 480 视口的 60% 是 288 > MIN,所以先按比例;400 视口才算"太窄"。
    expect(clampPanelWidth(380, 480)).toBe(288);
    expect(clampPanelWidth(380, 400)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(380, 320)).toBe(PANEL_MIN_WIDTH);
  });

  it("survives garbage input", () => {
    expect(clampPanelWidth(Number.NaN, 1280)).toBe(380);
    expect(clampPanelWidth(0, Number.NaN)).toBe(380);
    // 视口读数无效时退回 1280 的假定,而不是把面板压到最小。
    expect(maxPanelWidth(Number.NaN)).toBeCloseTo(768, 0);
  });
});

describe("clampNavWidth", () => {
  it("never eats the main column below its minimum", () => {
    // 380 面板:主列保底 260 → 导航列最多 (380-5-260)=115 → 抬到 NAV_MIN_WIDTH。
    expect(clampNavWidth(NAV_DEFAULT_WIDTH, 380)).toBe(NAV_MIN_WIDTH);
    expect(clampNavWidth(200, 300)).toBe(NAV_MIN_WIDTH);
  });

  it("allows the full desired width once the panel is wide enough", () => {
    expect(clampNavWidth(NAV_DEFAULT_WIDTH, 600)).toBe(NAV_DEFAULT_WIDTH);
    expect(clampNavWidth(NAV_MAX_WIDTH, 900)).toBe(NAV_MAX_WIDTH);
    expect(clampNavWidth(10, 900)).toBe(NAV_MIN_WIDTH);
  });
});

describe("resolvePanelLayout", () => {
  const at = (desiredWidth: number, viewportWidth: number, rest = {}) =>
    resolvePanelLayout({
      desiredWidth,
      desiredNavWidth: NAV_DEFAULT_WIDTH,
      viewportWidth,
      ...rest,
    });

  it("flags the default 380px panel as narrow", () => {
    const layout = at(PANEL_DEFAULT_WIDTH, 1280);
    expect(layout.width).toBe(380);
    // 导航列先被压到下限 140,主列仍有 235 < 260 → 仍然判窄。
    expect(layout.mainWidth).toBe(235);
    expect(layout.narrow).toBe(true);
  });

  it("switches back to two columns as soon as the panel is dragged wide enough", () => {
    expect(at(380, 1280).narrow).toBe(true);
    // 405 = 主列 260 + sash 5 + 导航列下限 140。
    expect(at(404, 1280).narrow).toBe(true);
    expect(at(405, 1280).narrow).toBe(false);
    expect(at(405, 1280).mainWidth).toBe(MAIN_MIN_WIDTH);
  });

  it("does not let a saved nav width break the main column", () => {
    const layout = at(380, 1280);
    expect(layout.navWidth).toBe(NAV_MIN_WIDTH);
    expect(layout.width - layout.navWidth - NAV_SASH_WIDTH).toBe(
      layout.mainWidth,
    );
  });

  it("keeps the user's collapse only in two-column mode", () => {
    expect(at(380, 1280, { userCollapsed: true }).navCollapsed).toBe(false);
    expect(at(700, 1280, { userCollapsed: true }).navCollapsed).toBe(true);
  });

  it("pinned forces two columns (explicit user intent wins)", () => {
    const layout = at(380, 1280, { pinned: true });
    expect(layout.narrow).toBe(false);
    expect(layout.navCollapsed).toBe(false);
  });

  it("follows the viewport down to the minimum width", () => {
    expect(at(900, 940).width).toBe(564);
    expect(at(900, 600).width).toBe(360);
  });

  it("never squeezes the chat column below CHAT_MIN_WIDTH when the container is known", () => {
    // 940 窗口 − 左栏 320 = 容器 620 → 面板最多 300(视口 60% 是 564,更松)。
    const layout = resolvePanelLayout({
      desiredWidth: 640,
      desiredNavWidth: NAV_DEFAULT_WIDTH,
      viewportWidth: 940,
      containerWidth: 620,
    });
    expect(layout.width).toBe(620 - CHAT_MIN_WIDTH);
  });

  it("falls back to the viewport cap while the container is still unmeasured", () => {
    expect(at(900, 940, { containerWidth: 0 }).width).toBe(564);
    expect(at(900, 940).width).toBe(564);
  });
});

describe("resolvePanelMode", () => {
  const narrow = { narrow: true, listDetailView: true, hasSelection: false };

  it("uses split whenever both columns fit", () => {
    expect(resolvePanelMode({ ...narrow, narrow: false })).toBe("split");
  });

  it("shows the list first in a narrow panel", () => {
    expect(resolvePanelMode(narrow)).toBe("nav");
  });

  it("shows the detail once something is selected", () => {
    expect(resolvePanelMode({ ...narrow, hasSelection: true })).toBe("main");
  });

  it("honours the back button", () => {
    expect(
      resolvePanelMode({ ...narrow, hasSelection: true, forceList: true }),
    ).toBe("nav");
  });

  it("always shows the detail for non list/detail views (browser)", () => {
    expect(resolvePanelMode({ ...narrow, listDetailView: false })).toBe("main");
  });
});

describe("width constants stay in sync with the stylesheet", () => {
  const css = readFileSync(
    resolve(__dirname, "../../../../../src/styles/work-panel.css"),
    "utf8",
  );

  it("matches .tool-side-panel__sash width", () => {
    const m = /\.tool-side-panel__sash\s*\{[^}]*?width:\s*(\d+)px/.exec(css);
    expect(m?.[1]).toBe(String(NAV_SASH_WIDTH));
  });

  it("matches .tool-side-panel__nav--collapsed width", () => {
    const m = /\.tool-side-panel__nav--collapsed\s*\{[^}]*?width:\s*(\d+)px/.exec(
      css,
    );
    expect(m?.[1]).toBe(String(NAV_COLLAPSED_WIDTH));
  });

  it("matches .tool-side-panel__nav--full taking the whole column", () => {
    expect(css).toContain(".tool-side-panel__nav--full");
  });
});
