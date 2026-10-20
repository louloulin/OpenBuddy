export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export const LOG_LEVELS: readonly LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
export const LOG_LEVEL_VALUES: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

export interface LogContext {
  traceId?: string;
  sessionId?: string;
  scope?: string;
  [key: string]: unknown;
}

export function generateTraceId(): string {
  const cryptoApi = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi?.getRandomValues?.(bytes);
  if (!cryptoApi?.getRandomValues) for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 诊断文本脱敏 + 截断(可观测性§4,2026-10-19 生产评审)。
 *
 * 此前这个函数**只截断不脱敏**,名字在骗人(前 80 字符原样输出)。现在先按
 * 常见密钥形态打码,再截断;无密钥形态时行为与旧版一致(测试锁死)。
 */
const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(sk-[A-Za-z0-9_-]{8,})/g, "sk-***"],
  [/\b(ghp_[A-Za-z0-9]{20,})/g, "ghp_***"],
  [/\b(AKIA[0-9A-Z]{12,})/g, "AKIA***"],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi, "$1***"],
  [/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)["']?\s*[:=]\s*["']?)[^\s,;"'}]{6,}/gi, "$1***"],
];

export function redactText(value: string | null | undefined, max = 80): string {
  if (value == null) return "";
  let text = String(value);
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
  return text.length <= max ? text : `${text.slice(0, max)}…[TRUNC ${value.length}]`;
}
