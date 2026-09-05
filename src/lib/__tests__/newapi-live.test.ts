import { describe, expect, it } from "vitest";
import { normalizeNewapiBaseUrl } from "../billing/newapi-provider";

/**
 * NewAPI 实时连通性集成测试（需要公网可达）
 *
 * 跳过条件：CI 环境无网络 / `process.env.NEWAPI_LIVE_SKIP !== "0"`
 * 启用方式：`NEWAPI_LIVE_SKIP=0 npx vitest run src/lib/__tests__/newapi-live.test.ts`
 */

const SKIP_LIVE = process.env.NEWAPI_LIVE_SKIP !== "0";
const BASE = "http://124.221.146.145:3000";

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

describe.skipIf(SKIP_LIVE)("NewAPI 实时集成", () => {
  it("/api/status 公网可达", async () => {
    const res = await withTimeout(fetch(`${BASE}/api/status`), 5000);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { version?: string; quota_per_unit?: number } };
    expect(body.data?.version).toMatch(/v\d+\.\d+\.\d+/);
    expect(body.data?.quota_per_unit).toBeGreaterThan(0);
  });

  it("/v1/models 拒绝无效 token", async () => {
    const res = await withTimeout(
      fetch(`${BASE}/v1/models`, { headers: { Authorization: "Bearer sk-invalid-test" } }),
      5000,
    );
    expect(res.status).toBe(401);
  });

  it("/v1/models 拒绝用户 JWT（非 sk-）", async () => {
    const res = await withTimeout(
      fetch(`${BASE}/v1/models`, {
        headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.invalid.user.jwt" },
      }),
      5000,
    );
    expect(res.status).toBe(401);
  });
});

describe("normalizeNewapiBaseUrl 集成", () => {
  it("与 live baseUrl 兼容", () => {
    const normalized = normalizeNewapiBaseUrl(BASE);
    expect(normalized).toBe(`${BASE}/v1`);
  });

  it("去除尾斜杠", () => {
    expect(normalizeNewapiBaseUrl(`${BASE}/`)).toBe(`${BASE}/v1`);
  });

  it("幂等：已带 /v1 不变", () => {
    expect(normalizeNewapiBaseUrl(`${BASE}/v1`)).toBe(`${BASE}/v1`);
  });
});
