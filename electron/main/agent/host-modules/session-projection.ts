/**
 * host-modules/session-projection.ts — session 投影基线工具.
 *
 * Phase v4 §L-7: extract agent-host.ts:1773-1810 (~38 行) 到独立 host-module.
 * 这一对函数把 plugin event log + persisted session headers 合并成 renderer
 * 使用的 baseline 投影:
 *   - sessionBaselines(): 全 session 的 lastSeq
 *   - sessionProjectionBaseline(sessionId): 单 session 的 projection KV 表
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 外部依赖通过 install 注入 (pluginEvents + listPersistedSessionInfos +
 *     readPersistedSessionHeader)
 *
 * 设计: 沿用 module-level singleton + install pattern.
 */

import { type SessionEventRecord } from "../../session/session-event-log";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let pluginEventsImpl: (query?: { sessionId?: string; sinceSequence?: number; limit?: number }) => SessionEventRecord[] = () => [];
let listPersistedSessionInfosImpl: () => Promise<Array<{ id: string }>> = async () => [];
let readPersistedSessionHeaderImpl: (sessionId: string) => Promise<{ title?: string; name?: string }> = async () => ({});

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallSessionProjectionDeps {
  /** session-event-log snapshot */
  pluginEvents: (query?: { sessionId?: string; sinceSequence?: number; limit?: number }) => SessionEventRecord[];
  /** session-store.listPersistedSessionInfos */
  listPersistedSessionInfos: () => Promise<Array<{ id: string }>>;
  /** session-store.readPersistedSessionHeader */
  readPersistedSessionHeader: (sessionId: string) => Promise<{ title?: string; name?: string }>;
}

export function installSessionProjection(deps: InstallSessionProjectionDeps): void {
  // v6-G M1 defensive install: 只在 deps 提供有效值时才覆盖 module-level 单例.
  // 如果 deps.pluginEvents / listPersistedSessionInfos / readPersistedSessionHeader
  // 未提供 (例如上游 agent-host.ts 的 installMicrokernelDepsClosures 还没把这
  // 些 closure 透传过来), 保留默认 placeholder, 否则 IPC handler 在 init()
  // 之前调用 sessionBaselines() 会拿到 undefined 报错.
  if (deps.pluginEvents) pluginEventsImpl = deps.pluginEvents;
  if (deps.listPersistedSessionInfos) listPersistedSessionInfosImpl = deps.listPersistedSessionInfos;
  if (deps.readPersistedSessionHeader) readPersistedSessionHeaderImpl = deps.readPersistedSessionHeader;
}

/** 测试 / 调试: 把 module-level singleton 还原成 stub. */
export function __resetSessionProjectionForTest(): void {
  pluginEventsImpl = () => [];
  listPersistedSessionInfosImpl = async () => [];
  readPersistedSessionHeaderImpl = async () => ({});
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 列出所有 session 的最近 sequence (从 in-memory event log 合并到
 * persisted session 索引). Renderer 用这个做 baseline diff.
 *
 * Falls back to event log only if Pi persistence is unavailable.
 */
export async function sessionBaselines(): Promise<Array<{ sessionId: string; lastSeq: number }>> {
  const latest = new Map<string, number>();
  for (const event of pluginEventsImpl()) {
    if (!event.sessionId) continue;
    latest.set(event.sessionId, Math.max(latest.get(event.sessionId) ?? 0, event.sessionSequence ?? event.sequence));
  }
  try {
    for (const session of await listPersistedSessionInfosImpl()) {
      latest.set(session.id, latest.get(session.id) ?? -1);
    }
  } catch {
    // The event log remains a valid fallback while Pi persistence is unavailable.
  }
  return [...latest.entries()].map(([sessionId, lastSeq]) => ({ sessionId, lastSeq }));
}

/**
 * 单 session 的 projection KV 表 (last-write-wins per key), 截至 asOfSeq.
 * Reads through plugin event "session/projection" entries; merges in
 * persisted header.title/name if not already set.
 */
export async function sessionProjectionBaseline(
  sessionId: string,
): Promise<{ asOfSeq: number; values: Readonly<Record<string, unknown>> }> {
  const rows = pluginEventsImpl({ sessionId, limit: 2000 });
  const values = new Map<string, { value: unknown; sequence: number }>();
  let asOfSeq = -1;
  for (const row of rows) {
    const sequence = row.sessionSequence ?? row.sequence;
    asOfSeq = Math.max(asOfSeq, sequence);
    if (row.type !== "session/projection" || !row.payload || typeof row.payload !== "object") continue;
    const payload = row.payload as { key?: unknown; value?: unknown };
    if (typeof payload.key !== "string") continue;
    const previous = values.get(payload.key);
    if (!previous || sequence > previous.sequence) values.set(payload.key, { value: payload.value, sequence });
  }
  try {
    const header = await readPersistedSessionHeaderImpl(sessionId);
    if ((header.title || header.name) && !values.has("title")) values.set("title", { value: header.title ?? header.name, sequence: asOfSeq });
  } catch {
    // A live in-memory session may not have a persisted header yet.
  }
  return { asOfSeq, values: Object.fromEntries([...values].map(([key, row]) => [key, row.value])) };
}
