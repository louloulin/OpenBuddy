/**
 * init-pi-dsh-core-extensions.test.ts — Phase B.3 step 2a tests.
 *
 * Mirrors the init-pi-user-extensions test cases but for the DSH core
 * loader. Until B.3 step 2b extracts the 7 DSH core shims into real
 * files, `dshCorePaths` is empty and the stage is a no-op. The cases
 * below lock in the no-op fast-path and the defensive catch; the live
 * load path is exercised in the production path builder.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createExtensionRuntime: vi.fn(() => ({ __runtime: "stub" })),
  discoverAndLoadExtensions: vi.fn(),
}));

import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { createDefaultAgentHostState } from "../_default-state";
import { initPiDshCoreExtensions } from "./init-pi-dsh-core-extensions";

function makeState() {
  return createDefaultAgentHostState();
}

describe("init-pi-dsh-core-extensions (Phase B.3 step 2a)", () => {
  beforeEach(() => {
    vi.mocked(discoverAndLoadExtensions).mockReset();
  });

  it("returns the no-op summary when dshCorePaths is empty (B.3 step 2a baseline)", async () => {
    const state = makeState();
    const emit = vi.fn();
    const result = await initPiDshCoreExtensions({
      state, cwd: "/work", emitPluginEvent: emit, dshCorePaths: [],
    });
    expect(result).toEqual({ loaded: 0, failed: 0, failedIds: [] });
    expect(emit).not.toHaveBeenCalled();
    expect(vi.mocked(discoverAndLoadExtensions)).not.toHaveBeenCalled();
  });

  it("emits plugin/loaded for each extension returned by PI discoverAndLoadExtensions (B.3 step 2b ready)", async () => {
    const state = makeState();
    const emit = vi.fn();
    vi.mocked(discoverAndLoadExtensions).mockResolvedValue({
      extensions: [
        { path: "/dsh-core/commands/index.ts", resolvedPath: "/dsh-core/commands/index.ts" },
        { path: "/dsh-core/goal/index.ts", resolvedPath: "/dsh-core/goal/index.ts" },
      ],
      errors: [],
      runtime: {} as never,
    } as never);

    const result = await initPiDshCoreExtensions({
      state, cwd: "/work", emitPluginEvent: emit,
      dshCorePaths: ["/dsh-core/commands/index.ts", "/dsh-core/goal/index.ts"],
    });

    expect(vi.mocked(discoverAndLoadExtensions)).toHaveBeenCalledWith(
      ["/dsh-core/commands/index.ts", "/dsh-core/goal/index.ts"],
      "/work",
      undefined,
      undefined,
    );
    expect(result).toEqual({ loaded: 2, failed: 0, failedIds: [] });
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(1, "plugin/loaded", {
      id: "/dsh-core/commands/index.ts",
      source: "pi-dsh-core-extensions",
      path: "/dsh-core/commands/index.ts",
    });
    expect(emit).toHaveBeenNthCalledWith(2, "plugin/loaded", {
      id: "/dsh-core/goal/index.ts",
      source: "pi-dsh-core-extensions",
      path: "/dsh-core/goal/index.ts",
    });
  });

  it("emits plugin/failed for each error entry and includes failedIds", async () => {
    const state = makeState();
    const emit = vi.fn();
    vi.mocked(discoverAndLoadExtensions).mockResolvedValue({
      extensions: [],
      errors: [
        { path: "/dsh-core/broken/index.ts", error: "syntax error" },
      ],
      runtime: {} as never,
    } as never);

    const result = await initPiDshCoreExtensions({
      state, cwd: "/work", emitPluginEvent: emit,
      dshCorePaths: ["/dsh-core/broken/index.ts"],
    });

    expect(result).toEqual({
      loaded: 0,
      failed: 1,
      failedIds: ["/dsh-core/broken/index.ts"],
    });
    expect(emit).toHaveBeenCalledWith("plugin/failed", {
      id: "/dsh-core/broken/index.ts",
      source: "pi-dsh-core-extensions",
      error: "syntax error",
    });
  });

  it("returns the defensive summary if discoverAndLoadExtensions itself throws", async () => {
    const state = makeState();
    const emit = vi.fn();
    vi.mocked(discoverAndLoadExtensions).mockRejectedValue(new Error("jiti blew up"));

    const result = await initPiDshCoreExtensions({
      state, cwd: "/work", emitPluginEvent: emit,
      dshCorePaths: ["/dsh-core/commands/index.ts", "/dsh-core/goal/index.ts"],
    });

    expect(result).toEqual({
      loaded: 0,
      failed: 2,
      failedIds: ["pi-dsh-core-extensions"],
    });
    expect(emit).toHaveBeenCalledWith("plugin/failed", {
      id: "pi-dsh-core-extensions",
      source: "pi-dsh-core-extensions",
      error: "jiti blew up",
    });
  });

  it("Phase B.3 step 2b — accepts real @openbuddy/dsh-core source paths", async () => {
    // The whole point of B.3 step 2b is that `dshCorePaths` now points
    // at real files (the goals.ts + message-feedback.ts from
    // packages/runtime/openbuddy-dsh-core/src). The loader passes
    // them through to discoverAndLoadExtensions verbatim; this test
    // pins the contract by passing the actual source paths and
    // asserting they're forwarded unchanged.
    const state = makeState();
    const emit = vi.fn();
    vi.mocked(discoverAndLoadExtensions).mockResolvedValue({
      extensions: [
        { path: "/repo/packages/runtime/openbuddy-dsh-core/src/goals.ts", resolvedPath: "/repo/packages/runtime/openbuddy-dsh-core/src/goals.ts" },
        { path: "/repo/packages/runtime/openbuddy-dsh-core/src/message-feedback.ts", resolvedPath: "/repo/packages/runtime/openbuddy-dsh-core/src/message-feedback.ts" },
      ],
      errors: [],
      runtime: {} as never,
    } as never);

    const realPaths = [
      "/repo/packages/runtime/openbuddy-dsh-core/src/goals.ts",
      "/repo/packages/runtime/openbuddy-dsh-core/src/message-feedback.ts",
    ];
    const result = await initPiDshCoreExtensions({
      state, cwd: "/work", emitPluginEvent: emit,
      dshCorePaths: realPaths,
    });

    // The paths are forwarded to PI's discoverAndLoadExtensions unchanged.
    expect(vi.mocked(discoverAndLoadExtensions)).toHaveBeenCalledWith(
      realPaths,
      "/work",
      undefined,
      undefined,
    );
    expect(result).toEqual({ loaded: 2, failed: 0, failedIds: [] });
    // The emit events use the same path as the id so renderer-side
    // diagnostics can correlate the load to a source file.
    expect(emit).toHaveBeenNthCalledWith(1, "plugin/loaded", {
      id: realPaths[0],
      source: "pi-dsh-core-extensions",
      path: realPaths[0],
    });
    expect(emit).toHaveBeenNthCalledWith(2, "plugin/loaded", {
      id: realPaths[1],
      source: "pi-dsh-core-extensions",
      path: realPaths[1],
    });
  });
});
