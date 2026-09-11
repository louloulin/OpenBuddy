/**
 * @openbuddy/ui-theme — tests for the pi theme facade (G6 PR 1).
 *
 * The facade re-exports pi's theme fns. We assert the call shapes match
 * what pi actually exports (positional initTheme, no-arg getters) and
 * that the spec-named `getSettingsListTheme` correctly delegates to pi's
 * `getEditorTheme`.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  initTheme: vi.fn(),
  getMarkdownTheme: vi.fn(() => ({ token: "md" })),
  getSelectListTheme: vi.fn(() => ({ token: "select" })),
  getEditorTheme: vi.fn(() => ({ token: "editor" })),
}));

import {
  initTheme,
  getMarkdownTheme,
  getSelectListTheme,
  getSettingsListTheme,
} from "../theme-pi";
import * as pi from "@earendil-works/pi-coding-agent";

const piMock = pi as unknown as {
  initTheme: ReturnType<typeof vi.fn>;
  getMarkdownTheme: ReturnType<typeof vi.fn>;
  getSelectListTheme: ReturnType<typeof vi.fn>;
  getEditorTheme: ReturnType<typeof vi.fn>;
};

describe("@openbuddy/ui-theme/theme-pi — pi facade", () => {
  it("initTheme delegates to pi with positional args", () => {
    piMock.initTheme.mockClear();
    initTheme("dark", true);
    expect(piMock.initTheme).toHaveBeenCalledWith("dark", true);
  });

  it("initTheme passes through undefined when called with no args", () => {
    piMock.initTheme.mockClear();
    initTheme();
    expect(piMock.initTheme).toHaveBeenCalledWith(undefined, undefined);
  });

  it("getMarkdownTheme returns pi's markdown theme verbatim", () => {
    const theme = getMarkdownTheme();
    expect(theme).toEqual({ token: "md" });
    expect(piMock.getMarkdownTheme).toHaveBeenCalled();
  });

  it("getSelectListTheme returns pi's select-list theme verbatim", () => {
    const theme = getSelectListTheme();
    expect(theme).toEqual({ token: "select" });
    expect(piMock.getSelectListTheme).toHaveBeenCalled();
  });

  it("getSettingsListTheme delegates to pi's getEditorTheme (spec name vs pi name)", () => {
    const theme = getSettingsListTheme();
    expect(theme).toEqual({ token: "editor" });
    // Crucial: pi has `getEditorTheme`, not `getSettingsListTheme`. The
    // spec used the friendly name; the adapter translates it.
    expect(piMock.getEditorTheme).toHaveBeenCalled();
  });
});