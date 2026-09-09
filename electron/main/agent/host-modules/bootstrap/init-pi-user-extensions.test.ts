/**
 * init-pi-user-extensions.test.ts — Phase B.3 step 1 tests.
 *
 * Verifies the no-op fast-path (empty profile), the emit-event surface
 * (plugin/loaded + plugin/failed), and the defensive catch when
 * `discoverAndLoadExtensions` itself throws.
 *
 * The actual PI loader (jiti-based, file-system reads, plugin discovery)
 * is exercised in PI's own test suite; this file stubs the loader so the
 * bootstrap-stage contract is locked down independently of PI's internals.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createExtensionRuntime: vi.fn(() => ({ __runtime: "stub" })),
  discoverAndLoadExtensions: vi.fn(),
}));

import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { createDefaultAgentHostState } from "../_default-state";
import { initPiUserExtensions } from "./init-pi-user-extensions";

function makeState(profilePiPackagePaths: string[]) {
  const state = createDefaultAgentHostState();
  state.profilePiPackagePaths.splice(0, state.profilePiPackagePaths.length, ...profilePiPackagePaths);
  return state;
}

describe("init-pi-user-extensions (Phase B.3 step 1)", () => {
  beforeEach(() => {
    vi.mocked(discoverAndLoadExtensions).mockReset();
  });

  it("returns the no-op summary when profile has no PI user plugins", async () => {
    const state = makeState([]);
    const emit = vi.fn();
    const result = await initPiUserExtensions({ state, cwd: "/tmp", emitPluginEvent: emit });
    expect(result).toEqual({ loaded: 0, failed: 0, failedIds: [] });
    expect(emit).not.toHaveBeenCalled();
    expect(vi.mocked(discoverAndLoadExtensions)).not.toHaveBeenCalled();
  });

  it("emits plugin/loaded for each extension returned by PI discoverAndLoadExtensions", async () => {
    const state = makeState(["/path/a.ts", "/path/b.ts"]);
    const emit = vi.fn();
    vi.mocked(discoverAndLoadExtensions).mockResolvedValue({
      extensions: [
        { path: "/path/a.ts", resolvedPath: "/path/a.ts" },
        { path: "/path/b.ts", resolvedPath: "/path/b.ts" },
      ],
      errors: [],
      // The runtime field is required by LoadExtensionsResult; we don't
      // touch it from the consumer side so any object works.
      runtime: {} as never,
    } as never);

    const result = await initPiUserExtensions({ state, cwd: "/work", emitPluginEvent: emit });

    expect(vi.mocked(discoverAndLoadExtensions)).toHaveBeenCalledWith(
      ["/path/a.ts", "/path/b.ts"],
      "/work",
      undefined,
      undefined,
    );
    expect(result).toEqual({ loaded: 2, failed: 0, failedIds: [] });
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(1, "plugin/loaded", {
      id: "/path/a.ts",
      source: "pi-user-extensions",
      path: "/path/a.ts",
    });
    expect(emit).toHaveBeenNthCalledWith(2, "plugin/loaded", {
      id: "/path/b.ts",
      source: "pi-user-extensions",
      path: "/path/b.ts",
    });
  });

  it("emits plugin/failed for each error entry and includes failedIds", async () => {
    const state = makeState(["/path/broken-a.ts", "/path/broken-b.ts"]);
    const emit = vi.fn();
    vi.mocked(discoverAndLoadExtensions).mockResolvedValue({
      extensions: [],
      errors: [
        { path: "/path/broken-a.ts", error: "syntax error at line 1" },
        { path: "/path/broken-b.ts", error: "missing export default" },
      ],
      runtime: {} as never,
    } as never);

    const result = await initPiUserExtensions({ state, cwd: "/work", emitPluginEvent: emit });

    expect(result).toEqual({
      loaded: 0,
      failed: 2,
      failedIds: ["/path/broken-a.ts", "/path/broken-b.ts"],
    });
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(1, "plugin/failed", {
      id: "/path/broken-a.ts",
      source: "pi-user-extensions",
      error: "syntax error at line 1",
    });
  });

  it("returns the defensive 0/N summary if discoverAndLoadExtensions itself throws", async () => {
    const state = makeState(["/path/a.ts", "/path/b.ts"]);
    const emit = vi.fn();
    vi.mocked(discoverAndLoadExtensions).mockRejectedValue(new Error("runtime chokes"));

    const result = await initPiUserExtensions({ state, cwd: "/work", emitPluginEvent: emit });

    expect(result).toEqual({
      loaded: 0,
      failed: 2,
      failedIds: ["pi-user-extensions"],
    });
    expect(emit).toHaveBeenCalledWith("plugin/failed", {
      id: "pi-user-extensions",
      source: "pi-user-extensions",
      error: "runtime chokes",
    });
  });
});
