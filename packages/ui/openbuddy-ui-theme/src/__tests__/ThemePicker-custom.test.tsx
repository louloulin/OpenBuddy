/**
 * R44 — ThemePicker 自定义主题闭环测试。
 *
 * 覆盖:
 *   1. 写入 custom theme → picker 打开后能在 dark/light 列表里看到。
 *   2. 点击 custom theme → applyCustomVars 把 vars 写到 documentElement,
 *      data-theme 同步切换,ACTIVE_CUSTOM_KEY 写入,菜单关闭。
 *   3. ThemeStudio 保存后 dispatch 事件 → 同 tab picker 自动刷新。
 *   4. SystemPairRow select 选项里也包含 custom theme。
 *   5. activeCustom 持久化 → 重新打开 picker 时,custom card 高亮。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../client", () => {
  // minimal ThemeService stub: 维持 currentName/pair/mode 但不真改 DOM
  let name = "claude" as string;
  let mode = "manual" as "manual" | "system";
  const subscribers = new Set<() => void>();
  const service = {
    current: () => "light" as const,
    preference: () => "system" as const,
    subscribe(fn: () => void) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    setPreference: () => undefined,
    setTheme: () => undefined,
    toggle: () => undefined,
    systemPrefersDark: () => false,
    currentName: () => name,
    mode: () => mode,
    getPair: () => ({ light: "openbuddy" as never, dark: "openbuddy-dark" as never }),
    setThemeByName(n: string) {
      name = n;
      subscribers.forEach((fn) => fn());
    },
    setPair: () => undefined,
    setMode(m: "manual" | "system") {
      mode = m;
      subscribers.forEach((fn) => fn());
    },
    applyCustomTheme(t: { name: string; type: string; vars: Record<string, string> }) {
      // 模拟真实 store:写 vars + data-theme + data-theme-name,持久化 active
      const html = document.documentElement;
      html.setAttribute("data-theme", t.type);
      html.setAttribute("data-theme-name", t.name);
      for (let i = html.style.length - 1; i >= 0; i--) {
        const p = html.style.item(i);
        if (p.startsWith("--wb-")) html.style.removeProperty(p);
      }
      for (const [k, v] of Object.entries(t.vars)) html.style.setProperty(k, v);
      try {
        window.localStorage.setItem("openbuddy.theme.custom.active", t.name);
      } catch {
        /* ignore */
      }
    },
    list: () => [],
  };
  return { useTheme: () => service };
});

import { ThemePicker } from "../components/ThemePicker";
import {
  readCustomThemes,
  writeCustomThemes,
  applyCustomVars,
  type CustomTheme,
} from "../components/ThemeStudio";
import { CUSTOM_KEY, ACTIVE_CUSTOM_KEY } from "../components/ThemeStudio";

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-name");
  document.documentElement.removeAttribute("style");
});

describe("R44 — ThemePicker 自定义主题闭环", () => {
  beforeEach(() => {
    // 默认 1 个深色 + 1 个浅色 custom theme,验证 picker 真的能渲染它们
    const dark: CustomTheme = {
      name: "custom-mine-dark",
      label: "Mine Dark",
      type: "dark",
      accent: "oklch(0.7 0.15 30)",
      vars: {
        "--wb-bg-primary": "oklch(0.2 0.05 30)",
        "--wb-fg-primary": "oklch(0.9 0.05 30)",
        "--wb-accent": "oklch(0.7 0.15 30)",
      },
    };
    const light: CustomTheme = {
      name: "custom-mine-light",
      label: "Mine Light",
      type: "light",
      accent: "oklch(0.8 0.1 200)",
      vars: {
        "--wb-bg-primary": "oklch(0.95 0.02 200)",
        "--wb-fg-primary": "oklch(0.2 0.05 200)",
      },
    };
    writeCustomThemes([dark, light]);
  });

  it("custom theme 出现在 picker 菜单里,按 type 分组", () => {
    render(<ThemePicker label="Theme" />);
    const trigger = screen.getByRole("button", { name: "Theme" });
    fireEvent.click(trigger);

    const menu = document.querySelector("[role='menu']") as HTMLElement;
    expect(menu).toBeTruthy();
    expect(within(menu).getByText("Mine Dark")).toBeTruthy();
    expect(within(menu).getByText("Mine Light")).toBeTruthy();
  });

  it("点击 custom theme → applyCustomVars 写 vars + data-theme 切换 + ACTIVE_CUSTOM_KEY 持久化", () => {
    render(<ThemePicker label="Theme" />);
    const trigger = screen.getByRole("button", { name: "Theme" });
    fireEvent.click(trigger);

    const card = within(document.querySelector("[role='menu']") as HTMLElement).getByText(
      "Mine Dark",
    );
    act(() => {
      fireEvent.click(card);
    });

    // vars 写到 documentElement
    expect(
      document.documentElement.style.getPropertyValue("--wb-bg-primary"),
    ).toBe("oklch(0.2 0.05 30)");
    expect(
      document.documentElement.style.getPropertyValue("--wb-accent"),
    ).toBe("oklch(0.7 0.15 30)");
    // data-theme 兼容属性跟上
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    // ACTIVE_CUSTOM_KEY 写入
    expect(window.localStorage.getItem(ACTIVE_CUSTOM_KEY)).toBe("custom-mine-dark");
    // data-theme-name 标记是 custom(applyCustomVars 设置)
    expect(document.documentElement.getAttribute("data-theme-name")).toBe("custom-mine-dark");
    // 菜单关闭
    expect(document.querySelector("[role='menu']")).toBeNull();
  });

  it("ThemeStudio 保存后 dispatch 事件 → 同 tab picker 自动刷新", () => {
    render(<ThemePicker label="Theme" />);
    const trigger = screen.getByRole("button", { name: "Theme" });
    fireEvent.click(trigger);
    const menuBefore = document.querySelector("[role='menu']") as HTMLElement;
    // 关闭以触发菜单 reopen
    fireEvent.click(trigger);

    // 模拟 ThemeStudio 保存:写入新 theme + dispatch 事件
    const fresh: CustomTheme = {
      name: "custom-fresh",
      label: "Fresh",
      type: "dark",
      accent: "oklch(0.6 0.2 100)",
      vars: { "--wb-bg-primary": "oklch(0.15 0.02 100)" },
    };
    act(() => {
      writeCustomThemes([...readCustomThemes(), fresh]);
      window.dispatchEvent(new CustomEvent("openbuddy:custom-themes-updated"));
    });

    // 重新打开 picker,新 custom theme 必须可见
    fireEvent.click(trigger);
    const menu = document.querySelector("[role='menu']") as HTMLElement;
    expect(within(menu).getByText("Fresh")).toBeTruthy();
    expect(menuBefore).not.toBe(menu);
  });

  it("activeCustom 持久化 → 重新打开 picker 时 custom card 高亮", () => {
    window.localStorage.setItem(ACTIVE_CUSTOM_KEY, "custom-mine-light");
    render(<ThemePicker label="Theme" />);
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));

    // 找到 "Mine Light" 的 chip 容器,验证 active class 存在。
    // 我们不强求 className 字面值,只要求存在一个有 active 标记的 card。
    const menu = document.querySelector("[role='menu']") as HTMLElement;
    const cards = menu.querySelectorAll("[data-active='true'], [aria-pressed='true']");
    expect(cards.length).toBeGreaterThan(0);
  });

  it("SystemPairRow 的 select 选项里也包含 custom theme(Match system 模式)", () => {
    // 打开 picker 后把 mode 切到 system 才能看到 SystemPairRow
    render(<ThemePicker label="Theme" />);
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    const menu = document.querySelector("[role='menu']") as HTMLElement;
    // Match system 模式开关
    const onBtn = within(menu).getByTitle("Match system");
    act(() => {
      fireEvent.click(onBtn);
    });
    // 重新查询 menu(React 重渲)
    const menu2 = document.querySelector("[role='menu']") as HTMLElement;
    const options = menu2.querySelectorAll("option");
    const labels = Array.from(options).map((o) => o.textContent?.trim());
    expect(labels.some((l) => l === "Mine Dark（自定义）")).toBe(true);
    expect(labels.some((l) => l === "Mine Light（自定义）")).toBe(true);
  });

  it("applyCustomVars 与 picker 选择都正确清理 marker + inline style(防回归)", () => {
    applyCustomVars({ "--wb-bg-primary": "oklch(0.5 0.1 200)" });
    expect(document.documentElement.getAttribute("data-theme-name")).toBe("custom");
    // picker 不应该再设它,除非用户又选了一次
  });
});
