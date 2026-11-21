/**
 * Connection wording and outbox rules (20261115-mobile.md §4.6).
 *
 * `GatewayTransport` already owns reconnect timing; these helpers exist so the
 * UI text and the "may I send now?" decision live in one testable place rather
 * than in each screen.
 */

import type { TransportState } from '@openbuddy/client/transport'

export type Banner = { tone: 'info' | 'warn' | 'error'; text: string } | null

export function bannerFor(state: TransportState, hasPairedDevice: boolean): Banner {
  if (!hasPairedDevice) return { tone: 'info', text: '还没有连接电脑，先扫码配对。' }
  if (state === 'open') return null
  if (state === 'connecting') return { tone: 'info', text: '正在连接电脑…' }
  return { tone: 'warn', text: '电脑已断开，正在重连。新消息会先排队。' }
}

/**
 * A send is allowed immediately only on an open connection; otherwise the
 * message waits in the outbox and is flushed on reconnect (the desktop sees it
 * once, in order, because the queue is drained serially).
 */
export function canSendNow(state: TransportState): boolean {
  return state === 'open'
}

export type OutboxItem = {
  id: string
  sessionId: string
  text: string
  attachments: { path: string }[]
  queuedAt: number
}

/** Drains in FIFO order and stops at the first failure so ordering survives. */
export async function flushOutbox(
  queue: OutboxItem[],
  send: (item: OutboxItem) => Promise<void>,
): Promise<{ sent: number; remaining: OutboxItem[]; error?: string }> {
  let sent = 0
  for (const item of queue) {
    try {
      await send(item)
      sent += 1
    } catch (error) {
      return {
        sent,
        remaining: queue.slice(sent),
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  return { sent, remaining: [] }
}
