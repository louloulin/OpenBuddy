/**
 * R4 — Agent 工作台核心流程 E2E (session/workspace/harness/mcp/tools).
 *
 * 验证 OpenBuddy Agent 工作台的核心 IPC 频道 (除 plugin 生命周期外)
 * 真实启动 Electron 后通过 preload bridge (`window.api.invoke`) 可用。
 *
 * 覆盖场景:
 *   - Session: sessions:list / agent:session-info / agent:new-session
 *   - Workspace: workspace:list
 *   - Harness: harness:recovery-status / harness:session-cursors / agent:extensions-reload
 *   - MCP: mcp:status / mcp:list
 *   - Subagents: subagents:get-config
 *   - Tools: agent:tools-list / agent:resource-inventory
 *   - Prompt History: prompt_history
 *
 * 每个测试都启动独立的 Electron 实例 (--user-data-dir)。
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

test.describe("agent workbench core IPC channels", () => {
  test("sessions:list returns an array of sessions for a cwd", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "sessions:list", "/tmp");
    expect(result.ok, `sessions:list failed: ${String(result.value)}`).toBe(true);
    const list = result.value as unknown[];
    expect(Array.isArray(list), "sessions:list must return an array").toBe(true);
  });

  test("agent:session-info gracefully handles non-existent sessionId", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:session-info", { sessionId: "nonexistent-session-id-12345" });
    expect(result.ok, `agent:session-info failed: ${String(result.value)}`).toBe(true);
    expect(result.value === null || typeof result.value === "object").toBe(true);
  });

  test("agent:session-usage gracefully handles non-existent sessionId", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:session-usage", { sessionId: "nonexistent-session-id-12345" });
    expect(result.ok, `agent:session-usage failed: ${String(result.value)}`).toBe(true);
  });

  test("workspace:list returns {items, archivedSessionIds} shape", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "workspace:list");
    expect(result.ok, `workspace:list failed: ${String(result.value)}`).toBe(true);
    const value = result.value as { items?: unknown[]; archivedSessionIds?: string[] };
    expect(value).toBeDefined();
    expect(Array.isArray(value.items), "workspace:list must return { items: [...] }").toBe(true);
    expect(Array.isArray(value.archivedSessionIds), "workspace:list.archivedSessionIds must be an array").toBe(true);
  });

  test("harness:recovery-status returns a pending/uncertain snapshot", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "harness:recovery-status");
    expect(result.ok, `harness:recovery-status failed: ${String(result.value)}`).toBe(true);
    const snapshot = result.value as { pending?: number; uncertain?: number };
    expect(snapshot).toBeDefined();
    expect(typeof snapshot.pending).toBe("number");
    expect(typeof snapshot.uncertain).toBe("number");
  });

  test("harness:session-cursors returns a cursor map (possibly empty)", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "harness:session-cursors");
    expect(result.ok, `harness:session-cursors failed: ${String(result.value)}`).toBe(true);
    const cursors = result.value as Record<string, number>;
    expect(typeof cursors).toBe("object");
  });

  test("agent:extensions-reload round-trips through plugin-event-bus without crash", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:extensions-reload");
    expect(result.ok, `agent:extensions-reload failed: ${String(result.value)}`).toBe(true);
  });

  test("mcp:status returns the MCP server status list", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "mcp:status");
    expect(result.ok, `mcp:status failed: ${String(result.value)}`).toBe(true);
    const list = result.value as unknown[];
    expect(Array.isArray(list), "mcp:status must return an array").toBe(true);
  });

  test("mcp:list returns the MCP server list", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "mcp:list");
    expect(result.ok, `mcp:list failed: ${String(result.value)}`).toBe(true);
    const list = result.value as unknown[];
    expect(Array.isArray(list), "mcp:list must return an array").toBe(true);
  });

  test("subagents:get-config returns null or a config object", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "subagents:get-config");
    expect(result.ok, `subagents:get-config failed: ${String(result.value)}`).toBe(true);
    const value = result.value;
    expect(value === null || typeof value === "object").toBe(true);
  });

  test("agent:tools-list returns a list with at least one openbuddy or pi origin tool", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:tools-list");
    expect(result.ok, `agent:tools-list failed: ${String(result.value)}`).toBe(true);
    const tools = result.value as Array<{ name: string; source?: string }>;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    const sources = new Set(tools.map((t) => t.source ?? "unknown"));
    expect(sources.has("openbuddy") || sources.has("pi")).toBe(true);
  });

  test("agent:resource-inventory returns extensions with tools", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:resource-inventory");
    expect(result.ok, `agent:resource-inventory failed: ${String(result.value)}`).toBe(true);
    const inv = result.value as { extensions?: Array<{ id: string; tools?: string[] }> };
    expect(inv).toBeDefined();
    expect(Array.isArray(inv.extensions)).toBe(true);
    const openbuddyPiTools = inv.extensions?.find((ext) => ext.id === "<inline:openbuddy-pi-tools>");
    if (openbuddyPiTools) {
      expect(Array.isArray(openbuddyPiTools.tools)).toBe(true);
      expect(openbuddyPiTools.tools?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("prompt_history returns an array", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "prompt_history", { limit: 50 });
    expect(result.ok, `prompt_history failed: ${String(result.value)}`).toBe(true);
    const list = result.value as unknown[];
    expect(Array.isArray(list)).toBe(true);
  });
});
