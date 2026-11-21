/**
 * 运行日志读取 (O1): read-only access for the in-app log viewer.
 *
 * The writer (`StructuredLogger`) already redacts before disk, and this reader still redacts
 * defensively (an older file may predate a rule). Only the logger's own names are accepted, so a
 * renderer cannot turn the command into an arbitrary file read.
 */
import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  LOG_ALL,
  MAX_LOG_LINES,
  validLogLevel,
  validLogName,
  validLogSource,
  type LogEntry,
  type LogFileInfo,
  type LogList,
  type LogRead,
} from "@openbuddy/protocol/logs";
import { redactText, redactValue } from "./logger.js";

/** Read at most the last 8 MB of a file; a day file is capped at 2 MB by the writer anyway. */
const MAX_BYTES = 8 * 1024 * 1024;

export interface LogReadOptions {
  limit?: number;
  level?: string;
  query?: string;
}

export class LogReader {
  constructor(private readonly dir: string) {}

  files(): LogFileInfo[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    const out: LogFileInfo[] = [];
    for (const name of names) {
      if (!validLogName(name)) continue;
      try {
        const stat = statSync(join(this.dir, name));
        out.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // Vanished between readdir and stat; skip it.
      }
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  list(): LogList {
    const files = this.files();
    return { dir: this.dir, files, totalBytes: files.reduce((sum, file) => sum + file.size, 0) };
  }

  read(name: unknown, options: LogReadOptions = {}): LogRead {
    if (!validLogSource(name)) throw new Error("invalid_log_name");
    const limit = clampLimit(options.limit);
    const level = options.level && options.level !== "all" ? options.level : undefined;
    if (level !== undefined && !validLogLevel(level)) throw new Error("invalid_log_level");
    const query = typeof options.query === "string" ? redactText(options.query.trim()).toLowerCase() : "";

    if (name === LOG_ALL) return this.readAll(level, query, limit);
    const { entries, malformed, truncated } = this.collect(name, level, query);
    const limited = entries.length > limit;
    return {
      name,
      entries: limited ? entries.slice(-limit).reverse() : entries.slice().reverse(),
      malformed,
      truncated: truncated || limited,
    };
  }

  /** Merge every log file newest-first; the same filters apply across files. */
  private readAll(level: string | undefined, query: string, limit: number): LogRead {
    const files = this.files().slice(0, MAX_ALL_FILES);
    const merged: LogEntry[] = [];
    let malformed = 0;
    let truncated = files.length === 0;
    for (const file of files) {
      const result = this.collect(file.name, level, query);
      merged.push(...result.entries);
      malformed += result.malformed;
      truncated = truncated || result.truncated;
    }
    // ISO timestamps sort lexicographically; entries without one keep file order at the end.
    merged.sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
    const limited = merged.length > limit;
    return {
      name: LOG_ALL,
      entries: limited ? merged.slice(0, limit) : merged,
      malformed,
      truncated: truncated || limited,
    };
  }

  /** One file's filtered entries in file order (oldest → newest). */
  private collect(name: string, level: string | undefined, query: string): { entries: LogEntry[]; malformed: number; truncated: boolean } {
    let raw: string;
    let truncated = false;
    try {
      const path = join(this.dir, name);
      const size = statSync(path).size;
      const start = Math.max(0, size - MAX_BYTES);
      const length = size - start;
      const buffer = Buffer.alloc(length);
      const fd = openSync(path, "r");
      try {
        readSync(fd, buffer, 0, length, start);
      } finally {
        closeSync(fd);
      }
      raw = buffer.toString("utf8");
      truncated = start > 0;
      // Starting mid-file can cut the first line in half; drop it instead of showing garbage.
      if (truncated) {
        const firstNewline = raw.indexOf("\n");
        raw = firstNewline === -1 ? "" : raw.slice(firstNewline + 1);
      }
    } catch {
      throw new Error("log_not_found");
    }

    const lines = raw.split("\n").filter((line) => line.trim() !== "");
    const entries: LogEntry[] = [];
    let malformed = 0;
    for (const line of lines) {
      const entry = parseLine(line);
      if (!entry) {
        malformed += 1;
        continue;
      }
      if (level && entry.level !== level) continue;
      if (query && !matches(entry, query)) continue;
      entries.push(entry);
    }
    return { entries, malformed, truncated };
  }
}

/** Cross-file reads stop here so a long-lived log directory cannot balloon one request. */
const MAX_ALL_FILES = 20;

const clampLimit = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 500;
  return Math.min(MAX_LOG_LINES, Math.max(1, Math.floor(value)));
};

function parseLine(line: string): LogEntry | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const message = typeof row.message === "string" ? row.message : typeof row.msg === "string" ? row.msg : "";
  if (!message) return undefined;
  const rawLevel = row.level;
  const level = typeof rawLevel === "string" && validLogLevel(rawLevel) ? rawLevel : undefined;
  return {
    ...(typeof row.ts === "string" ? { ts: row.ts } : {}),
    ...(level ? { level } : {}),
    ...(typeof row.scope === "string" ? { scope: row.scope } : {}),
    message: redactText(message),
    ...(row.data !== undefined ? { data: redactValue(row.data) } : {}),
  };
}

function matches(entry: LogEntry, query: string): boolean {
  return (
    entry.message.toLowerCase().includes(query) ||
    (entry.scope?.toLowerCase().includes(query) ?? false) ||
    (entry.level?.toLowerCase().includes(query) ?? false)
  );
}
