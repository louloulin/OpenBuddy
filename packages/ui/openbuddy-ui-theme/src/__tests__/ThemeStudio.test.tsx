import { describe, expect, it, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ThemeStudio,
  parseOklch,
  formatOklch,
  readCustomThemes,
  writeCustomThemes,
  applyCustomVars,
  type CustomTheme,
} from "../components/ThemeStudio";
import { resolveVars } from "../themes";

vi.mock("../client", () => {
  // R46 — ThemeStudio 用 useTheme().syncDocument() 还原 preview 残留。
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
    currentName: () => "claude" as never,
    mode: () => "manual" as const,
    getPair: () => ({ light: "openbuddy" as never, dark: "openbuddy-dark" as never }),
    setThemeByName: () => undefined,
    setPair: () => undefined,
    setMode: () => undefined,
    list: () => [],
    applyCustomTheme: (t: { name: string; type: string; vars: Record<string, string> }) => {
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
    // 模拟真实 store:写内置主题的 vars,把 inline --wb-* 清干净
    syncDocument: () => {
      const html = document.documentElement;
      html.setAttribute("data-theme", "light");
      html.setAttribute("data-theme-name", "claude");
      for (let i = html.style.length - 1; i >= 0; i--) {
        const p = html.style.item(i);
        if (p.startsWith("--wb-")) html.style.removeProperty(p);
      }
    },
  };
  return { useTheme: () => service };
});

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("ThemeStudio — OKLCh helpers", () => {
  it("parses a plain OKLCh string", () => {
    expect(parseOklch("oklch(0.72 0.12 45)")).toEqual({ l: 0.72, c: 0.12, h: 45 });
  });

  it("parses an OKLCh string with alpha", () => {
    const v = parseOklch("oklch(0.72 0.12 45 / 0.16)");
    expect(v).toEqual({ l: 0.72, c: 0.12, h: 45 });
  });

  it("returns null for non-OKLCh values", () => {
    expect(parseOklch("#c0c0c0")).toBeNull();
    expect(parseOklch(undefined)).toBeNull();
    expect(parseOklch("rgb(1,2,3)")).toBeNull();
  });

  it("round-trips through formatOklch", () => {
    const v = { l: 0.5, c: 0.1, h: 200 };
    expect(parseOklch(formatOklch(v))).toEqual(v);
  });
});

describe("ThemeStudio — custom theme persistence", () => {
  const theme: CustomTheme = {
    name: "custom-mine",
    label: "Mine",
    type: "dark",
    accent: "oklch(0.7 0.1 200)",
    vars: { "--wb-accent": "oklch(0.7 0.1 200)" },
  };

  it("writes and reads custom themes", () => {
    writeCustomThemes([theme]);
    expect(readCustomThemes()).toEqual([theme]);
  });

  it("returns [] when storage is empty or corrupt", () => {
    expect(readCustomThemes()).toEqual([]);
    window.localStorage.setItem("openbuddy.theme.custom", "{not json");
    expect(readCustomThemes()).toEqual([]);
  });

  it("applyCustomVars writes vars + the custom marker", () => {
    applyCustomVars({ "--wb-accent": "oklch(0.5 0.1 100)" });
    expect(
      document.documentElement.style.getPropertyValue("--wb-accent"),
    ).toBe("oklch(0.5 0.1 100)");
    expect(document.documentElement.getAttribute("data-theme-name")).toBe("custom");
    document.documentElement.removeAttribute("data-theme-name");
    document.documentElement.style.removeProperty("--wb-accent");
  });
});

describe("ThemeStudio — component", () => {
  it("renders sliders seeded from the initial vars", () => {
    render(<ThemeStudio initialVars={resolveVars("claude")} />);
    expect(screen.getByTestId("theme-studio")).toBeTruthy();
    // 4 groups × their tokens, each with L/C/H sliders.
    const sliders = screen.getAllByRole("slider");
    expect(sliders.length).toBeGreaterThan(0);
  });

  it("updates the live document variables when a slider moves", () => {
    render(<ThemeStudio initialVars={resolveVars("claude")} />);
    const sliders = screen.getAllByRole("slider");
    const first = sliders[0] as HTMLInputElement;
    act(() => {
      fireEvent.change(first, { target: { value: "0.9" } });
    });
    // Any --wb-* variable must now be written to documentElement.
    const accent = document.documentElement.style.getPropertyValue("--wb-accent");
    const bg = document.documentElement.style.getPropertyValue("--wb-bg-primary");
    expect(accent || bg).toBeTruthy();
  });

  it("saves a custom theme to localStorage and calls onSave", () => {
    const onSave = vi.fn();
    render(
      <ThemeStudio
        initialVars={resolveVars("aurora")}
        initialLabel="Aurora Custom"
        onSave={onSave}
      />,
    );
    act(() => {
      fireEvent.click(screen.getByText("保存"));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = readCustomThemes();
    expect(saved.length).toBe(1);
    expect(saved[0].label).toBe("Aurora Custom");
    expect(saved[0].name).toBe("custom-aurora-custom");
  });

  it("reset restores the initial vars", () => {
    render(<ThemeStudio initialVars={resolveVars("claude")} />);
    const sliders = screen.getAllByRole("slider");
    const first = sliders[0] as HTMLInputElement;
    const initial = first.value;
    act(() => {
      fireEvent.change(first, { target: { value: "0.9" } });
    });
    expect((screen.getAllByRole("slider")[0] as HTMLInputElement).value).not.toBe(initial);
    act(() => {
      fireEvent.click(screen.getByText("还原"));
    });
    expect((screen.getAllByRole("slider")[0] as HTMLInputElement).value).toBe(initial);
  });
});

describe("R46 — ThemeStudio preview 还原 + save 保留", () => {
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

  it("调滑块后:documentElement 上有 preview 的 inline --wb-* vars", () => {
    render(<ThemeStudio initialVars={resolveVars("claude")} />);
    const sliders = screen.getAllByRole("slider");
    act(() => {
      fireEvent.change(sliders[0] as HTMLInputElement, { target: { value: "0.5" } });
    });
    // 任何 --wb-* 内联 vars 应该已被 preview 写入
    const anyWbVar = Array.from(
      document.documentElement.style as unknown as ArrayLike<string>,
    ).some((k) => (k as string).startsWith("--wb-"));
    expect(anyWbVar).toBe(true);
    expect(document.documentElement.getAttribute("data-theme-name")).toBe("custom");
  });

  it("未保存 → unmount 后:documentElement 还原到 active theme 的 vars(prev 防泄漏)", () => {
    const { unmount } = render(<ThemeStudio initialVars={resolveVars("claude")} />);
    // 先调一下滑块,触发 preview
    act(() => {
      fireEvent.change(screen.getAllByRole("slider")[0] as HTMLInputElement, {
        target: { value: "0.5" },
      });
    });
    // 卸载
    act(() => {
      unmount();
    });
    // mock 的 syncDocument 把 inline --wb-* 全清掉,data-theme-name 改为 claude
    expect(document.documentElement.getAttribute("data-theme-name")).toBe("claude");
    const leftoverWb = Array.from(
      document.documentElement.style as unknown as ArrayLike<string>,
    ).some((k) => (k as string).startsWith("--wb-"));
    expect(leftoverWb).toBe(false);
  });

  it("已保存 → unmount 后:active 保留 custom,syncDocument 不被调用", () => {
    const { unmount } = render(
      <ThemeStudio
        initialVars={resolveVars("aurora")}
        initialLabel="Aurora Custom"
      />,
    );
    // 点击「保存」,savedRef 置 true
    act(() => {
      fireEvent.click(screen.getByText("保存"));
    });
    // 保存后 ACTIVE_CUSTOM_KEY 已写入
    expect(window.localStorage.getItem("openbuddy.theme.custom.active")).toBe(
      "custom-aurora-custom",
    );
    // 现在卸载——之前没有 inline preview vars(mock 的 syncDocument 已经被
    // 我们前面 observe 到的 applyCustomVars 写入),由于 savedRef=true,
    // unmount 不再调用 syncDocument,所以 inline --wb-* vars 应该保留。
    // mock 的 syncDocument 会把所有 --wb-* 清空,所以只要 inline vars 仍
    // 存在(没被 syncDocument 清掉),就证明 unmount 没有还原。
    const wbVarCountBefore = Array.from(
      document.documentElement.style as unknown as ArrayLike<string>,
    ).filter((k) => (k as string).startsWith("--wb-")).length;
    expect(wbVarCountBefore).toBeGreaterThan(0);
    act(() => {
      unmount();
    });
    const wbVarCountAfter = Array.from(
      document.documentElement.style as unknown as ArrayLike<string>,
    ).filter((k) => (k as string).startsWith("--wb-")).length;
    expect(wbVarCountAfter).toBe(wbVarCountBefore);
  });

  it("点击「还原」:draft 回到 initial,documentElement 立即还原到 active theme", () => {
    render(<ThemeStudio initialVars={resolveVars("claude")} />);
    const firstSlider = screen.getAllByRole("slider")[0] as HTMLInputElement;
    const initialValue = firstSlider.value;
    // 调滑块让 preview 生效
    act(() => {
      fireEvent.change(firstSlider, { target: { value: "0.1" } });
    });
    expect((screen.getAllByRole("slider")[0] as HTMLInputElement).value).not.toBe(
      initialValue,
    );
    // 点还原
    act(() => {
      fireEvent.click(screen.getByText("还原"));
    });
    // draft 滑块值回到 initial
    expect((screen.getAllByRole("slider")[0] as HTMLInputElement).value).toBe(
      initialValue,
    );
    // mock syncDocument 把 inline --wb-* 清掉 → 还原路径生效
    const leftoverWb = Array.from(
      document.documentElement.style as unknown as ArrayLike<string>,
    ).some((k) => (k as string).startsWith("--wb-"));
    expect(leftoverWb).toBe(false);
  });
});
