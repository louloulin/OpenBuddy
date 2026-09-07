/**
 * host-modules/session-queue-items.ts — `agentHost.publicQueueItems()` 工厂.
 *
 * Phase v4 §L-13: extract agent-host.ts:282-296 (~13 行) 到独立 host-module.
 *
 * 把 Pi session 的 steering + follow-up 消息队列投影成 UI 可见的 items 列表,
 * 用于 IPC `agentHost.publicQueueItems(activeSession)` 让 renderer 能列出
 * 当前 session 的 pending messages.
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - `AgentSession` 直接从 `@earendil-works/pi-coding-agent` 导入
 *
 * 设计: 纯函数, 不需要 install. 直接 export.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";

/**
 * PublicQueueItem 是 renderer 用来渲染 pending messages 的最小投影.
 * - `itemId`: 唯一 ID (steer:<text> 或 queue:<text>)
 * - `mode`: "steer" 或 "queue"
 * - `content`: 与 Pi content parts 兼容的最小集合 (text / image)
 */
export interface PublicQueueItem {
  itemId: string;
  mode: "queue" | "steer";
  content: Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data?: string; name?: string }>;
}

/**
 * 把 Pi session 的 steering + follow-up 消息队列投影成 UI 可见的 items.
 * 没有 active session 时返回空数组.
 */
export function publicQueueItems(activeSession: AgentSession | null): readonly PublicQueueItem[] {
  if (!activeSession) return [];
  const items: PublicQueueItem[] = [];
  for (const text of activeSession.getSteeringMessages()) {
    items.push({ itemId: `steer:${text}`, mode: "steer", content: [{ type: "text", text }] });
  }
  for (const text of activeSession.getFollowUpMessages()) {
    items.push({ itemId: `queue:${text}`, mode: "queue", content: [{ type: "text", text }] });
  }
  return items;
}
