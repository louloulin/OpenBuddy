import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { EngineContext } from "../engine-context.js";

/**
 * 会话 JSONL 导出 / 导入 (20261116-pii W6.5)。
 *
 * - 导出一段分支的会话头 + 当前分支条目（Pi `AgentSession.exportToJsonl`）。
 * - 导入把外部 JSONL 当作一个临时会话打开，再 fork 成新会话（新 id、落在本应用的
 *   sessions 目录），原文件不会被改动；导入后的任务是普通会话，可继续对话。
 */

const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export function exportJsonl(engine: EngineContext, id: string, outputPath?: string) {
  if (outputPath !== undefined && !isAbsolute(outputPath)) throw Error("invalid_payload: outputPath");
  return engine.live(id).exportToJsonl(outputPath);
}

export async function importJsonl(engine: EngineContext, path: string): Promise<string> {
  if (!isAbsolute(path)) throw Error("invalid_payload: path");
  if (!existsSync(path) || !statSync(path).isFile()) throw Error("session_file_not_found: 找不到这个文件");
  if (statSync(path).size > MAX_IMPORT_BYTES) throw Error("session_file_too_large: 会话文件超过 64MB");
  const manager = SessionManager.open(path);
  const slot = await engine.open(manager);
  try {
    return await engine.fork(slot.id);
  } finally {
    await engine.close(slot.id).catch(() => {});
  }
}
