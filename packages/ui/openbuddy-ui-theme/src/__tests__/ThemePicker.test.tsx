import { describe, expect, it, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { ThemeProvider, useTheme, __resetThemeService } from "../client";
import { ThemePicker } from "../components/ThemePicker";
import { THEMES } from "../themes";

afterEach(() => {
  cleanup();
  // R61 — the theme service is a module-level singleton (by design: the React
  // tree and the plugin ctx must share one store). That means `mode` set by
  // one test ("Match system") leaks into the next, which makes
  // `SystemPairRow` render <option> elements whose text collides with the
  // chip labels the search tests assert on. Dropping the singleton forces the
  // next test to rebuild from localStorage, i.e. real per-test isolation.
  __resetThemeService();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-name");
});

function Harness() {
  return (
    <ThemeProvider>
      <ThemePicker label="Choose theme" />
    </ThemeProvider>
  );
}

/** Probe subscribes to the live store so its DOM reflects mode/name changes. */
function Probe({ children }: { children: React.ReactNode }) {
  const service = useTheme();
  const [, force] = useState(0);
  useEffect(() => service.subscribe(() => force((n) => n + 1)), [service]);
  return (
    <div>
      <span data-testid="current">{service.currentName()}</span>
      <span data-testid="mode">{service.mode()}</span>
      {children}
    </div>
  );
}

function ProbeHarness() {
  return (
    <ThemeProvider>
      <Probe>
        <ThemePicker label="Choose theme" />
      </Probe>
    </ThemeProvider>
  );
}

describe("@openbuddy/ui-theme/ThemePicker", () => {
  it("renders a trigger button", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: /choose theme/i })).toBeTruthy();
  });

  it("opens a popover listing all 19 themes grouped dark/light", async () => {
    render(<Harness />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /choose theme/i }));
    });
    const menu = await screen.findByRole("menu");
    for (const t of THEMES) {
      expect(within(menu).getByText(t.label)).toBeTruthy();
    }
  });

  it("clicking a theme row updates data-theme-name and closes the popover", async () => {
    render(<Harness />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /choose theme/i }));
    });
    const sakura = await screen.findByText("Sakura");
    act(() => {
      fireEvent.click(sakura);
    });
    expect(document.documentElement.getAttribute("data-theme-name")).toBe(
      "sakura",
    );
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  it("Match-system mode toggle changes mode to system", async () => {
    render(<ProbeHarness />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /choose theme/i }));
    });
    const matchSystem = await screen.findByText(/^On$/);
    act(() => {
      fireEvent.click(matchSystem);
    });
    await waitFor(() => {
      expect(screen.getByTestId("mode").textContent).toBe("system");
    });
  });

  it("compact=false renders the labeled trigger with the current theme name", () => {
    render(
      <ThemeProvider>
        <ThemePicker compact={false} />
      </ThemeProvider>,
    );
    const trigger = screen.getByRole("button", { name: /theme/i });
    expect(trigger.textContent ?? "").toMatch(/claude|paper|openbuddy/i);
  });

  it("Match-system mode shows the light/dark pair selector", async () => {
    render(<ProbeHarness />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /choose theme/i }));
    });
    const matchSystem = await screen.findByText(/^On$/);
    act(() => {
      fireEvent.click(matchSystem);
    });
    // The pair row's hint text contains "当前:" plus the active theme name.
    await waitFor(() => {
      const hint = screen.getByText((_, el) => {
        return !!el && /当前:/.test(el.textContent ?? "") && el.className.includes("pairHint");
      });
      expect(hint).toBeTruthy();
    });
  });
});

describe("R61 — ThemePicker search", () => {
  it("renders a search input inside the popover", async () => {
    render(<Harness />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /choose theme/i }));
    });
    await screen.findByRole("menu");
    const input = screen.getByTestId("theme-search");
    expect(input).toBeTruthy();
    expect(input.getAttribute("placeholder")).toBe("搜索主题…");
  });

  it("typing filters the theme list by label", async () => {
    render(<Harness />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /choose theme/i }));
    });
    await screen.findByRole("menu");
    const input = screen.getByTestId("theme-search");
    act(() => {
      fireEvent.change(input, { target: { value: "sakura" } });
    });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Sakura")).toBeTruthy();
    // Themes not matching "sakura" should be filtered out
    expect(within(menu).queryByText("Black")).toBeNull();
    expect(within(menu).queryByText("Aurora")).toBeNull();
  });

  it("search is case-insensitive", async () => {
    render(<Harness />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /choose theme/i }));
    });
    await screen.findByRole("menu");
    const input = screen.getByTestId("theme-search");
    act(() => {
      fireEvent.change(input, { target: { value: "SAKURA" } });
    });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Sakura")).toBeTruthy();
  });

  it("search matches theme name too (hyphenated)", async () => {
    render(<Harness />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /choose theme/i }));
    });
    await screen.findByRole("menu");
    const input = screen.getByTestId("theme-search");
    act(() => {
      fireEvent.change(input, { target: { value: "midnight" } });
    });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Midnight Ocean")).toBeTruthy();
    expect(within(menu).queryByText("Sakura")).toBeNull();
  });

  it("shows the clear button when search is non-empty and clears on click", async () => {
    render(<Harness />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /choose theme/i }));
    });
    await screen.findByRole("menu");
    const input = screen.getByTestId("theme-search");
    act(() => {
      fireEvent.change(input, { target: { value: "sakura" } });
    });
    const clearBtn = screen.getByRole("button", { name: /清除搜索/i });
    expect(clearBtn).toBeTruthy();
    act(() => {
      fireEvent.click(clearBtn);
    });
    expect(input.getAttribute("value")).toBe("");
    // All themes visible again
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Sakura")).toBeTruthy();
    expect(within(menu).getByText("Black")).toBeTruthy();
  });
});
