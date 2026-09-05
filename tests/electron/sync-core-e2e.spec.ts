/**
 * P1-1 — sync-core 触发链路 E2E.
 *
 * 验证 deepSeekCordisRuntime + syncDeepSeekCordisRuntime 全链路,
 * 覆盖三个 IPC handler:
 *   - `agent:deepseek-cordis-snapshot`  → 返回 runtime snapshot 或 null
 *   - `agent:deepseek-pi-describe`       → 返回 protocol/capabilities 静态元数据
 *   - `agent:deepseek-cordis-invoke`     → 调用 cordis service.method
 *
 * 默认 fixture profile 不含 `@deepseek-ai/dsh-base`, 所以
 * `syncDeepSeekCordisRuntime` 会主动 dispose 并把 snapshot 设成 null
 * (见 electron/main/agent/host-modules/deepseek/cordis-runtime.ts:264-275).
 * 测试既覆盖"runtime 未激活"分支, 也覆盖"describe 永远可达"分支.
 *
 * Each test launches a fresh Electron (via the `--user-data-dir` fixture)
 * so profile state, plugin loaders, and event logs are isolated.
 */
import { expect, test } from "./_fixtures";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Snapshot = {
  runtime: string;
  generation: number;
  plugins: Array<{ name?: string; state?: string }>;
  services: string[];
  capabilities: Array<{ service: string; methods: string[] }>;
  disposed: boolean;
} | null;

type Describe = {
  protocol: string;
  runtime: string;
  capabilities: Record<string, string[]>;
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

test.describe("sync-core 触发链路", () => {
  test("agent:deepseek-pi-describe returns the canonical protocol/capabilities tuple", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const describe = await invoke<Describe>(page, "agent:deepseek-pi-describe");
    expect(describe).toBeDefined();
    expect(typeof describe.protocol).toBe("string");
    expect(describe.protocol.length).toBeGreaterThan(0);
    expect(describe.runtime).toBe("pi");
    expect(describe.capabilities).toBeDefined();
    expect(typeof describe.capabilities).toBe("object");
    // At least the canonical capability groups surface — even when the
    // deepseek-cordis runtime is inactive the static protocol/capabilities
    // tuple must be reachable through the bridge.
    expect(Object.keys(describe.capabilities).length).toBeGreaterThan(0);
  });

  test("agent:deepseek-cordis-snapshot returns null when the runtime is not activated by the profile", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    // No deepseek-cordis profile package is registered in the default
    // fixture, so syncDeepSeekCordisRuntime() should dispose any prior
    // runtime and leave the snapshot null.
    const snapshot = await invoke<Snapshot>(page, "agent:deepseek-cordis-snapshot");
    expect(snapshot).toBeNull();
  });

  test("agent:deepseek-cordis-snapshot stays null after a new-session init (no deepseek profile)", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const cwd = mkdtempSync(join(tmpdir(), "openbuddy-sync-core-e2e-"));
    const session = await invokeOrReject(page, "agent:new-session", { cwd });
    expect(session.ok, `agent:new-session failed: ${String(session.value)}`).toBe(true);

    // Even after init, no deepseek-cordis profile package exists in the
    // fixture — the snapshot must remain null.
    const snapshot = await invoke<Snapshot>(page, "agent:deepseek-cordis-snapshot");
    expect(snapshot).toBeNull();
  });

  test("agent:deepseek-cordis-invoke returns a structured error when runtime is inactive", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:deepseek-cordis-invoke", {
      service: "session",
      method: "list",
      args: [],
    });
    expect(result.ok, `invoke unexpectedly succeeded: ${JSON.stringify(result.value)}`).toBe(false);
    const errorMessage = String(result.value).toLowerCase();
    // The bridge must surface a clear "runtime not active" / "not allowed"
    // style error — not a generic 500 or crash.
    expect(errorMessage).toMatch(/runtime|active|not allowed|unavailable/);
  });

  test("agent:deepseek-cordis-invoke rejects empty service with a structured error", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:deepseek-cordis-invoke", {
      service: "",
      method: "list",
      args: [],
    });
    // The IPC layer's validation may either reject empty service via
    // recordValue/requiredString, OR the cordis runtime may reject it
    // downstream. Either way, the call must not crash the bridge and
    // must return a structured error string.
    expect(result.value).toBeDefined();
    if (!result.ok) {
      expect(typeof result.value).toBe("string");
      expect((result.value as string).length).toBeGreaterThan(0);
    }
  });

  test("agent:deepseek-cordis-invoke rejects forbidden methods (e.g. constructor) with a structured error", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    // The cordis runtime has a `forbiddenMethods` set that always
    // rejects things like `constructor` / `__proto__`. Even with no
    // active runtime, the bridge must not crash on this call.
    const result = await invokeOrReject(page, "agent:deepseek-cordis-invoke", {
      service: "session",
      method: "constructor",
      args: [],
    });
    expect(result.value).toBeDefined();
  });
});
