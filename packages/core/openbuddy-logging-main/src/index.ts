import pino, { type Logger as PinoLogger } from "pino";
import { Writable } from "node:stream";
import { createWriteStream, existsSync, renameSync, statSync } from "node:fs";
import { generateTraceId, isLogLevel, redactText, type LogContext, type LogLevel } from "@openbuddy/logging-shared";

export type { LogContext, LogLevel };
export type MainLogger = PinoLogger;

export interface CreateMainLoggerOptions {
  filePath?: string;
  level?: LogLevel;
  devMode?: boolean;
  serviceName?: string;
  /** Optional pino logger name (forwarded to pino for compatibility). */
  name?: string;
  baseContext?: LogContext;
  /** Maximum file size before rotating. Accepts "10m", "1g", "500k". Default: "10m". */
  size?: string;
  /** Maximum number of rotated files to keep (log.1 ... log.N). Default: 5. */
  maxFiles?: number;
}

function levelFor(options: CreateMainLoggerOptions): LogLevel {
  if (options.level && isLogLevel(options.level)) return options.level;
  const environmentLevel = process.env.OPENBUDDY_LOG_LEVEL;
  if (isLogLevel(environmentLevel)) return environmentLevel;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function cleanContext(context: LogContext): Record<string, unknown> {
  return Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
}

function parseSize(value: string): number {
  const match = /^(\d+(?:\.\d+)?)([kmg]?)$/i.exec(value.trim());
  if (!match) return 10 * 1024 * 1024;
  const n = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  if (unit === "k") return Math.floor(n * 1024);
  if (unit === "m") return Math.floor(n * 1024 * 1024);
  if (unit === "g") return Math.floor(n * 1024 * 1024 * 1024);
  return Math.floor(n);
}

/**
 * Electron-friendly rolling file stream.
 *
 * Replaces pino-roll (which uses worker_threads via ThreadStream and fails
 * inside the Electron main process with "unable to determine transport target
 * for pino-roll"). This implementation runs entirely in-process: it forwards
 * writes to a Node.js WritableStream and rotates the underlying file once
 * `maxBytes` is exceeded, keeping up to `maxFiles` historical copies.
 *
 * The caller is responsible for ensuring the parent directory exists — when
 * the log directory is supplied by `app.getPath("logs")`, Electron creates
 * it for us, so we don't run mkdir here.
 */
function createRollingFileStream(filePath: string, maxBytes: number, maxFiles: number): Writable {
  let currentBytes = 0;
  try { currentBytes = statSync(filePath).size; } catch { /* file may not exist yet */ }

  let stream: NodeJS.WritableStream = createWriteStream(filePath, { flags: "a" });

  function rotate(): void {
    try { (stream as unknown as { end?: () => void }).end?.(); } catch { /* best-effort */ }
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const oldPath = `${filePath}.${index}`;
      const newPath = `${filePath}.${index + 1}`;
      if (existsSync(oldPath)) {
        try { renameSync(oldPath, newPath); } catch { /* ignore */ }
      }
    }
    if (existsSync(filePath)) {
      try { renameSync(filePath, `${filePath}.1`); } catch { /* ignore */ }
    }
    stream = createWriteStream(filePath, { flags: "a" });
    currentBytes = 0;
  }

  return new Writable({
    decodeStrings: false,
    write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      currentBytes += Buffer.byteLength(text);
      if (currentBytes >= maxBytes) {
        rotate();
      }
      stream.write(text, (error?: Error | null) => callback(error ?? null));
    },
    final(callback: (error?: Error | null) => void): void {
      try { (stream as unknown as { end?: () => void }).end?.(); } catch { /* best-effort */ }
      callback();
    },
  });
}

export function createMainLogger(options: CreateMainLoggerOptions = {}): MainLogger {
  const level = levelFor(options);
  const destinations: Array<{ level: LogLevel; stream: NodeJS.WritableStream }> = [{ level, stream: process.stdout }];
  if (options.filePath) {
    const stream = createRollingFileStream(
      options.filePath,
      parseSize(options.size ?? "10m"),
      options.maxFiles ?? 5,
    );
    destinations.push({ level, stream });
  }
  const stream = pino.multistream(destinations);
  return pino({
    level,
    base: { service: options.serviceName ?? "openbuddy-main", ...cleanContext(options.baseContext ?? {}) },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: ["text", "prompt", "apiKey", "token", "secret"], censor: "[REDACTED]" },
    formatters: { level: (label) => ({ level: label }) },
  }, stream);
}

export function withContext(parent: MainLogger, context: LogContext): MainLogger {
  return parent.child(cleanContext(context));
}

export function ensureTrace(context: LogContext): LogContext & { traceId: string } {
  return { ...context, traceId: context.traceId ?? generateTraceId() };
}

export { redactText };
