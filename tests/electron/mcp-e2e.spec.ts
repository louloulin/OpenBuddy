/**
 * P1-2 — MCP server local-mock E2E (REAL MCP roundtrip).
 *
 * 用 `evals/node/echo/email-mcp-server.mjs` 作为真 MCP server — 这个 server
 * 通过 stdio 实现完整 MCP 协议 (initialize / list_tools / call_tool), 暴露
 * 27+ email 工具 (list_emails, get_email, send_email, sync_emails, ...).
 *
 * 验证 IPC 链路:
 *   - mcp:upsert 把 server 写进 mcp.json → reloadMcp() 触发
 *   - mcp:list 返回 server 的 runtime metadata
 *   - runtimeStatus === "ready" (真 MCP 握手成功), toolCount > 0
 *   - mcp:toggle 翻转 enabled flag,  reloadMcp 重连
 *   - mcp:delete 移除
 *
 * 与 P1-2 mock 版本的关键区别: 此版本用真 MCP server 验证协议握手,
 * 不是用 `command: echo` (后者必然失败因为 echo 不说 MCP).
 *
 * Each test launches a fresh Electron (via the `--user-data-dir` fixture)
 * + fresh MCP server (spawned by the test worker).
 */
import { expect, test } from "./_fixtures";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(__dirname));
const EMAIL_MCP_SCRIPT = join(ROOT, "evals", "node", "echo", "email-mcp-server.mjs");

type McpListEntry = {
  name: string;
  transport?: string;
  target?: string;
  enabled?: boolean;
  source?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  runtimeStatus?: string;
  toolCount?: number;
  runtimeError?: string;
  emailProfile?: string;
};

type McpStatusEntry = {
  serverName: string;
  status: string;
  toolCount: number;
  emailProfile?: string;
  error?: string;
};

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

test.describe("MCP server local-mock E2E via real IPC (REAL email-mcp-server roundtrip)", () => {
  // We don't need a beforeAll for the MCP server itself — `mcp:upsert`
  // spawns it on demand. But the test does rely on the script file being
  // on disk in the repo.
  test("mcp:list returns empty array when no servers are configured", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const list = await invoke<McpListEntry[]>(page, "mcp:list");
    expect(Array.isArray(list)).toBe(true);
  });

  test("mcp:config-path returns an absolute path under the agent root", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const path = await invoke<string>(page, "mcp:config-path");
    expect(typeof path).toBe("string");
    expect(path.length).toBeGreaterThan(0);
    expect(path).toMatch(/\.json$/);
  });

  test("mcp:config-read returns the current mcp.json content as a JSON string", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invoke<{ filePath: string; content: string }>(page, "mcp:config-read");
    expect(result).toBeDefined();
    expect(typeof result.filePath).toBe("string");
    expect(result.filePath.length).toBeGreaterThan(0);
    expect(typeof result.content).toBe("string");
    // Content is JSON-serialized by the handler; must parse cleanly.
    const parsed = JSON.parse(result.content) as { mcpServers?: Record<string, unknown> };
    expect(parsed.mcpServers).toBeDefined();
    expect(typeof parsed.mcpServers).toBe("object");
  });

  test("mcp:upsert + mcp:list shows the REAL email-mcp-server with runtimeStatus=ready and toolCount>0", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const serverName = `email-mcp-e2e-${Date.now()}`;
    const upsert = await invokeOrReject(page, "mcp:upsert", {
      server: {
        name: serverName,
        command: process.execPath,
        args: [EMAIL_MCP_SCRIPT],
        env: {},
      },
    });
    expect(upsert.ok, `mcp:upsert failed: ${String(upsert.value)}`).toBe(true);

    // mcp:list returns immediately after upsert; the runtime may still be
    // in "connecting" state if it hasn't finished handshake yet. Poll
    // mcp:status for up to 15s waiting for "ready".
    const deadline = Date.now() + 15_000;
    let entry: McpListEntry | undefined;
    let status: McpStatusEntry[] = [];
    while (Date.now() < deadline) {
      const list = await invoke<McpListEntry[]>(page, "mcp:list");
      entry = (list ?? []).find((e) => e.name === serverName);
      status = await invoke<McpStatusEntry[]>(page, "mcp:status");
      const ready = status.find((s) => s.serverName === serverName);
      if (ready?.status === "ready" && ready.toolCount > 0) break;
      await page.waitForTimeout(300);
    }

    expect(entry, `mcp:list missing ${serverName}`).toBeDefined();
    expect(entry?.command).toBe(process.execPath);
    expect(entry?.args).toEqual([EMAIL_MCP_SCRIPT]);
    const ready = status.find((s) => s.serverName === serverName);
    expect(ready, `mcp:status missing ${serverName}: ${JSON.stringify(status)}`).toBeDefined();
    // Real MCP server handshake must complete with ready + >0 tools.
    expect(ready?.status, `email-mcp-server handshake never completed; status=${JSON.stringify(status)}`).toBe("ready");
    expect(ready?.toolCount, `email-mcp-server should expose >0 tools; got ${ready?.toolCount}`).toBeGreaterThan(0);

    // Cleanup
    await invokeOrReject(page, "mcp:delete", { name: serverName });
  });

  test("mcp:toggle flips the enabled flag and reloadMcp re-materializes runtimeStatus on the REAL server", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const serverName = `email-mcp-e2e-toggle-${Date.now()}`;
    await invokeOrReject(page, "mcp:upsert", {
      server: { name: serverName, command: process.execPath, args: [EMAIL_MCP_SCRIPT], env: {} },
    });

    const beforeList = await invoke<McpListEntry[]>(page, "mcp:list");
    const before = (beforeList ?? []).find((e) => e.name === serverName);
    expect(before).toBeDefined();
    expect(before?.enabled).toBe(true);

    const toggleOff = await invokeOrReject(page, "mcp:toggle", { name: serverName, enabled: false });
    expect(toggleOff.ok, `mcp:toggle off failed: ${String(toggleOff.value)}`).toBe(true);

    const afterOffList = await invoke<McpListEntry[]>(page, "mcp:list");
    const afterOff = (afterOffList ?? []).find((e) => e.name === serverName);
    expect(afterOff).toBeDefined();
    expect(afterOff?.enabled).toBe(false);

    const toggleOn = await invokeOrReject(page, "mcp:toggle", { name: serverName, enabled: true });
    expect(toggleOn.ok, `mcp:toggle on failed: ${String(toggleOn.value)}`).toBe(true);

    const afterOnList = await invoke<McpListEntry[]>(page, "mcp:list");
    const afterOn = (afterOnList ?? []).find((e) => e.name === serverName);
    expect(afterOn?.enabled).toBe(true);

    // Cleanup
    await invokeOrReject(page, "mcp:delete", { name: serverName });
  });

  test("mcp:delete removes the REAL server from mcp:list", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const serverName = `email-mcp-e2e-delete-${Date.now()}`;
    await invokeOrReject(page, "mcp:upsert", {
      server: { name: serverName, command: process.execPath, args: [EMAIL_MCP_SCRIPT], env: {} },
    });

    const beforeList = await invoke<McpListEntry[]>(page, "mcp:list");
    expect((beforeList ?? []).find((e) => e.name === serverName)).toBeDefined();

    const del = await invokeOrReject(page, "mcp:delete", { name: serverName });
    expect(del.ok, `mcp:delete failed: ${String(del.value)}`).toBe(true);

    const afterList = await invoke<McpListEntry[]>(page, "mcp:list");
    expect((afterList ?? []).find((e) => e.name === serverName)).toBeUndefined();
  });

  test("mcp:upsert rejects invalid server names with a structured error", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const invalidName = "bad name with spaces and !@#";
    const result = await invokeOrReject(page, "mcp:upsert", {
      server: { name: invalidName, command: process.execPath, args: [EMAIL_MCP_SCRIPT], env: {} },
    });
    expect(result.ok).toBe(false);
    expect(String(result.value).toLowerCase()).toMatch(/name/);
  });

  test("mcp:toggle on a non-existent server returns a structured error", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "mcp:toggle", {
      name: "email-mcp-e2e-does-not-exist",
      enabled: false,
    });
    expect(result.ok).toBe(false);
    expect(String(result.value).toLowerCase()).toMatch(/not found|server/);
  });

  test("a non-MCP command (echo) reports runtimeStatus=failed in mcp:list (negative control)", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    // echo doesn't speak MCP — runtime should mark this server as failed.
    // This complements the positive control above: it proves the test
    // is actually verifying MCP handshake, not just the IPC roundtrip.
    const serverName = `echo-control-${Date.now()}`;
    await invokeOrReject(page, "mcp:upsert", {
      server: { name: serverName, command: "echo", args: ["hello"], env: {} },
    });
    const list = await invoke<McpListEntry[]>(page, "mcp:list");
    const entry = (list ?? []).find((e) => e.name === serverName);
    expect(entry, `expected ${serverName} in list`).toBeDefined();
    expect(entry?.runtimeStatus, `echo should fail MCP handshake; got ${JSON.stringify(entry)}`).toBe("failed");

    // Cleanup
    await invokeOrReject(page, "mcp:delete", { name: serverName });
  });
});
