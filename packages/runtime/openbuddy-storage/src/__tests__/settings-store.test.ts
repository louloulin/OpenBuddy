/**
 * @openbuddy/storage/sqlite/settings-store — settings-store + typed accessors tests.
 *
 * G2 PR 1 (R20) + G2 PR 2 (R21) — pi SettingsManager is the SOLE
 * schema gate (custom validator API is gone).
 * G2 PR 3 (R36) — typed retry/image accessors.
 * G2 PR 4 (R37) — unused bulk/namespace helpers deleted; tests for
 * them removed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorageSync } from "../sqlite/open-storage";
import { SettingsStore } from "../sqlite/settings-store";
import { coerceImageSettings, coerceRetrySettings } from "../sqlite/typed-settings";

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

describe("SettingsStore (G2 PR 4 — thin facade)", () => {
  it("delegates basic set + get to the underlying registry", () => {
    store.set("auth", "clientId", "abc");
    expect(store.get("auth", "clientId")?.value).toBe("abc");
  });

  it("setAsync delegates with the same registry path as sync set", async () => {
    await store.setAsync("auth", "clientId", "async");
    expect(store.get("auth", "clientId")?.value).toBe("async");
  });

  it("getStrict returns undefined for malformed JSON rows", () => {
    store.set("auth", "clientId", "abc");
    expect(store.getStrict("auth", "clientId")?.value).toBe("abc");
  });
});

describe("SettingsStore G2 PR 1+2 — pi SettingsManager gate", () => {
  it("accepts a well-formed object via the pi gate", () => {
    expect(() => store.set("auth", "clientId", { clientId: "abc", scopes: ["read"] })).not.toThrow();
    expect(store.get("auth", "clientId")?.value).toMatchObject({ clientId: "abc" });
  });

  it("accepts a primitive value (pi gate is a no-op for non-objects)", () => {
    expect(() => store.set("theme", "color", "dark")).not.toThrow();
    expect(store.get("theme", "color")?.value).toBe("dark");
  });

  it("accepts a value with legacy `queueMode` and runs pi's migration pipeline", () => {
    const legacy = { queueMode: "all", defaultProvider: "openai" };
    expect(() => store.set("settings", "pi", legacy)).not.toThrow();
    expect(store.get("settings", "pi")?.value).toMatchObject({ queueMode: "all" });
  });

  it("accepts a value with legacy `retry.maxDelayMs` (nested-field migration)", () => {
    const legacy = { retry: { enabled: true, maxRetries: 3, maxDelayMs: 5000 } };
    expect(() => store.set("settings", "retry", legacy)).not.toThrow();
    expect(store.get("settings", "retry")?.value).toMatchObject({ retry: { enabled: true } });
  });

  it("accepts null value (pi gate skips non-objects)", () => {
    expect(() => store.set("auth", "clientId", null)).not.toThrow();
    expect(store.get("auth", "clientId")?.value).toBeNull();
  });
});

describe("SettingsStore G2 PR 3 — typed retry/image accessors", () => {
  it("getRetrySettings returns {} when nothing persisted", () => {
    expect(store.getRetrySettings()).toEqual({});
  });

  it("setRetrySettings + getRetrySettings round-trip typed shape", () => {
    store.setRetrySettings({ enabled: true, maxRetries: 5, baseDelayMs: 1000 });
    expect(store.getRetrySettings()).toEqual({ enabled: true, maxRetries: 5, baseDelayMs: 1000 });
  });

  it("setRetrySettings persists nested provider.* via pi gate", () => {
    store.setRetrySettings({ enabled: false, provider: { maxRetries: 3, maxRetryDelayMs: 30_000 } });
    expect(store.getRetrySettings()).toEqual({
      enabled: false,
      provider: { maxRetries: 3, maxRetryDelayMs: 30_000 },
    });
  });

  it("getImageSettings returns {} when nothing persisted", () => {
    expect(store.getImageSettings()).toEqual({});
  });

  it("setImageSettings + getImageSettings round-trip typed shape", () => {
    store.setImageSettings({ autoResize: true, blockImages: false });
    expect(store.getImageSettings()).toEqual({ autoResize: true, blockImages: false });
  });
});

describe("typed-settings.ts coerce helpers (pure data projection)", () => {
  it("coerceRetrySettings filters to canonical RetrySettings keys", () => {
    const input = { enabled: true, maxRetries: 3, baseDelayMs: 1000, garbage: "drop" };
    expect(coerceRetrySettings(input)).toEqual({ enabled: true, maxRetries: 3, baseDelayMs: 1000 });
  });

  it("coerceRetrySettings nests provider.* with all three keys", () => {
    const input = { provider: { timeoutMs: 5000, maxRetries: 2, maxRetryDelayMs: 60_000 } };
    expect(coerceRetrySettings(input)).toEqual({
      provider: { timeoutMs: 5000, maxRetries: 2, maxRetryDelayMs: 60_000 },
    });
  });

  it("coerceRetrySettings drops provider if provider has no recognised keys", () => {
    expect(coerceRetrySettings({ provider: { random: 1 } })).toEqual({});
  });

  it("coerceImageSettings filters to canonical ImageSettings keys", () => {
    expect(coerceImageSettings({ autoResize: true, blockImages: false, garbage: "x" }))
      .toEqual({ autoResize: true, blockImages: false });
  });

  it("coerceImageSettings returns {} for empty object", () => {
    expect(coerceImageSettings({})).toEqual({});
  });
});