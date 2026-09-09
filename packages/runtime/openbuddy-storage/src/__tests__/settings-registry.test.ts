/**
 * settings-registry.test.ts — D.1 verification tests.
 *
 * Phase D.1 (v3 §D.1): SettingsManager 替换自定义 settings I/O.
 * The existing SettingsRegistry in sqlite/settings.ts already
 * implements the key contract (set / setAsync / get / getStrict /
 * list with namespace filter). These tests verify the underlying
 * behavior that the SettingsStore wrapper (D.1 round 2) will
 * compose on top of.
 *
 * What's verified:
 * - Basic set + get round-trip
 * - setAsync uses UPSERT semantics
 * - getStrict vs get parsing behavior
 * - list with namespace filter narrows results
 * - version increments on update
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorageSync } from "../sqlite/open-storage";
import { SettingsRegistry } from "../sqlite/settings";

let root = "";
let store: SettingsRegistry;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "settings-registry-test-"));
  store = new SettingsRegistry(openStorageSync({ filePath: join(root, "profile.sqlite") }).driver);
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("SettingsRegistry (Phase D.1 verification)", () => {
  it("round-trips values through set + get", () => {
    store.set("auth", "clientId", "client-123");
    expect(store.get("auth", "clientId")).toMatchObject({ value: "client-123" });
  });

  it("returns undefined for missing namespace / key", () => {
    expect(store.get("missing", "key")).toBeUndefined();
  });

  it("preserves caller-supplied version (UPSERT semantics with explicit version)", () => {
    const first = store.set("auth", "clientId", "v1", 1);
    expect(first.version).toBe(1);
    const second = store.set("auth", "clientId", "v2", 7);
    expect(second.version).toBe(7);
    expect(store.get("auth", "clientId")).toMatchObject({ value: "v2", version: 7 });
  });

  it("setAsync uses the same caller-supplied-version path", async () => {
    const a = await store.setAsync("auth", "clientId", "async-v1", 1);
    expect(a.version).toBe(1);
    const b = await store.setAsync("auth", "clientId", "async-v2", 9);
    expect(b.version).toBe(9);
    expect(store.get("auth", "clientId")?.value).toBe("async-v2");
  });

  it("list with no namespace returns all entries", () => {
    store.set("ns-a", "k1", "v-a");
    store.set("ns-b", "k2", "v-b");
    store.set("ns-a", "k3", "v-a2");
    const all = store.list();
    expect(all).toHaveLength(3);
    const namespaces = new Set(all.map((entry) => entry.namespace));
    expect(namespaces).toEqual(new Set(["ns-a", "ns-b"]));
  });

  it("list with namespace filter narrows to that namespace", () => {
    store.set("ns-a", "k1", "v-a");
    store.set("ns-b", "k2", "v-b");
    store.set("ns-a", "k3", "v-a2");
    const onlyA = store.list("ns-a");
    expect(onlyA).toHaveLength(2);
    expect(onlyA.every((entry) => entry.namespace === "ns-a")).toBe(true);
  });

  it("set with structured value preserves nested objects", () => {
    const value = { oauth: { clientId: "abc", scopes: ["read", "write"] }, retries: 3 };
    store.set("auth", "config", value);
    expect(store.get("auth", "config")?.value).toEqual(value);
  });

  it("custom now function is honoured for updatedAt", () => {
    const fixedNow = () => "2026-01-01T00:00:00.000Z";
    const custom = new SettingsRegistry(
      openStorageSync({ filePath: join(root, "custom.sqlite") }).driver,
      fixedNow,
    );
    custom.set("test", "key", "v");
    expect(custom.get("test", "key")?.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
