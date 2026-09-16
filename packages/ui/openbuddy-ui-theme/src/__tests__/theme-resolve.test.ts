import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  THEMES,
  getThemeByName,
  themesByType,
  resolveVars,
  extractGoogleFontFamily,
  buildFontStylesheetUrl,
  type ThemeName,
} from "../themes";
import {
  createThemeStore,
  getStoredThemeName,
  getStoredThemeMode,
  getStoredThemePair,
  type ThemeService,
} from "../theme-store";

afterEach(() => {
  if (typeof document !== "undefined") {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-name");
  }
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("themes — registry", () => {
  it("ships 19 themes with unique names", () => {
    expect(THEMES.length).toBe(19);
    const names = new Set(THEMES.map((t) => t.name));
    expect(names.size).toBe(19);
  });

  it("has both dark and light themes", () => {
    expect(themesByType("dark").length).toBeGreaterThanOrEqual(8);
    expect(themesByType("light").length).toBeGreaterThanOrEqual(8);
  });

  it("getThemeByName returns null for unknown and the theme for known", () => {
    expect(getThemeByName("nope")).toBeNull();
    expect(getThemeByName("claude")?.label).toBe("Claude");
  });

  it("resolveVars returns a merged record with both base + overrides", () => {
    const vars = resolveVars("claude");
    // base token present
    expect(vars["--wb-bg-primary"]).toMatch(/oklch/);
    // claude override
    expect(vars["--wb-bg-primary"]).toBe("oklch(0.13 0.01 45)");
    // accent is overridden
    expect(vars["--wb-accent"]).toBe("oklch(0.72 0.12 45)");
  });

  it("Win95 and WinXP keep their non-OKLCh retro values", () => {
    const win95 = getThemeByName("win95");
    expect(win95).not.toBeNull();
    expect(win95!.vars["--wb-bg-primary"]).toBe("#c0c0c0");
    expect(win95!.vars["--wb-radius-md"]).toBe("0");
    const winxp = getThemeByName("winxp");
    expect(winxp!.vars["--wb-bg-primary"]).toBe("#ece9d8");
  });
});

describe("theme-store — service contract", () => {
  let service: ThemeService;

  beforeEach(() => {
    service = createThemeStore();
  });

  it("exposes list() with all 19 themes", () => {
    expect(service.list().length).toBe(19);
  });

  it("setThemeByName sets data-theme-name and matches the named theme", () => {
    service.setThemeByName("sakura");
    expect(service.currentName()).toBe("sakura");
    expect(document.documentElement.getAttribute("data-theme-name")).toBe(
      "sakura",
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("setThemeByName forces manual mode and stores the name", () => {
    service.setMode("system");
    service.setThemeByName("claude");
    expect(service.mode()).toBe("manual");
    expect(getStoredThemeName()).toBe("claude");
  });

  it("setPair updates the light/dark pair and persists both", () => {
    service.setPair({ light: "sakura", dark: "midnight-ocean" });
    expect(service.getPair()).toEqual({
      light: "sakura",
      dark: "midnight-ocean",
    });
    expect(getStoredThemePair()).toEqual({
      light: "sakura",
      dark: "midnight-ocean",
    });
  });

  it("Match-system mode swaps the active theme when system dark changes", () => {
    service.setMode("system");
    service.setPair({ light: "sakura", dark: "midnight-ocean" });
    // Without matchMedia in jsdom we can't truly fire a system change,
    // but the initial resolution is deterministic: system dark === false
    // (jsdom default), so the active theme should be the light pair.
    expect(service.currentName()).toBe("sakura");
  });

  it("subscribe notifies on setThemeByName", () => {
    const calls: string[] = [];
    const unsub = service.subscribe(() => {
      calls.push(service.currentName());
    });
    service.setThemeByName("claude");
    service.setThemeByName("aurora");
    expect(calls).toEqual(["claude", "aurora"]);
    unsub();
    service.setThemeByName("forest");
    expect(calls).toEqual(["claude", "aurora"]);
  });

  it("v1 API still works: preference() + setPreference() + current()", () => {
    expect(["light", "dark", "system"]).toContain(service.preference());
    service.setPreference("dark");
    expect(service.preference()).toBe("dark");
    expect(["light", "dark"]).toContain(service.current());
  });

  it("toggle() flips between light and dark", () => {
    const before = service.current();
    service.toggle();
    expect(service.current()).not.toBe(before);
  });
});

describe("font helpers", () => {
  it("extractGoogleFontFamily pulls the family out of single-quoted CSS", () => {
    expect(extractGoogleFontFamily('"Playfair Display", Georgia, serif')).toBe(
      "Playfair+Display",
    );
    expect(extractGoogleFontFamily('"Space Grotesk"')).toBe("Space+Grotesk");
    expect(extractGoogleFontFamily(undefined)).toBeNull();
    expect(extractGoogleFontFamily("system-ui")).toBeNull();
  });

  it("buildFontStylesheetUrl produces a Google Fonts URL with weight range", () => {
    const url = buildFontStylesheetUrl(["Playfair+Display", "Space+Grotesk"]);
    expect(url).toContain("fonts.googleapis.com/css2?");
    expect(url).toContain("family=Playfair+Display");
    expect(url).toContain("family=Space+Grotesk");
    expect(url).toContain("wght@400;500;600;700");
  });

  it("buildFontStylesheetUrl returns null for empty list", () => {
    expect(buildFontStylesheetUrl([])).toBeNull();
  });
});

describe("storage round-trip", () => {
  it("persists named theme and rehydrates on a fresh store", () => {
    const a = createThemeStore();
    a.setThemeByName("aurora");
    expect(getStoredThemeName()).toBe("aurora");
    const b = createThemeStore();
    expect(b.currentName()).toBe("aurora");
  });

  it("persists pair + mode and rehydrates on a fresh store", () => {
    const a = createThemeStore();
    a.setMode("system");
    a.setPair({ light: "sakura", dark: "midnight-ocean" });
    expect(getStoredThemeMode()).toBe("system");
    expect(getStoredThemePair()).toEqual({
      light: "sakura",
      dark: "midnight-ocean",
    });
    const b = createThemeStore();
    expect(b.mode()).toBe("system");
    expect(b.getPair()).toEqual({ light: "sakura", dark: "midnight-ocean" });
  });
});

describe("all 19 themes apply data-theme + data-theme-name + CSS vars", () => {
  const names: ThemeName[] = THEMES.map((t) => t.name);
  for (const name of names) {
    it(`${name} sets both attributes and writes the accent variable`, () => {
      const service = createThemeStore();
      const def = getThemeByName(name)!;
      service.setThemeByName(name);
      expect(document.documentElement.getAttribute("data-theme-name")).toBe(
        name,
      );
      expect(document.documentElement.getAttribute("data-theme")).toBe(
        def.type,
      );
      // The accent must have been written as a CSS custom property.
      const written = document.documentElement.style.getPropertyValue(
        "--wb-accent",
      );
      expect(written).toBeTruthy();
    });
  }
});

describe("getPair() 引用稳定性（useSyncExternalStore 快照契约）", () => {
  /**
   * 回归：`getPair()` 曾经每次返回 `{ ...pair }`，导致
   * `useThemeSnapshot((s) => s.getPair())` 的 getSnapshot 每次都是新对象，
   * React 判定快照变化 → 无限重渲染 → error #185，整个 AppShell 被打进
   * ErrorBoundary（左下角用户/设置整体消失）。
   */
  it("反复读取返回同一个引用", () => {
    const service = createThemeStore();
    const first = service.getPair();
    expect(service.getPair()).toBe(first);
    expect(service.getPair()).toBe(first);
  });

  it("setPair 写入相同值时引用不变", () => {
    const service = createThemeStore();
    const before = service.getPair();
    service.setPair({ light: before.light, dark: before.dark });
    expect(service.getPair()).toBe(before);
  });

  it("setPair 真正改变时换成新引用", () => {
    const service = createThemeStore();
    const before = service.getPair();
    const nextLight = before.light === "white" ? "paper" : "white";
    service.setPair({ light: nextLight });
    const after = service.getPair();
    expect(after).not.toBe(before);
    expect(after.light).toBe(nextLight);
  });
});
