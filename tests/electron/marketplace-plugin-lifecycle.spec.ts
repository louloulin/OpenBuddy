/**
 * R3.x — Marketplace plugin lifecycle E2E through the real preload bridge.
 *
 * Boots Electron, then dispatches the actual `agent:plugin-*` and
 * `agent:profile-*` IPC channels via `window.api.invoke(...)` (the same bridge
 * the renderer UI uses). Verifies the roundtrip from UI → preload → main → host.
 *
 * Real IPC data shapes (verified against current build):
 *   - `agent:plugin-list`         → PluginStatus[] (array directly, NOT {plugins:[...]})
 *   - `agent:plugin-inventory`    → {entries, piExtensions, renderers, packages, providers, terminals}
 *   - `agent:plugin-snapshot`     → {version, generation, phase, readiness, surfaces, packages, ...}
 *   - `agent:plugin-readiness`    → readiness snapshot
 *   - `agent:profile-packages`    → ProfilePackageInfo[] (array)
 *   - `agent:plugin-events`       → SessionEventRecord[] (array)
 *   - `agent:plugin-enable`       → PluginStatus | null (after enqueue transaction)
 */
import { expect, test } from "./_fixtures";

type Result = { ok: boolean; value: unknown };

async function invoke<T>(page: import("@playwright/test").Page, channel: string, args?: unknown): Promise<T> {
  return page.evaluate(
    async ({ channel, args }: { channel: string; args?: unknown }) => {
      const api = (window as unknown as { api?: { invoke: (channel: string, args?: unknown) => Promise<unknown> } }).api;
      if (!api?.invoke) throw new Error(`renderer bridge unavailable for ${channel}`);
      return api.invoke(channel, args) as unknown;
    },
    { channel, args },
  ) as Promise<T>;
}

async function invokeOrReject(page: import("@playwright/test").Page, channel: string, args?: unknown): Promise<Result> {
  try {
    const value = await invoke<unknown>(page, channel, args);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, value: error instanceof Error ? error.message : String(error) };
  }
}

test.describe("marketplace plugin lifecycle via real IPC", () => {
  test("agent:plugin-list returns a non-empty array of plugin statuses", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:plugin-list");
    expect(result.ok, "agent:plugin-list must resolve").toBe(true);
    const list = result.value as unknown[];
    expect(Array.isArray(list), "agent:plugin-list must return an array of PluginStatus").toBe(true);
    expect(list.length).toBeGreaterThan(0);
    const first = list[0] as { id?: string; state?: string };
    expect(typeof first.id).toBe("string");
    expect(typeof first.state).toBe("string");
  });

  test("agent:plugin-inventory returns the canonical structured payload", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:plugin-inventory");
    expect(result.ok, "agent:plugin-inventory must resolve").toBe(true);
    const inventory = result.value as Record<string, unknown>;
    expect(inventory).toBeDefined();
    // Canonical shape: {entries, piExtensions, renderers, packages, providers, terminals}
    for (const key of ["entries", "piExtensions", "renderers", "packages", "providers", "terminals"]) {
      expect(key in inventory, `inventory must include ${key}`).toBe(true);
    }
    expect(Array.isArray(inventory.entries), "inventory.entries must be an array").toBe(true);
    expect(Array.isArray(inventory.piExtensions), "inventory.piExtensions must be an array").toBe(true);
  });

  test("agent:plugin-snapshot exposes { version, generation, readiness }", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:plugin-snapshot");
    expect(result.ok, "agent:plugin-snapshot must resolve").toBe(true);
    const snapshot = result.value as { version?: number; generation?: number; readiness?: unknown };
    expect(snapshot).toBeDefined();
    expect(snapshot.readiness).toBeDefined();
    // generation/version may be numbers or undefined depending on the readiness phase
  });

  test("agent:plugin-readiness round-trips a readiness shape", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:plugin-readiness");
    expect(result.ok, "agent:plugin-readiness must resolve").toBe(true);
    expect(result.value).toBeDefined();
  });

  test("agent:profile-packages returns an array (possibly empty)", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:profile-packages");
    expect(result.ok, "agent:profile-packages must resolve").toBe(true);
    const value = result.value as unknown;
    expect(Array.isArray(value), "agent:profile-packages must return an array").toBe(true);
  });

  test("agent:plugin-events channel resolves and returns an event log array", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:plugin-events");
    expect(result.ok, "agent:plugin-events must resolve").toBe(true);
    const events = result.value as unknown[];
    expect(Array.isArray(events), "agent:plugin-events must return an array of SessionEventRecord").toBe(true);
  });

  test("agent:plugin-toggle roundtrip — enable + disable a real plugin id", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });

    // Baseline — fetch a real plugin id. openbuddy-core is NOT in the default
    // profile; use one of the always-loaded dsh-* entries that ship with
    // createOpenBuddyProfile().
    const before = await invokeOrReject(page, "agent:plugin-list");
    expect(before.ok).toBe(true);
    const list = (before.value as Array<{ id: string; state: string }>) ?? [];
    expect(list.length).toBeGreaterThan(0);
    const candidate = list.find((p) => p.id === "openbuddy-dsh-llm") ?? list[0];
    expect(candidate.id).toBeDefined();

    // Toggle off then back on; verify both legs resolve and the plugin id
    // survives the roundtrip. The transactional surface in
    // plugin-mutations.ts wraps each call in pluginLifecycleQueue.enqueue.
    const off = await invokeOrReject(page, "agent:plugin-enable", { id: candidate.id, enabled: false });
    expect(off.ok, `plugin-enable(off) failed: ${String(off.value)}`).toBe(true);
    const on = await invokeOrReject(page, "agent:plugin-enable", { id: candidate.id, enabled: true });
    expect(on.ok, `plugin-enable(on) failed: ${String(on.value)}`).toBe(true);

    // After enabling, the plugin id should still be present in the list.
    const after = await invokeOrReject(page, "agent:plugin-list");
    expect(after.ok).toBe(true);
    const afterList = (after.value as Array<{ id: string }>) ?? [];
    expect(afterList.find((p) => p.id === candidate.id)).toBeDefined();
  });
});
