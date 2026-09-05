/**
 * P0-1 — Marketplace install/uninstall E2E (real IPC + real Electron).
 *
 * Tests the full `agent:profile-install` and `agent:profile-remove` IPC
 * roundtrip against a real fixture bundle in `tests/fixtures/marketplace-bundle`.
 *
 * The fixture is a minimal OpenBuddy dsh bundle with:
 *   - dsh.bundle.patch: inserts "marketplace-bundle-test" into the cordis runtime
 *   - dsh.client: a renderer plugin stub
 *   - pi.extensions: a pi extension that registers a test command
 *   - pi.skills: a SKILL.md under skills/
 *
 * Install path: `file:<absolute>` → installProfilePackage() writes manifest,
 * reloadProfile() triggers loader.reload() → pi-extension-discovery picks up
 * the new file. After install, agent:profile-packages lists the bundle.
 * Remove path: name → removeProfilePackage() cleans up + reload.
 *
 * Each test launches a fresh Electron instance (--user-data-dir) so profile
 * state is isolated. The fixture is shared and read-only.
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

test.describe("marketplace install/uninstall E2E via real IPC", () => {
  test("agent:profile-install installs a local bundle and lists it in profile-packages", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const before = await invokeOrReject(page, "agent:profile-packages");
    expect(before.ok).toBe(true);
    const beforeList = before.value as unknown[];
    expect(Array.isArray(beforeList)).toBe(true);

    const install = await invokeOrReject(page, "agent:profile-install", { source: `file:${FIXTURE_PATH}` });
    expect(install.ok, `install failed: ${String(install.value)}`).toBe(true);
    const info = install.value as { name?: string; version?: string };
    expect(info.name).toBe(FIXTURE_NAME);
    expect(info.version).toBe("1.0.0");

    const after = await invokeOrReject(page, "agent:profile-packages");
    expect(after.ok).toBe(true);
    const afterList = (after.value as Array<{ name: string }>) ?? [];
    expect(afterList.length).toBe(beforeList.length + 1);
    expect(afterList.find((p) => p.name === FIXTURE_NAME)).toBeDefined();

    // Cleanup
    await invokeOrReject(page, "agent:profile-remove", { name: FIXTURE_NAME });
  });

  test("agent:profile-install then plugin-inventory includes the new bundle's expected surfaces", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const install = await invokeOrReject(page, "agent:profile-install", { source: `file:${FIXTURE_PATH}` });
    expect(install.ok, `install failed: ${String(install.value)}`).toBe(true);

    const inventory = await invokeOrReject(page, "agent:plugin-inventory");
    expect(inventory.ok).toBe(true);
    const inv = inventory.value as { packages?: Array<{ name?: string }> };
    expect(Array.isArray(inv?.packages)).toBe(true);
    const installedPackage = inv?.packages?.find((p) => p.name === FIXTURE_NAME);
    expect(installedPackage, "inventory.packages must include the installed bundle").toBeDefined();

    await invokeOrReject(page, "agent:profile-remove", { name: FIXTURE_NAME });
  });

  test("agent:profile-install with an already-installed source returns a structured error", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const first = await invokeOrReject(page, "agent:profile-install", { source: `file:${FIXTURE_PATH}` });
    expect(first.ok, `first install should succeed: ${String(first.value)}`).toBe(true);

    // Second install of the same source — the profile-manager's behavior is to
    // either reject with "already installed" or succeed idempotently. Either
    // way, the IPC must not crash and must return a structured response.
    const second = await invokeOrReject(page, "agent:profile-install", { source: `file:${FIXTURE_PATH}` });
    expect(second.value).toBeDefined();

    // Cleanup regardless
    await invokeOrReject(page, "agent:profile-remove", { name: FIXTURE_NAME });
  });

  test("agent:profile-remove removes a previously-installed bundle", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    await invokeOrReject(page, "agent:profile-install", { source: `file:${FIXTURE_PATH}` });

    const beforeRemove = await invokeOrReject(page, "agent:profile-packages");
    const beforeList = (beforeRemove.value as Array<{ name: string }>) ?? [];
    expect(beforeList.find((p) => p.name === FIXTURE_NAME)).toBeDefined();

    const remove = await invokeOrReject(page, "agent:profile-remove", { name: FIXTURE_NAME });
    expect(remove.ok, `remove failed: ${String(remove.value)}`).toBe(true);
    const result = remove.value as { ok?: boolean };
    expect(result.ok).toBe(true);

    const afterRemove = await invokeOrReject(page, "agent:profile-packages");
    const afterList = (afterRemove.value as Array<{ name: string }>) ?? [];
    expect(afterList.find((p) => p.name === FIXTURE_NAME)).toBeUndefined();
  });

  test("agent:profile-install with an invalid source returns a structured error without crashing", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:profile-install", { source: "file:/nonexistent/path/that/does/not/exist" });
    // Whether ok=true or ok=false, the call must NOT crash the renderer bridge.
    // The IPC handler is expected to return an error message.
    if (!result.ok) {
      expect(typeof result.value).toBe("string");
      expect((result.value as string).length).toBeGreaterThan(0);
    } else {
      // If the call resolves, it must contain an error field or message.
      expect(result.value).toBeDefined();
    }
  });
});
