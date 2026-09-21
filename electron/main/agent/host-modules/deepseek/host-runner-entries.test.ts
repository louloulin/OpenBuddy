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
  unshippedDshHostRunnerEntries,
} from "./host-runner-entries";
import { resolveDeepSeekRuntimeModule } from "../../../deepseek/deepseek-runtime";

describe("host-runner-entries / baseHostRunnerEntries", () => {
  it("only ships entries whose package name resolves to a local shim", () => {
    const entries = baseHostRunnerEntries();
    // LUM-1320: the default assembly must never contain an entry that cannot
    // be resolved. `electron/main/deepseek/deepseek-runtime.ts` is the single
    // source of local DSH shims, so every shipped entry must be one of its
    // `deepSeekRuntimeAliases` keys.
    for (const entry of entries) {
      expect(resolveDeepSeekRuntimeModule(entry.name), `${entry.name} has no runtime alias`).toBeDefined();
    }
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      "@deepseek-ai/dsh-agent",
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-session",
      "@deepseek-ai/dsh-session-persistence-jsonl",
      "@deepseek-ai/dsh-session-query",
      "@deepseek-ai/dsh-typert-registry",
      "@deepseek-ai/dsh-workspace",
    ]);
  });

  it("keeps id/name shapes for the shipped entries", () => {
    for (const entry of baseHostRunnerEntries()) {
      expect(typeof entry.id).toBe("string");
      expect(entry.id.startsWith("openbuddy-dsh-")).toBe(true);
      expect(typeof entry.name).toBe("string");
      expect(entry.name.startsWith("@deepseek-ai/")).toBe(true);
    }
  });

  it("keeps the 36 unshipped DSH names as a documented migration inventory", () => {
    const unshipped = unshippedDshHostRunnerEntries();
    // Dev + installer have no `@deepseek-ai/*` dependency closure, so these
    // names cannot be mounted; they stay listed for the PI-native migration
    // table and for user profiles that install the upstream closure.
    expect(unshipped).toHaveLength(36);
    expect(baseHostRunnerEntries().length + unshipped.length).toBe(43);
    const ids = new Set([...baseHostRunnerEntries(), ...unshipped].map((entry) => entry.id));
    expect(ids.size).toBe(43);
    for (const entry of unshipped) {
      expect(resolveDeepSeekRuntimeModule(entry.name)).toBeUndefined();
      expect(entry.id.startsWith("openbuddy-dsh-")).toBe(true);
      expect(entry.name.startsWith("@deepseek-ai/")).toBe(true);
    }
  });

  it("preserves config and inject shapes for entries that carry them", () => {
    const byId = new Map(unshippedDshHostRunnerEntries().map((entry) => [entry.id, entry]));

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

  it("merges baseProfile → defaults → coreCapability → profileBundle in that exact order", () => {
    const coreEntries: PluginEntryOptions[] = [
      { id: "@deepseek-ai/dsh-commands", name: "@deepseek-ai/dsh-commands" },
    ];
    const merged = composeHostRunnerEntries(baseProfileEntries, profileBundleEntries, coreEntries);
    const ids = merged.map((entry) => entry.id);
    // baseProfile entries come first (e.g. addons beyond DSH defaults).
    expect(ids.indexOf("openbuddy-base-foo")).toBe(0);
    expect(ids.indexOf("openbuddy-base-bar")).toBe(1);
    // Then the shipped default DSH entries.
    expect(ids.indexOf("openbuddy-dsh-session")).toBe(2);
    expect(ids.indexOf("openbuddy-dsh-session-query")).toBe(2 + baseHostRunnerEntries().length - 1);
    // Phase K.2: core capability entries slot in between defaults and
    // profileBundle so marketplace bundles can override them when needed.
    expect(ids.indexOf("@deepseek-ai/dsh-commands")).toBe(2 + baseHostRunnerEntries().length);
    // profileBundle entries close out so they override earlier duplicates.
    expect(ids[ids.length - 1]).toBe("marketplace-baz");
  });

  it("never composes an unshipped DSH entry by default", () => {
    const merged = composeHostRunnerEntries([], [], []);
    const unshippedIds = new Set(unshippedDshHostRunnerEntries().map((entry) => entry.id));
    const leaked = merged.filter((entry) => unshippedIds.has(entry.id));
    expect(leaked).toEqual([]);
  });

  it("still honours an explicit profile-bundle declaration of an unshipped DSH name", () => {
    const merged = composeHostRunnerEntries([], [
      { id: "openbuddy-dsh-llm", name: "@deepseek-ai/dsh-llm" },
    ]);
    expect(merged.some((entry) => entry.id === "openbuddy-dsh-llm")).toBe(true);
  });

  it("tolerates empty baseProfile, coreCapability, and empty profileBundle", () => {
    const merged = composeHostRunnerEntries([], [], []);
    expect(merged.length).toBe(baseHostRunnerEntries().length);
    expect(merged[0]?.id).toBe("openbuddy-dsh-session");
  });

  it("applies normalizeDeepSeekRuntimeEntry defaults on session-persistence entry", () => {
    // The @deepseek-ai/dsh-session-persistence-jsonl entry has a default
    // `root` of `<piHome>/sessions` injected by normalize. Without that,
    // the cordis loader would crash at boot.
    const merged = composeHostRunnerEntries([], [], []);
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
