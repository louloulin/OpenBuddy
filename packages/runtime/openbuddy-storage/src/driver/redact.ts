import { createHash } from "node:crypto";

export interface RedactEnvelope<T> {
  value: T;
  hash: string;
}

const sensitiveKey = /^(?:api.?key|access.?token|refresh.?token|authorization|password|client.?secret|secret|credential|token|cookie)$/iu;
const sensitiveValue = /((?:bearer\s+|api[_-]?key\s*[=:]\s*|access[_-]?token\s*[=:]\s*|refresh[_-]?token\s*[=:]\s*|client[_-]?secret\s*[=:]\s*|secret\s*[=:]\s*))([^\s,;]+)/giu;

export function redactStorageValue(value: unknown, key?: string, depth = 0): unknown {
  if (key && sensitiveKey.test(key)) return "[redacted]";
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") {
    const redacted = value.replace(sensitiveValue, (_match, prefix: string): string => `${prefix}[redacted]`);
    return redacted.length > 100_000 ? `${redacted.slice(0, 100_000)}…` : redacted;
  }
  if (Array.isArray(value)) return value.slice(0, 1_000).map((entry) => redactStorageValue(entry, undefined, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 1_000).map(([entryKey, entryValue]): [string, unknown] => [
      entryKey,
      redactStorageValue(entryValue, entryKey, depth + 1),
    ]));
  }
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  return value;
}

export function hashRedactedValue(value: unknown): string {
  const redacted = redactStorageValue(value);
  return createHash("sha256").update(JSON.stringify(redacted)).digest("hex");
}
