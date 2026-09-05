/**
 * R5 — Agent 工作台扩展 E2E (skills/calendar/commands/preset/transaction/providers).
 *
 * 验证 OpenBuddy 核心 IPC 频道的扩展覆盖 (除 R4 已测的核心外):
 *   - auth-status / current-model / providers-list / commands-list
 *   - presets-list / transaction-list / transaction-receipt
 *   - skills:list / calendar:list
 *   - renderer-plugin-entries
 *   - plan-mode:get
 *   - remote-contributions
 *   - harness:recovery-list
 *   - event-log
 */
import { expect, test } from "./_fixtures";

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

test.describe("agent workbench extended IPC channels", () => {
  test("agent:auth-status returns a provider-availability snapshot", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:auth-status");
    expect(result.ok, `agent:auth-status failed: ${String(result.value)}`).toBe(true);
    const value = result.value as { providers?: string[]; authenticated?: boolean };
    expect(value).toBeDefined();
    expect(Array.isArray(value.providers) || typeof value.authenticated === "boolean").toBe(true);
  });

  test("agent:current-model returns a ModelDescriptor shape", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:current-model");
    expect(result.ok, `agent:current-model failed: ${String(result.value)}`).toBe(true);
    const m = result.value as { id?: string; provider?: string };
    expect(m).toBeDefined();
    expect(typeof m.id).toBe("string");
  });

  test("agent:providers-list returns {providers, models} shape", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:providers-list");
    expect(result.ok, `agent:providers-list failed: ${String(result.value)}`).toBe(true);
    const inv = result.value as { providers?: unknown[]; models?: unknown[] };
    expect(inv).toBeDefined();
    expect(Array.isArray(inv.providers)).toBe(true);
    expect(Array.isArray(inv.models)).toBe(true);
  });

  test("agent:commands-list returns an array of commands", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:commands-list");
    expect(result.ok, `agent:commands-list failed: ${String(result.value)}`).toBe(true);
    const cmds = result.value as Array<{ name: string }>;
    expect(Array.isArray(cmds)).toBe(true);
  });

  test("agent:presets-list returns an array (possibly empty)", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:presets-list");
    expect(result.ok, `agent:presets-list failed: ${String(result.value)}`).toBe(true);
    const presets = result.value as unknown[];
    expect(Array.isArray(presets)).toBe(true);
  });

  test("agent:transaction-list returns an array", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:transaction-list");
    expect(result.ok, `agent:transaction-list failed: ${String(result.value)}`).toBe(true);
    const txns = result.value as unknown[];
    expect(Array.isArray(txns)).toBe(true);
  });

  test("skills:list returns the skill catalog", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "skills:list");
    expect(result.ok, `skills:list failed: ${String(result.value)}`).toBe(true);
    const skills = result.value as unknown[];
    expect(Array.isArray(skills)).toBe(true);
  });

  test("calendar:list returns the calendar events list", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "calendar:list");
    expect(result.ok, `calendar:list failed: ${String(result.value)}`).toBe(true);
    const events = result.value as unknown[];
    expect(Array.isArray(events)).toBe(true);
  });

  test("agent:renderer-plugin-entries returns the renderer plugin manifest", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:renderer-plugin-entries");
    expect(result.ok, `agent:renderer-plugin-entries failed: ${String(result.value)}`).toBe(true);
    expect(result.value).toBeDefined();
  });

  test("plan-mode:get returns plan-mode state", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "plan-mode:get");
    expect(result.ok, `plan-mode:get failed: ${String(result.value)}`).toBe(true);
    expect(result.value).toBeDefined();
  });

  test("harness:recovery-list returns an array of recovery entries", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "harness:recovery-list");
    expect(result.ok, `harness:recovery-list failed: ${String(result.value)}`).toBe(true);
    const entries = result.value as { intents?: unknown[] };
    expect(Array.isArray(entries.intents), "harness:recovery-list must return {intents: [...]}").toBe(true);
  });

  test("agent:event-log returns the session event log", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:event-log");
    expect(result.ok, `agent:event-log failed: ${String(result.value)}`).toBe(true);
    const events = result.value as unknown[];
    expect(Array.isArray(events)).toBe(true);
  });

  test("agent:remote-contributions returns the remote plugin contributions", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:remote-contributions");
    expect(result.ok, `agent:remote-contributions failed: ${String(result.value)}`).toBe(true);
    expect(result.value).toBeDefined();
  });
});
