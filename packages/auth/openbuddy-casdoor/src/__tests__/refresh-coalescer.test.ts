/**
 * @openbuddy/auth-casdoor/refresh-coalescer — Refresh 同 key 合并契约测试。
 *
 * 价值:
 *   - 验证多个并发调用方只触发 1 次实际 refreshFn 调用
 *   - 验证成功 / 失败都正确清除 in-flight 状态
 *   - 验证不同 key 互不影响(并行刷新不同账号)
 *   - 验证 inFlightCount 状态正确性
 */
import { describe, expect, it, vi } from "vitest";
import { makeRefreshCoalescer } from "../refresh-coalescer.js";
import type { TokenResponse } from "../oidc-auth.js";

const sampleToken = (overrides: Partial<TokenResponse> = {}): TokenResponse => ({
  accessToken: "at",
  refreshToken: "rt-new",
  expiresIn: 3600,
  ...overrides,
});

describe("makeRefreshCoalescer — 单 key 合并", () => {
  it("多个并发调用方只触发 1 次 refreshFn 调用", async () => {
    const refreshFn = vi.fn(async (rt: string): Promise<TokenResponse> => {
      // 模拟网络延迟
      await new Promise((r) => setTimeout(r, 20));
      return sampleToken({ accessToken: `at-for-${rt}` });
    });
    const coalesced = makeRefreshCoalescer<[string], TokenResponse>(refreshFn);
    // 5 个并发调用方,使用同一个 refresh_token
    const results = await Promise.all([
      coalesced("rt-A"),
      coalesced("rt-A"),
      coalesced("rt-A"),
      coalesced("rt-A"),
      coalesced("rt-A"),
    ]);
    expect(refreshFn).toHaveBeenCalledTimes(1);
    // 5 个结果完全相同(共享同一 Promise)
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
    expect(results[2]).toBe(results[3]);
    expect(results[3]).toBe(results[4]);
  });

  it("完成后 in-flight 状态被清空(允许下一次刷新)", async () => {
    const refreshFn = vi.fn(async (): Promise<TokenResponse> => sampleToken());
    const coalesced = makeRefreshCoalescer<[string], TokenResponse>(refreshFn);
    const c = coalesced as ReturnType<typeof makeRefreshCoalescer<[string], TokenResponse>>;
    await coalesced("rt-1");
    expect(c.inFlightCount()).toBe(0);
    // 第二次调用再次实际执行 refresh
    await coalesced("rt-1");
    expect(refreshFn).toHaveBeenCalledTimes(2);
  });

  it("失败时也清空 in-flight 状态(避免永远卡住)", async () => {
    const refreshFn = vi.fn(async (): Promise<TokenResponse> => {
      throw new Error("IdP 5xx");
    });
    const coalesced = makeRefreshCoalescer<[string], TokenResponse>(refreshFn);
    const c = coalesced as ReturnType<typeof makeRefreshCoalescer<[string], TokenResponse>>;
    await expect(coalesced("rt-1")).rejects.toThrow("IdP 5xx");
    expect(c.inFlightCount()).toBe(0);
    // 失败后,下次调用可以重试
    await expect(coalesced("rt-1")).rejects.toThrow("IdP 5xx");
    expect(refreshFn).toHaveBeenCalledTimes(2);
  });

  it("失败时所有并发 awaiter 也都失败(不静默)", async () => {
    const refreshFn = vi.fn(async (): Promise<TokenResponse> => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("network error");
    });
    const coalesced = makeRefreshCoalescer<[string], TokenResponse>(refreshFn);
    const results = Promise.all([
      coalesced("rt-A").catch((e) => e),
      coalesced("rt-A").catch((e) => e),
      coalesced("rt-A").catch((e) => e),
    ]);
    const errs = await results;
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect((errs[0] as Error).message).toBe("network error");
    expect((errs[1] as Error).message).toBe("network error");
    expect((errs[2] as Error).message).toBe("network error");
  });
});

describe("makeRefreshCoalescer — 多 key 隔离", () => {
  it("不同 refresh_token 互不合并(并行刷新不同账号)", async () => {
    const refreshFn = vi.fn(async (rt: string): Promise<TokenResponse> => {
      await new Promise((r) => setTimeout(r, 10));
      return sampleToken({ accessToken: `at-${rt}` });
    });
    const coalesced = makeRefreshCoalescer<[string], TokenResponse>(refreshFn);
    const [a, b, c] = await Promise.all([
      coalesced("rt-A"),
      coalesced("rt-B"),
      coalesced("rt-C"),
    ]);
    expect(refreshFn).toHaveBeenCalledTimes(3);
    expect((a as TokenResponse).accessToken).toBe("at-rt-A");
    expect((b as TokenResponse).accessToken).toBe("at-rt-B");
    expect((c as TokenResponse).accessToken).toBe("at-rt-C");
  });

  it("keyOf 自定义提取器生效", async () => {
    type Args = [string, { id: string }];
    const refreshFn = vi.fn(async (_rt: string, _meta: { id: string }): Promise<TokenResponse> => {
      return sampleToken();
    });
    const coalesced = makeRefreshCoalescer<Args, TokenResponse>(refreshFn, {
      keyOf: (rt) => `tenant:${rt}`,
    });
    // 两次调用,虽然第一个参数相同 + meta 不同,但 keyOf 只看第一个参数 → 合并
    await Promise.all([coalesced("rt-A", { id: "u1" }), coalesced("rt-A", { id: "u2" })]);
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });
});

describe("makeRefreshCoalescer — 并发节奏", () => {
  it("in-flight 期间新调用进入 in-flight 集合", async () => {
    let release!: () => void;
    const block = new Promise<void>((r) => {
      release = r;
    });
    const refreshFn = vi.fn(async (): Promise<TokenResponse> => {
      await block;
      return sampleToken();
    });
    const coalesced = makeRefreshCoalescer<[string], TokenResponse>(refreshFn);
    const c = coalesced as ReturnType<typeof makeRefreshCoalescer<[string], TokenResponse>>;
    const p1 = coalesced("rt");
    const p2 = coalesced("rt");
    const p3 = coalesced("rt");
    // 此时 3 个调用方共享 1 个 in-flight Promise
    expect(c.inFlightCount()).toBe(1);
    release();
    await Promise.all([p1, p2, p3]);
    expect(c.inFlightCount()).toBe(0);
  });

  it("串行调用每次都执行 refresh(无合并语义,因为 key 已清除)", async () => {
    const refreshFn = vi.fn(async (): Promise<TokenResponse> => sampleToken());
    const coalesced = makeRefreshCoalescer<[string], TokenResponse>(refreshFn);
    await coalesced("rt-1");
    await coalesced("rt-1");
    await coalesced("rt-1");
    expect(refreshFn).toHaveBeenCalledTimes(3);
  });
});
