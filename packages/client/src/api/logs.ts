// 运行日志 (O1): read the host's own JSONL log files for the in-app viewer.
import { invoke } from "../ipc";
import type { LogList, LogRead, LogLevel } from "@openbuddy/protocol/logs";

export const logsList = () => invoke<LogList>("logs_list", {});

export const logsRead = (name: string, options: { limit?: number; level?: LogLevel | "all"; query?: string } = {}) =>
  invoke<LogRead>("logs_read", {
    name,
    ...(options.limit ? { limit: options.limit } : {}),
    ...(options.level && options.level !== "all" ? { level: options.level } : {}),
    ...(options.query && options.query.trim() ? { query: options.query.trim() } : {}),
  });

export type { LogList, LogRead, LogEntry, LogFileInfo, LogLevel } from "@openbuddy/protocol/logs";
