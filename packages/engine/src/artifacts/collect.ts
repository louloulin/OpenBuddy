import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { CheckpointRecord } from "../checkpoints/store.js";

/**
 * 产物 (20261115-ui §5.5): files the agent created or modified in a session —
 * write/edit only, never reads. Built from the session's full entry history
 * (compaction does not delete entries), merged with checkpoint records.
 */
export interface ArtifactInfo {
  path: string;
  status: "created" | "modified";
  toolCallIds: string[];
  added: number;
  removed: number;
  firstAt: number;
  lastAt: number;
  exists: boolean;
  size?: number;
  /** Written from an answer's code block with 「应用」 rather than by a tool. */
  applied?: boolean;
}

type Entry = { type: string; timestamp?: string; message?: { role?: string; content?: unknown; toolCallId?: string; isError?: boolean; details?: unknown; timestamp?: number } };
const TRACKED = new Set(["write", "edit"]);

function countPatch(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}
const lines = (text: string) => (text ? text.replace(/\n$/, "").split("\n").length : 0);

export async function collectArtifacts(entries: Entry[], cwd: string, checkpoints: CheckpointRecord[]): Promise<ArtifactInfo[]> {
  const calls = new Map<string, { name: string; path: string; args: Record<string, unknown>; at: number }>();
  const results = new Map<string, { isError: boolean; details?: unknown }>();
  for (const entry of entries) {
    const message = entry.type === "message" ? entry.message : undefined;
    if (!message) continue;
    const at = message.timestamp ?? (entry.timestamp ? Date.parse(entry.timestamp) : Date.now());
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content as Array<Record<string, unknown>>) {
        if (part.type !== "toolCall" || !TRACKED.has(String(part.name))) continue;
        const args = (part.arguments ?? {}) as Record<string, unknown>;
        const raw = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : undefined;
        if (!raw || typeof part.id !== "string") continue;
        calls.set(part.id, { name: String(part.name), path: isAbsolute(raw) ? raw : resolve(cwd, raw), args, at });
      }
    } else if (message.role === "toolResult" && message.toolCallId) {
      results.set(message.toolCallId, { isError: !!message.isError, details: message.details });
    }
  }
  const byPath = new Map<string, ArtifactInfo>();
  for (const [id, call] of calls) {
    const result = results.get(id);
    if (result?.isError) continue;
    let delta = { added: 0, removed: 0 };
    const patch = (result?.details as { patch?: unknown; diff?: unknown } | undefined)?.patch ?? (result?.details as { diff?: unknown } | undefined)?.diff;
    if (typeof patch === "string") delta = countPatch(patch);
    else if (call.name === "write" && typeof call.args.content === "string") delta = { added: lines(call.args.content), removed: 0 };
    const prev = byPath.get(call.path);
    if (prev) {
      prev.toolCallIds.push(id);
      prev.added += delta.added;
      prev.removed += delta.removed;
      prev.lastAt = Math.max(prev.lastAt, call.at);
      prev.firstAt = Math.min(prev.firstAt, call.at);
    } else {
      byPath.set(call.path, { path: call.path, status: "modified", toolCallIds: [id], ...delta, firstAt: call.at, lastAt: call.at, exists: false });
    }
  }
  // 「应用」 writes are this conversation's files too: listed, diffed and restorable like tool writes.
  for (const record of checkpoints.filter((r) => r.source === "apply").sort((a, b) => a.at - b.at)) {
    const prev = byPath.get(record.path);
    if (prev) { prev.lastAt = Math.max(prev.lastAt, record.at); prev.applied = true; continue; }
    byPath.set(record.path, { path: record.path, status: record.before === null ? "created" : "modified", toolCallIds: [], added: 0, removed: 0, firstAt: record.at, lastAt: record.at, exists: false, applied: true });
  }
  for (const artifact of byPath.values()) {
    const ids = new Set(artifact.toolCallIds);
    const first = checkpoints.filter((r) => r.source === "tool" && r.toolCallId && ids.has(r.toolCallId)).sort((a, b) => a.at - b.at)[0];
    if (first?.before === null) artifact.status = "created";
    try {
      const info = await stat(artifact.path);
      artifact.exists = info.isFile();
      artifact.size = info.size;
    } catch { artifact.exists = false; }
  }
  return [...byPath.values()].sort((a, b) => b.lastAt - a.lastAt);
}
