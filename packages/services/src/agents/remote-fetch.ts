/**
 * 远程专家包下载 (B3b). One small, auditable HTTP client: https only, no credentials in the
 * URL, bounded redirects / bytes / time, and a pinned DNS lookup so a rebinding answer cannot
 * swap the checked address between validation and connect. Plain `fetch` re-resolves internally,
 * so this uses `node:https` directly.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

export interface RemoteFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Tests only: allow loopback / plain http / arbitrary ports. Never set this in production. */
  allowLoopback?: boolean;
  /** Tests only: replace DNS resolution (e.g. to prove a private answer is rejected). */
  resolveHost?: (host: string) => Promise<string[]>;
}

export interface RemoteBytes {
  bytes: Buffer;
  contentType: string;
  finalUrl: string;
}

const DEFAULTS = { timeoutMs: 15_000, maxBytes: 20 * 1024 * 1024, maxRedirects: 3 } as const;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const v4 = (address: string): number[] | undefined => {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : undefined;
};

/** Public, globally routable addresses only. Anything ambiguous is rejected. */
export function isPublicAddress(address: string): boolean {
  const clean = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(clean);
  if (mapped) return isPublicAddress(mapped[1]);
  const parts = v4(clean);
  if (parts) {
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false; // multicast / reserved / broadcast
    return true;
  }
  if (!isIP(clean)) return false;
  if (clean === "::1" || clean === "::") return false;
  if (/^f[cd][0-9a-f]{2}:/.test(clean)) return false; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(clean)) return false; // fe80::/10 link local
  return true;
}

const loopbackHost = (hostname: string) => LOOPBACK_HOSTS.has(hostname.toLowerCase()) || hostname.toLowerCase().endsWith(".localhost");

/** Resolve one hop and return the address the socket must connect to. */
async function assertAllowed(url: URL, options: RemoteFetchOptions): Promise<{ address: string; family: number }> {
  const allowLoopback = options.allowLoopback === true;
  if (url.protocol !== "https:") {
    if (!(allowLoopback && url.protocol === "http:" && loopbackHost(url.hostname))) throw Error("remote_insecure: 仅支持 https 链接");
  }
  if (url.username || url.password) throw Error("remote_forbidden: 链接不能包含用户名或密码");
  if (!allowLoopback && url.port && url.port !== "443") throw Error("remote_insecure: 仅支持 443 端口");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const resolved: string[] = isIP(host)
    ? [host]
    : await (options.resolveHost
        ? options.resolveHost(host)
        : dnsLookup(host, { all: true, verbatim: true }).then((rows) => rows.map((row) => row.address)));
  if (resolved.length === 0) throw Error("remote_dns: 无法解析主机");
  if (!allowLoopback) {
    if (loopbackHost(host) || host.endsWith(".local") || host.endsWith(".internal"))
      throw Error("remote_forbidden: 不允许访问本机或内网地址");
    if (resolved.some((address) => !isPublicAddress(address))) throw Error("remote_forbidden: 不允许访问内网地址");
  }
  const address = resolved[0];
  return { address, family: isIP(address) === 6 ? 6 : 4 };
}

interface Hop
{
  status: number;
  location?: string;
  contentType: string;
  bytes?: Buffer;
}

function requestOnce(url: URL, target: { address: string; family: number }, options: Required<Pick<RemoteFetchOptions, "timeoutMs" | "maxBytes">>): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const pinned = ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) =>
      callback(null, target.address, target.family)) as LookupFunction;
    const request = transport(
      url,
      {
        method: "GET",
        headers: {
          accept: "application/zip, application/octet-stream, application/json, text/markdown, text/plain;q=0.8",
          "user-agent": "OpenBuddy/1.0 (+expert-link)",
        },
        lookup: pinned,
        timeout: options.timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = typeof response.headers.location === "string" ? response.headers.location : undefined;
        const contentType = String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (REDIRECTS.has(status)) {
          response.resume();
          resolve({ status, location, contentType });
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(Error(`remote_http: 下载失败（HTTP ${status}）`));
          return;
        }
        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          response.destroy();
          reject(Error(`remote_too_large: 文件超过 ${options.maxBytes} 字节`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxBytes) {
            response.destroy();
            reject(Error(`remote_too_large: 文件超过 ${options.maxBytes} 字节`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status, contentType, bytes: Buffer.concat(chunks) }));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(Error("remote_timeout: 下载超时")));
    request.on("error", reject);
    request.end();
  });
}

/** Download a package over https with SSRF guards and hard size/time limits. */
export async function fetchRemoteBytes(raw: string, options: RemoteFetchOptions = {}): Promise<RemoteBytes> {
  const settings = {
    timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
    maxBytes: options.maxBytes ?? DEFAULTS.maxBytes,
  };
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Error("remote_invalid_url: 链接格式不正确");
  }
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const target = await assertAllowed(url, options);
    const response = await requestOnce(url, target, settings);
    if (REDIRECTS.has(response.status)) {
      if (!response.location) throw Error("remote_http: 重定向缺少目标地址");
      if (hop === maxRedirects) throw Error("remote_redirect: 重定向次数过多");
      url = new URL(response.location, url);
      continue;
    }
    if (!response.bytes) throw Error("remote_http: 空响应");
    return { bytes: response.bytes, contentType: response.contentType, finalUrl: url.href };
  }
  throw Error("remote_redirect: 重定向次数过多");
}
