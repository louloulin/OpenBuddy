import { describe, expect, it, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { ThemeProvider, useTheme } from "../client";
import { ThemePicker } from "../components/ThemePicker";
import { THEMES } from "../themes";

afterEach(() => {
  cleanup();
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
    const matchSystem = await screen.findByText("跟随系统");
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
    const matchSystem = await screen.findByText("跟随系统");
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
