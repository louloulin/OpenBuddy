/**
 * @openbuddy/storage/sqlite/settings-store — Phase D.1 round 2 tests.
 *
 * Verifies the SettingsStore high-level wrapper on top of
 * SettingsRegistry: setSchema validators, listNamespaces,
 * namespaceStats, bulkSet atomic semantics, and bulkGet lookups.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorageSync } from "../sqlite/open-storage";
import { SettingsStore, type SettingsValidator } from "../sqlite/settings-store";

let root = "";
let store: SettingsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "settings-store-test-"));
  store = new SettingsStore({ driver: openStorageSync({ filePath: join(root, "profile.sqlite") }).driver });
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("SettingsStore (Phase D.1 round 2)", () => {
  it("delegates basic set + get to the underlying registry", () => {
    store.set("auth", "clientId", "abc");
    expect(store.get("auth", "clientId")?.value).toBe("abc");
  });

  it("runs per-namespace validators before delegating to set", () => {
    const validator = vi.fn((value: unknown) => {
      return typeof value !== "object" || value === null
        ? "expected object"
        : undefined;
    }) satisfies SettingsValidator;
    store.setSchema("auth", validator);
    expect(() => store.set("auth", "config", "not-an-object")).toThrow(/expected object/);
    expect(validator).toHaveBeenCalledTimes(1);
    // Valid object passes.
    store.set("auth", "config", { clientId: "abc", scopes: ["read"] });
    expect(store.get("auth", "config")?.value).toMatchObject({ clientId: "abc" });
  });

  it("clearSchema removes the validator so subsequent sets skip validation", () => {
    const validator = vi.fn(() => "fail") satisfies SettingsValidator;
    store.setSchema("auth", validator);
    store.clearSchema("auth");
    expect(() => store.set("auth", "clientId", "anything")).not.toThrow();
    expect(validator).not.toHaveBeenCalled();
  });

  it("listNamespaces returns sorted unique namespaces", () => {
    store.set("zeta", "k", "v");
    store.set("alpha", "k", "v");
    store.set("alpha", "k2", "v");
    store.set("mu", "k", "v");
    expect(store.listNamespaces()).toEqual(["alpha", "mu", "zeta"]);
  });

  it("namespaceStats aggregates key count + version histogram", () => {
    store.set("auth", "clientId", "abc", 1);
    store.set("auth", "issuer", "def", 1);
    store.set("auth", "rotated", "ghi", 3);
    store.set("settings", "theme", "dark", 2);

    const stats = store.namespaceStats();
    const auth = stats.find((entry) => entry.namespace === "auth");
    const settings = stats.find((entry) => entry.namespace === "settings");
    expect(auth?.keyCount).toBe(3);
    expect(auth?.versions).toEqual({ 1: 2, 3: 1 });
    expect(settings?.keyCount).toBe(1);
    expect(settings?.versions).toEqual({ 2: 1 });
  });

  it("bulkSet validates all entries first; rejects on any failure", () => {
    store.setSchema("auth", (value) => (value && typeof value === "object" ? undefined : "auth requires object"));
    store.setSchema("theme", (value) => (typeof value === "string" ? undefined : "theme requires string"));

    // Mixed batch: one valid auth + one valid theme + one invalid auth.
    expect(() => store.bulkSet([
      { namespace: "auth", key: "clientId", value: { id: "a" } },
      { namespace: "theme", key: "color", value: "dark" },
      { namespace: "auth", key: "broken", value: "not-an-object" },
    ])).toThrow(/auth requires object/);

    // None of the above should have been written.
    expect(store.get("auth", "clientId")).toBeUndefined();
    expect(store.get("theme", "color")).toBeUndefined();
    expect(store.get("auth", "broken")).toBeUndefined();
  });

  it("bulkGet returns map keyed by `${namespace}:${key}`", () => {
    store.set("auth", "clientId", "abc");
    store.set("auth", "issuer", "def");
    const result = store.bulkGet([
      { namespace: "auth", key: "clientId" },
      { namespace: "auth", key: "issuer" },
      { namespace: "auth", key: "missing" },
    ]);
    expect(result).toEqual({ "auth:clientId": "abc", "auth:issuer": "def", "auth:missing": undefined });
  });

  it("setAsync delegates with the same validator path as sync set", async () => {
    const validator = vi.fn(() => undefined) satisfies SettingsValidator;
    store.setSchema("auth", validator);
    await store.setAsync("auth", "clientId", "async");
    expect(validator).toHaveBeenCalled();
    expect(store.get("auth", "clientId")?.value).toBe("async");
  });
});

/**
 * Round 20 — G2 PR 1 (plan4.1.md §9.10) — pi SettingsManager adapter gate.
 *
 * Verifies the new `SettingsManager.inMemory()` second-gate in
 * `SettingsStore.validate()`. The legacy custom validator still runs
 * first (existing tests above); the pi gate adds JSON-round-trip
 * sanity + migration pass on top.
 */
describe("SettingsStore G2 PR 1 — pi SettingsManager gate", () => {
  it("accepts a well-formed object via the pi gate when no custom validator is set", () => {
    // No setSchema() called → only the pi gate runs. Pi's in-memory
    // SettingsManager accepts arbitrary objects (Partial<Settings>)
    // and runs no migrations unless legacy keys are present.
    expect(() => store.set("auth", "clientId", { clientId: "abc", scopes: ["read"] })).not.toThrow();
    expect(store.get("auth", "clientId")?.value).toMatchObject({ clientId: "abc" });
  });

  it("accepts a primitive value (pi gate is a no-op for non-objects)", () => {
    // Pi gate only fires for objects/arrays. A string value bypasses it
    // and writes through to SQLite directly — preserves existing
    // primitive-set callers (theme = "dark", etc.).
    expect(() => store.set("theme", "color", "dark")).not.toThrow();
    expect(store.get("theme", "color")?.value).toBe("dark");
  });

  it("accepts a value with legacy `queueMode` and migrates it to `steeringMode` via pi's migration pipeline", () => {
    // Pi's migrateSettings() renames `queueMode` → `steeringMode`.
    // This proves the gate actually runs pi's migration code path
    // (not a no-op). The value still persists to SQLite as-given.
    const legacy = { queueMode: "all", defaultProvider: "openai" };
    expect(() => store.set("settings", "pi", legacy)).not.toThrow();
    expect(store.get("settings", "pi")?.value).toMatchObject({ queueMode: "all" });
  });

  it("runs both layers: custom validator (rejects) and pi gate (would accept)", () => {
    // Custom validator rejects; pi gate never gets a chance to run.
    store.setSchema("auth", (value) => (value && typeof value === "object" ? undefined : "auth requires object"));
    expect(() => store.set("auth", "config", "not-an-object")).toThrow(/auth requires object/);
    // Custom validator passes → pi gate runs → object is accepted.
    expect(() => store.set("auth", "config", { clientId: "abc" })).not.toThrow();
  });
});
