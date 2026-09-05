/**
 * P0-2 — Plugin hot reload UI E2E.
 *
 * Validates that the live plugin lifecycle emits events through
 * `agent:plugin-events`, that `agent:plugin-reload` re-materializes
 * a plugin without restarting Electron, and that the renderer-side
 * plugin list reflects the latest state.
 *
 * Each test launches a fresh Electron instance (--user-data-dir) so
 * event-log state is isolated.
 */
import { expect, test } from "./_fixtures";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, "..", "fixtures", "marketplace-bundle");
const FIXTURE_NAME = "@test/marketplace-bundle";

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

async function invokeOrReject(page: import("@playwright/test").Page, channel: string, args?: unknown): Promise<{ ok: boolean; value: unknown }> {
  try {
    const value = await invoke<unknown>(page, channel, args);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, value: error instanceof Error ? error.message : String(error) };
  }
}

type PluginEvent = { sequence: number; timestamp: string; type: string; payload?: unknown };

test.describe("plugin hot reload UI via real IPC", () => {
  test("installing a plugin emits a sequence of plugin/* and loader/* events", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const beforeResult = await invokeOrReject(page, "agent:plugin-events");
    expect(beforeResult.ok).toBe(true);
    const beforeCount = ((beforeResult.value as PluginEvent[]) ?? []).length;

    const install = await invokeOrReject(page, "agent:profile-install", { source: `file:${FIXTURE_PATH}` });
    expect(install.ok, `install failed: ${String(install.value)}`).toBe(true);

    const afterResult = await invokeOrReject(page, "agent:plugin-events");
    expect(afterResult.ok).toBe(true);
    const allEvents = (afterResult.value as PluginEvent[]) ?? [];
    expect(allEvents.length).toBeGreaterThan(beforeCount);

    const newEvents = allEvents.slice(beforeCount);
    const newTypes = new Set(newEvents.map((e) => e.type));
    // After install, the lifecycle must have surfaced loader + plugin events.
    const expectedTypes = ["plugin/loaded", "loader/entry-init", "plugin/readiness", "profile/reloaded"];
    for (const t of expectedTypes) {
      expect(newTypes.has(t), `expected event type ${t} after install`).toBe(true);
    }

    // Cleanup
    await invokeOrReject(page, "agent:profile-remove", { name: FIXTURE_NAME });
  });

  test("agent:plugin-events returns events with strictly increasing sequence numbers", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:plugin-events");
    expect(result.ok).toBe(true);
    const events = (result.value as PluginEvent[]) ?? [];
    expect(events.length).toBeGreaterThan(0);

    // Sequence numbers must be strictly monotonic (event log invariant).
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1].sequence;
      const cur = events[i].sequence;
      expect(cur, `event seq ${cur} (idx ${i}) should be > ${prev}`).toBeGreaterThan(prev);
    }
  });

  test("agent:plugin-reload re-materializes the plugin without losing it from the list", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    await invokeOrReject(page, "agent:profile-install", { source: `file:${FIXTURE_PATH}` });

    const listBefore = await invokeOrReject(page, "agent:plugin-list");
    expect(listBefore.ok).toBe(true);
    const listBeforeArr = (listBefore.value as Array<{ id: string }>) ?? [];
    expect(listBeforeArr.find((p) => p.id === "marketplace-bundle-test")).toBeDefined();

    const beforeEvents = (await invokeOrReject(page, "agent:plugin-events")).value as PluginEvent[];
    const beforeLen = beforeEvents.length;

    const reload = await invokeOrReject(page, "agent:plugin-reload", { id: "marketplace-bundle-test" });
    expect(reload.ok, `reload failed: ${String(reload.value)}`).toBe(true);
    const reloadResult = reload.value as { id?: string; state?: string };
    expect(reloadResult.id).toBe("marketplace-bundle-test");
    expect(reloadResult.state).toBe("loaded");

    // After reload, list should still contain the plugin (it survived the cycle)
    const listAfter = await invokeOrReject(page, "agent:plugin-list");
    expect(listAfter.ok).toBe(true);
    const listAfterArr = (listAfter.value as Array<{ id: string }>) ?? [];
    expect(listAfterArr.find((p) => p.id === "marketplace-bundle-test")).toBeDefined();

    // Reload should have emitted at least one new event
    const afterEvents = (await invokeOrReject(page, "agent:plugin-events")).value as PluginEvent[];
    expect(afterEvents.length).toBeGreaterThan(beforeLen);

    // Cleanup
    await invokeOrReject(page, "agent:profile-remove", { name: FIXTURE_NAME });
  });

  test("plugin install triggers plugin/transaction-start, phase, and complete events", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const beforeResult = await invokeOrReject(page, "agent:plugin-events");
    expect(beforeResult.ok).toBe(true);
    const beforeCount = ((beforeResult.value as PluginEvent[]) ?? []).length;

    await invokeOrReject(page, "agent:profile-install", { source: `file:${FIXTURE_PATH}` });

    const afterResult = await invokeOrReject(page, "agent:plugin-events");
    expect(afterResult.ok).toBe(true);
    const newEvents = ((afterResult.value as PluginEvent[]) ?? []).slice(beforeCount);
    const types = new Set(newEvents.map((e) => e.type));

    // The transactional surface must emit start/phase/complete during install.
    expect(types.has("plugin/transaction-start"), "install must emit plugin/transaction-start").toBe(true);
    expect(types.has("plugin/transaction-phase"), "install must emit plugin/transaction-phase").toBe(true);
    expect(types.has("plugin/transaction-complete"), "install must emit plugin/transaction-complete").toBe(true);

    // Cleanup
    await invokeOrReject(page, "agent:profile-remove", { name: FIXTURE_NAME });
  });
});
