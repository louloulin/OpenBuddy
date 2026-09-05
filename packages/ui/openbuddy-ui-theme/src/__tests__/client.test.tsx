import { describe, expect, it, afterEach } from "vitest";
import { act, cleanup, render, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { ThemeProvider, useTheme, useThemeSnapshot } from "../client";
import type { Theme } from "../index";

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* storage may be unavailable in some test envs */
  }
  document.documentElement.removeAttribute("data-theme");
});

function ThemeProbe(): { theme: string; setTheme: (t: Theme) => void } {
  const service = useTheme();
  // Snapshot subscription — must re-render when the store notifies.
  const theme = useThemeSnapshot((s) => s.current());
  return {
    theme,
    setTheme: (t) => service.setPreference(t),
  };
}

describe("@openbuddy/ui-theme/client — useThemeSnapshot", () => {
  it("returns the current theme and re-renders when the theme changes", () => {
    const Harness = (): JSX.Element => {
      const probe = ThemeProbe();
      return (
        <div>
          <span data-testid="theme">{probe.theme}</span>
          <button data-testid="dark" onClick={() => probe.setTheme("dark")}>
            dark
          </button>
          <button data-testid="light" onClick={() => probe.setTheme("light")}>
            light
          </button>
        </div>
      );
    };

    const { getByTestId } = render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );

    expect(getByTestId("theme").textContent).toBe("light");
    act(() => {
      fireEvent.click(getByTestId("dark"));
    });
    expect(getByTestId("theme").textContent).toBe("dark");
    act(() => {
      fireEvent.click(getByTestId("light"));
    });
    expect(getByTestId("theme").textContent).toBe("light");
  });

  it("writes data-theme on documentElement whenever the snapshot changes", () => {
    const Harness = (): JSX.Element => {
      const probe = ThemeProbe();
      // Force a re-render on each prop change to make the assertion robust.
      const [, force] = useState(0);
      return (
        <div>
          <button data-testid="bump" onClick={() => force((n) => n + 1)}>
            bump
          </button>
          <button data-testid="dark" onClick={() => probe.setTheme("dark")}>
            dark
          </button>
          <button data-testid="light" onClick={() => probe.setTheme("light")}>
            light
          </button>
        </div>
      );
    };

    const { getByTestId } = render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    act(() => {
      fireEvent.click(getByTestId("dark"));
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    act(() => {
      fireEvent.click(getByTestId("light"));
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
