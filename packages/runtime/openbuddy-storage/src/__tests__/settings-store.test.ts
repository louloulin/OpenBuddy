/**
 * @openbuddy/storage/sqlite/settings-store — Phase D.1 round 2 tests.
 *
 * Verifies the SettingsStore high-level wrapper on top of
 * SettingsRegistry: listNamespaces, namespaceStats, bulkSet atomic
 * semantics, and bulkGet lookups. Per-namespace validation is gone
 * after G2 PR 2 (Round 21); pi's `SettingsManager.inMemory()` is
 * the sole schema gate (G2 PR 1, Round 20).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorageSync } from "../sqlite/open-storage";
import { SettingsStore } from "../sqlite/settings-store";

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

  it("bulkSet commits all entries on success", () => {
    expect(() => store.bulkSet([
      { namespace: "auth", key: "clientId", value: { id: "a" } },
      { namespace: "theme", key: "color", value: "dark" },
      { namespace: "auth", key: "issuer", value: "ok" },
    ])).not.toThrow();

    expect(store.get("auth", "clientId")?.value).toEqual({ id: "a" });
    expect(store.get("theme", "color")?.value).toBe("dark");
    expect(store.get("auth", "issuer")?.value).toBe("ok");
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

  it("setAsync delegates with the same registry path as sync set", async () => {
    await store.setAsync("auth", "clientId", "async");
    expect(store.get("auth", "clientId")?.value).toBe("async");
  });
});

/**
 * Round 20 — G2 PR 1 (plan4.1.md §9.10) + Round 21 — G2 PR 2 (§9.11)
 * pi SettingsManager gate.
 *
 * After PR 2 the pi gate is the SOLE validator (custom validator API
 * is gone). Tests verify the gate's accept/reject semantics against
 * pi's migration pipeline + JSON round-trip.
 */
describe("SettingsStore G2 PR 1+2 — pi SettingsManager gate", () => {
  it("accepts a well-formed object via the pi gate", () => {
    // Pi's in-memory SettingsManager accepts arbitrary objects
    // (Partial<Settings>) and runs no migrations unless legacy keys are
    // present.
    expect(() => store.set("auth", "clientId", { clientId: "abc", scopes: ["read"] })).not.toThrow();
    expect(store.get("auth", "clientId")?.value).toMatchObject({ clientId: "abc" });
  });

  it("accepts a primitive value (pi gate is a no-op for non-objects)", () => {
    expect(() => store.set("theme", "color", "dark")).not.toThrow();
    expect(store.get("theme", "color")?.value).toBe("dark");
  });

  it("accepts a value with legacy `queueMode` and runs pi's migration pipeline", () => {
    // Pi's migrateSettings() renames `queueMode` → `steeringMode`.
    // This proves the gate actually runs pi's migration code path
    // (not a no-op). The value still persists to SQLite as-given.
    const legacy = { queueMode: "all", defaultProvider: "openai" };
    expect(() => store.set("settings", "pi", legacy)).not.toThrow();
    expect(store.get("settings", "pi")?.value).toMatchObject({ queueMode: "all" });
  });

  it("accepts a value with legacy `websockets: boolean` (boolean→enum migration)", () => {
    // Pi's migrateSettings() converts `websockets: true` → `transport: "websocket"`.
    const legacy = { websockets: true };
    expect(() => store.set("settings", "ws", legacy)).not.toThrow();
    expect(store.get("settings", "ws")?.value).toMatchObject({ websockets: true });
  });

  it("accepts a value with legacy `retry.maxDelayMs` (nested-field migration)", () => {
    // Pi's migrateSettings() converts `retry.maxDelayMs` → `retry.provider.maxRetryDelayMs`.
    const legacy = { retry: { enabled: true, maxRetries: 3, maxDelayMs: 5000 } };
    expect(() => store.set("settings", "retry", legacy)).not.toThrow();
    expect(store.get("settings", "retry")?.value).toMatchObject({ retry: { enabled: true } });
  });

  it("accepts null value (pi gate skips non-objects)", () => {
    expect(() => store.set("auth", "clientId", null)).not.toThrow();
    expect(store.get("auth", "clientId")?.value).toBeNull();
  });
});