import { describe, expect, it, afterEach } from "vitest";
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
