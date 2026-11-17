/**
 * How a message from the phone enters a turn (20261117-mobile.md §2.3).
 *
 * The desktop rejects `agent_send` while a turn is running ("会话忙碌"), so the
 * phone has to choose one of three dispositions — the same three the desktop
 * composer offers: send now, queue as a follow-up, or steer the running turn.
 * Keeping this decision pure makes the busy/idle rules testable.
 */

export type TurnDisposition = 'send' | 'follow_up' | 'steer'

export type TurnQueue = { steering: string[]; followUp: string[] }

export const EMPTY_QUEUE: TurnQueue = { steering: [], followUp: [] }

/** Idle → send; busy → queue by default, steer only when explicitly asked. */
export function dispositionFor(busy: boolean, wantsSteer = false): TurnDisposition {
  if (!busy) return 'send'
  return wantsSteer ? 'steer' : 'follow_up'
}

export type QueueRow = { kind: 'steering' | 'followUp'; index: number; text: string }

/** Flattens the desktop queue for the chip row, keeping the original indices. */
export function queueRows(queue: TurnQueue | undefined): QueueRow[] {
  if (!queue) return []
  return [
    ...queue.steering.map((text, index) => ({ kind: 'steering' as const, index, text })),
    ...queue.followUp.map((text, index) => ({ kind: 'followUp' as const, index, text })),
  ]
}

/** Removes one chip and returns the queue the desktop expects back. */
export function withoutQueueItem(queue: TurnQueue | undefined, kind: QueueRow['kind'], index: number): TurnQueue {
  const base = queue ?? EMPTY_QUEUE
  return {
    steering: kind === 'steering' ? base.steering.filter((_, i) => i !== index) : [...base.steering],
    followUp: kind === 'followUp' ? base.followUp.filter((_, i) => i !== index) : [...base.followUp],
  }
}

export function queueLabel(kind: QueueRow['kind']): string {
  return kind === 'steering' ? '插话' : '排队'
}
