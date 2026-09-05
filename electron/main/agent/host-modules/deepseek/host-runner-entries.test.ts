import { describe, expect, it, vi } from "vitest";
import type { PluginEntryOptions } from "@openbuddy/plugin-host";

// Mock electron because composeHostRunnerEntries -> normalizeDeepSeekRuntimeEntry
// -> cordis-runtime.ts -> agent-host.ts transitively registers
// app.on("before-quit", ...) at module top-level. In the unit-test
// environment there is no Electron `app` instance, so a real import would
// crash before any assertion runs.
vi.mock("electron", () => ({
  app: { on: () => undefined, getPath: () => "/tmp/openbuddy-host-runner-entries-test" },
}));

import {
  baseHostRunnerEntries,
  composeHostRunnerEntries,
} from "./host-runner-entries";

describe("host-runner-entries / baseHostRunnerEntries", () => {
  it("returns a frozen-style array with the canonical 41 OpenBuddy DSH entries", () => {
    const entries = baseHostRunnerEntries();
    // 40 DSH defaults + dsh-tool-jobs is one of them, total = 41 (see source).
    expect(entries.length).toBeGreaterThanOrEqual(40);
    // Every entry must have id + name.
    for (const entry of entries) {
      expect(typeof entry.id).toBe("string");
      expect(entry.id.startsWith("openbuddy-dsh-")).toBe(true);
      expect(typeof entry.name).toBe("string");
      expect(entry.name.startsWith("@deepseek-ai/")).toBe(true);
    }
    // The list is order-stable: dsh-llm is first (services root),
    // dsh-web is last (model-facing tool adapters close out).
    expect(entries[0]?.id).toBe("openbuddy-dsh-llm");
    expect(entries[entries.length - 1]?.id).toBe("openbuddy-dsh-web");
  });

  it("preserves config and inject shapes for entries that carry them", () => {
    const entries = baseHostRunnerEntries();
    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    const instructions = byId.get("openbuddy-dsh-agent-instructions");
    expect(instructions?.config).toEqual({
      maxBytes: 128 * 1024,
      maxSourceBytes: 1024 * 1024,
    });

    const jobs = byId.get("openbuddy-dsh-tool-jobs");
    expect(Array.isArray(jobs?.inject)).toBe(true);

    const todo = byId.get("openbuddy-dsh-tool-todo");
    expect(todo?.config).toEqual({ allowParallelInProgress: false });

    const web = byId.get("openbuddy-dsh-tool-web");
    expect(web?.config).toEqual({ search: true, fetch: true });

    const workflow = byId.get("openbuddy-dsh-tool-workflow");
    expect(workflow?.config).toEqual({ maxTotalAgents: 32, maxResultChars: 50000 });
  });

  it("returns the same reference on repeat calls (no per-call copy)", () => {
    expect(baseHostRunnerEntries()).toBe(baseHostRunnerEntries());
  });
});

describe("host-runner-entries / composeHostRunnerEntries", () => {
  const baseProfileEntries: PluginEntryOptions[] = [
    { id: "openbuddy-base-foo", name: "@deepseek-ai/dsh-foo" },
    { id: "openbuddy-base-bar", name: "@deepseek-ai/dsh-bar", disabled: true },
  ];
  const profileBundleEntries: PluginEntryOptions[] = [
    { id: "marketplace-baz", name: "@deepseek-ai/dsh-baz" },
  ];

  it("merges baseProfile → defaults → profileBundle in that exact order", () => {
    const merged = composeHostRunnerEntries(baseProfileEntries, profileBundleEntries);
    const ids = merged.map((entry) => entry.id);
    // baseProfile entries come first (e.g. addons beyond DSH defaults).
    expect(ids.indexOf("openbuddy-base-foo")).toBe(0);
    expect(ids.indexOf("openbuddy-base-bar")).toBe(1);
    // Then the 41 default DSH entries.
    expect(ids.indexOf("openbuddy-dsh-llm")).toBe(2);
    expect(ids.indexOf("openbuddy-dsh-web")).toBe(2 + baseHostRunnerEntries().length - 1);
    // profileBundle entries close out so they override earlier duplicates.
    expect(ids[ids.length - 1]).toBe("marketplace-baz");
  });

  it("tolerates empty baseProfile and empty profileBundle", () => {
    const merged = composeHostRunnerEntries([], []);
    expect(merged.length).toBe(baseHostRunnerEntries().length);
    expect(merged[0]?.id).toBe("openbuddy-dsh-llm");
  });

  it("applies normalizeDeepSeekRuntimeEntry defaults on session-persistence entry", () => {
    // The @deepseek-ai/dsh-session-persistence-jsonl entry has a default
    // `root` of `<piHome>/sessions` injected by normalize. Without that,
    // the cordis loader would crash at boot.
    const merged = composeHostRunnerEntries([], []);
    const persistence = merged.find(
      (entry) => entry.id === "openbuddy-dsh-session-persistence",
    );
    expect(persistence).toBeDefined();
    expect(persistence?.config).toBeDefined();
    expect(
      (persistence?.config as { root?: unknown } | undefined)?.root,
    ).toEqual(expect.stringContaining("sessions"));
  });

  it("preserves user-supplied config on profileBundle entries (does not overwrite)", () => {
    const merged = composeHostRunnerEntries([], [
      { id: "marketplace-baz", name: "@deepseek-ai/dsh-baz", config: { custom: true } },
    ]);
    const baz = merged.find((entry) => entry.id === "marketplace-baz");
    expect(baz?.config).toEqual({ custom: true });
  });

  it("forwards disabled flag from baseProfile entries through normalize", () => {
    const merged = composeHostRunnerEntries(baseProfileEntries, []);
    const bar = merged.find((entry) => entry.id === "openbuddy-base-bar");
    expect(bar?.disabled).toBe(true);
  });

  it("defaults omitted arguments to empty arrays", () => {
    const mergedNoBase = composeHostRunnerEntries();
    const mergedOnlyBundle = composeHostRunnerEntries(undefined, profileBundleEntries);
    expect(mergedNoBase.length).toBe(baseHostRunnerEntries().length);
    expect(mergedOnlyBundle[mergedOnlyBundle.length - 1]?.id).toBe("marketplace-baz");
  });
});
