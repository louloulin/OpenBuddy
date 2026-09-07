/**
 * preset-helpers.test.ts — smoke tests for preset helpers cluster.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

import {
  installPresetHelpers,
  selectedProfileDirectory,
  createPiToolExtension,
  sessionPresetSelection,
  __resetPresetHelpersForTest,
} from "./preset-helpers";
import { createDefaultAgentHostState } from "./_default-state";

afterEach(() => {
  __resetPresetHelpersForTest();
});

function makeStubState() {
  return createDefaultAgentHostState();
}

describe("preset-helpers", () => {
  it("throws when not installed", async () => {
    expect(() => selectedProfileDirectory()).toThrow(/not installed/);
    expect(() => createPiToolExtension()).toThrow(/not installed/);
    await expect(sessionPresetSelection("/x")).rejects.toThrow(/not installed/);
  });

  it("selectedProfileDirectory prefers profileDir", () => {
    const state = makeStubState();
    state.profileOptions = {
      profileDir: "/abs/profile",
      profile: {} as any,
      profileName: "x",
      home: "/x",
    };
    installPresetHelpers({ state, piHome: () => "" });
    expect(selectedProfileDirectory()).toBe("/abs/profile");
  });

  it("selectedProfileDirectory falls back to <home>/profiles/<name>", () => {
    const state = makeStubState();
    state.profileOptions = {
      profileDir: undefined as any,
      profile: {} as any,
      profileName: "myprof",
      home: "/h",
    };
    installPresetHelpers({ state, piHome: () => "" });
    // join("/h", "profiles", "myprof")
    expect(selectedProfileDirectory()).toMatch(/profiles\/myprof$/);
  });

  it("createPiToolExtension registers tools from preset or registry", () => {
    const state = makeStubState();
    const registerTool = vi.fn();
    state.toolRegistry = { list: () => [{ name: "t1", label: "T1", description: "d", execute: vi.fn() }] } as any;
    installPresetHelpers({ state, piHome: () => "" });
    const factory = createPiToolExtension();
    factory({ registerTool } as any);
    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("createPiToolExtension is no-op when pi.registerTool missing", () => {
    const state = makeStubState();
    state.toolRegistry = { list: () => [] } as any;
    installPresetHelpers({ state, piHome: () => "" });
    const factory = createPiToolExtension();
    expect(() => factory({} as any)).not.toThrow();
  });

  it("sessionPresetSelection returns undefined for missing sessionPath", async () => {
    const state = makeStubState();
    installPresetHelpers({ state, piHome: () => "" });
    expect(await sessionPresetSelection(undefined)).toBeUndefined();
    expect(await sessionPresetSelection(null)).toBeUndefined();
  });

  it("sessionPresetSelection swallows errors from unreadable file", async () => {
    const state = makeStubState();
    installPresetHelpers({ state, piHome: () => "" });
    expect(await sessionPresetSelection("/nonexistent.jsonl")).toBeUndefined();
  });
});
