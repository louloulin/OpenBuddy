/**
 * RefreshCoalescer — OIDC/OAuth token 刷新的「同 key 合并」机制。
 *
 * 问题:IdP(OIDC/OAuth 提供商)的 `/token` 端点有 QPS 限制。当多个并发调用方
 *   (例如 Webview 渲染层 + 后台 IPC + 定时刷新任务)同时检测到 access_token
 *   即将过期,它们都会触发 refresh,造成:
 *     - 1) 重复的 IdP 网络请求(浪费 QPS)
 *     - 2) 竞态:后到的 refresh 可能覆盖前一个的 refresh_token(轮换 refresh_token)
 *     - 3) 引发 IdP 限流 / 临时封禁
 *
 * 解决方案(PI-Desktop `creds` 包同款):
 *   同一个 refresh_token key 上,只有第一个调用方真正执行 refreshFn,
 *   其余并发调用方 await 同一个 in-flight Promise,共享结果。
 *
 * 设计:
 *   - 平台无关(无 Electron / Node 专有 API)
 *   - key 字符串作为合并维度(默认 = refresh_token 字符串本身)
 *   - 失败传播:第一个调用方失败,后续调用方也失败(避免静默重试风暴)
 *   - TTL:成功后清除 in-flight 记录;失败也清除(允许下一次重试)
 *
 * 用法:
 *   const refreshOnce = makeRefreshCoalescer<TokenResponse, [string]>(
 *     (refreshToken, http) => refreshAccessToken(config, refreshToken, http),
 *   );
 *   const token = await refreshOnce(currentRefreshToken, http);
 *   // 5 个并发调用方同时调用 refreshOnce(...) → 1 次实际 HTTP
 */
import type { TokenResponse } from "./oidc-auth.js";

/** Refresh coalescer 接口。 */
export interface RefreshCoalescer {
  /**
   * 同步合并并执行 refresh。
   *
   * @param refreshKey 用于合并幂等的 key(默认 = refresh_token 字符串本身)
   * @param args 透传给 refreshFn 的参数(例如 http client、config)
   * @returns 新的 TokenResponse
   */
  (...args: unknown[]): Promise<TokenResponse>;
}

type AsyncFn<Args extends unknown[], R> = (...args: Args) => Promise<R>;

/**
 * 工厂函数:把异步 refreshFn 包装为带合并语义的 coalescer。
 *
 * 注意:RefreshCoalescer 的参数签名是 (...args: unknown[]) → Promise<TokenResponse>,
 * 是因为 JS 工厂无法表达「refreshKey 必须来自 args[0]」的类型契约;调用方
 * 应保持「第一个参数是字符串 key」的契约,违反此契约会失去合并语义(每个不同
 * key 都会触发一次 refresh)。
 */
export function makeRefreshCoalescer<Args extends unknown[], R = TokenResponse>(
  refreshFn: AsyncFn<Args, R>,
  options?: {
    /** 自定义 key 提取器(默认 = JSON.stringify(args[0]))。 */
    keyOf?: (...args: Args) => string;
  },
): RefreshCoalescer & { readonly inFlightCount: () => number } {
  const inFlight = new Map<string, Promise<R>>();
  const keyOf = options?.keyOf ?? ((...args: Args) => JSON.stringify(args[0]));

  const fn = (...args: unknown[]): Promise<R> => {
    const key = keyOf(...(args as Args));
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = (async () => {
      try {
        return await refreshFn(...(args as Args));
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, promise);
    return promise;
  };

  return Object.assign(fn, {
    inFlightCount: () => inFlight.size,
  }) as RefreshCoalescer & { readonly inFlightCount: () => number };
}
