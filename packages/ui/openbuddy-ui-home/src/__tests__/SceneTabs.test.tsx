import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { SceneTabs } from "../SceneTabs";

/**
 * LUM-1320 regression.
 *
 * `SceneTabs` called `useT()` (a hook) *inside* a `useMemo` callback. That is a
 * Rules-of-Hooks violation, so mounting the 灵感 / 资料库 route made React throw
 * error #300 ("Rendered fewer hooks than expected") and the whole workbench fell
 * into its ErrorBoundary — reproducible only in the real renderer, which is why
 * the unit suites never saw it.
 *
 * The dev React runtime reports the violation on the offending component, so
 * asserting on `console.error` is the tightest possible guard here: it fails on
 * the pre-fix code and passes once every hook is called at the top level.
 */
describe("SceneTabs", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  const rulesOfHooksWarnings = () =>
    errorSpy.mock.calls
      .map((call) => String(call[0] ?? ""))
      .filter((message) => /Do not call Hooks|Rendered (more|fewer) hooks|order of Hooks/i.test(message));

  it("renders the three scene tabs without violating the Rules of Hooks", () => {
    render(<SceneTabs activeMode="working" onChange={() => undefined} />);
    expect(screen.getAllByRole("tab").length).toBeGreaterThanOrEqual(3);
    expect(rulesOfHooksWarnings()).toEqual([]);
  });

  it("keeps the hook order stable across rerenders and mode changes", () => {
    const view = render(<SceneTabs activeMode="working" onChange={() => undefined} />);
    view.rerender(<SceneTabs activeMode="coding" onChange={() => undefined} />);
    view.rerender(<SceneTabs activeMode="design" onChange={() => undefined} />);
    expect(rulesOfHooksWarnings()).toEqual([]);
  });
});
