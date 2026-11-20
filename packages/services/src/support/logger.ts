/**
 * 结构化日志 (O1): JSONL by day, size rotation, 7-day retention, and redaction before anything
 * touches disk. The main process owns one instance; renderer logs arrive through console-message.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  /** Rotate the current day file once it would exceed this size. */
  maxBytes?: number;
  /** Delete day files older than this. */
  retainDays?: number;
  now?: () => number;
}

const KEY_RE = /\b(?:sk|pk|api|token)[-_][A-Za-z0-9_-]{8,}\b/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PATH_RE = /(?:\/(?:Users|home|tmp|private|var|opt|etc)\/[^\s"'\n]+|[A-Za-z]:\\[^\s"'\n]+)/g;
const SECRET_KEY = /key|token|secret|password|authorization|cookie/i;

/** Strip credentials, emails and absolute paths from free text. */
export function redactText(value: string): string {
  return value
    .replace(KEY_RE, "[redacted]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(EMAIL_RE, "[email]")
    .replace(PATH_RE, "[path]");
}

/** Redact a structured value recursively; secret-looking keys lose their value entirely. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 60)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : redactValue(item, depth + 1);
    }
    return out;
  }
  return value;
}

const pad = (value: number) => String(value).padStart(2, "0");
const dayKey = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export class StructuredLogger {
  private readonly maxBytes: number;
  private readonly retainDays: number;
  private readonly now: () => number;
  private prunedAt = 0;

  constructor(private dir: string, options: LoggerOptions = {}) {
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
    this.retainDays = options.retainDays ?? 7;
    this.now = options.now ?? Date.now;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.prune(true);
  }

  private currentFile(ms: number): string {
    return join(this.dir, `openbuddy-${dayKey(ms)}.log`);
  }

  log(level: LogLevel, scope: string, message: string, data?: Record<string, unknown>) {
    const now = this.now();
    const record = {
      ts: new Date(now).toISOString(),
      level,
      scope,
      message: redactText(String(message)),
      ...(data ? { data: redactValue(data) } : {}),
    };
    const line = `${JSON.stringify(record)}\n`;
    const file = this.currentFile(now);
    try {
      if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > this.maxBytes) {
        renameSync(file, `${file}.${now}`);
      }
      appendFileSync(file, line, { mode: 0o600 });
    } catch {
      // Logging must never take the app down (read-only disk, quota, …).
    }
    this.prune();
  }

  debug(scope: string, message: string, data?: Record<string, unknown>) { this.log("debug", scope, message, data); }
  info(scope: string, message: string, data?: Record<string, unknown>) { this.log("info", scope, message, data); }
  warn(scope: string, message: string, data?: Record<string, unknown>) { this.log("warn", scope, message, data); }
  error(scope: string, message: string, data?: Record<string, unknown>) { this.log("error", scope, message, data); }

  /** Current log files, newest first (diagnostics can list them without reading secrets). */
  files(): Array<{ name: string; size: number; mtimeMs: number }> {
    try {
      return readdirSync(this.dir)
        .filter((name) => name.startsWith("openbuddy-") && name.endsWith(".log"))
        .map((name) => {
          const stat = statSync(join(this.dir, name));
          return { name, size: stat.size, mtimeMs: stat.mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
      return [];
    }
  }

  private prune(force = false) {
    const now = this.now();
    if (!force && now - this.prunedAt < 60 * 60_000) return;
    this.prunedAt = now;
    const cutoff = now - this.retainDays * 86_400_000;
    try {
      for (const name of readdirSync(this.dir)) {
        if (!name.startsWith("openbuddy-") || !name.endsWith(".log")) continue;
        const path = join(this.dir, name);
        if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
      }
    } catch {
      // ignore
    }
  }
}
