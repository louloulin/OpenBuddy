/**
 * 运行日志 (O1): the host lists and reads the structured JSONL files the main process writes.
 * The renderer never supplies a path — only a file name that matches the logger's own naming.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogFileInfo {
  name: string;
  size: number;
  mtimeMs: number;
}

export interface LogList {
  /** Absolute directory, so the UI can offer "open folder" without guessing. */
  dir: string;
  files: LogFileInfo[];
  totalBytes: number;
}

export interface LogEntry {
  ts?: string;
  level?: LogLevel;
  scope?: string;
  message: string;
  /** Structured payload, already redacted on write; kept opaque for display. */
  data?: unknown;
}

export interface LogRead {
  name: string;
  /** Newest first. */
  entries: LogEntry[];
  /** Lines that were not valid JSON (kept out of `entries`). */
  malformed: number;
  /** True when the byte cap or the line limit dropped older content. */
  truncated: boolean;
}

/** One page of log lines; the host caps the count too. */
export const MAX_LOG_LINES = 2000;

/** Read every log file newest-first (cross-file search/export). */
export const LOG_ALL = "all";

/** The only file names the host will read: the logger's own day/rotation names. */
const LOG_NAME_RE = /^openbuddy-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/;

export function validLogName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && LOG_NAME_RE.test(value);
}

/** What `logs_read` accepts: one real log file, or `all` for the merged view. */
export function validLogSource(value: unknown): value is string {
  return value === LOG_ALL || validLogName(value);
}

export function validLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}
