/**
 * Event ring buffer with a monotonic sequence (20261115-mobile.md §3.2).
 *
 * Phones reconnect on mobile networks constantly. Every event the desktop
 * emits gets a gap-free `seq`; a reconnecting client sends back the last seq
 * it saw and the buffer replays exactly the events it missed. Events evicted
 * from the ring are reported as a hole so the client can resync from a
 * snapshot instead of silently missing turns.
 */

export type BridgeEvent = {
  /** Monotonic, gap-free per bridge. */
  seq: number
  event: string
  payload: unknown
}

const BUFFER_SIZE = 2048

export class EventBuffer {
  private readonly ring: BridgeEvent[] = []
  private nextSeq = 1

  push(event: string, payload: unknown): BridgeEvent {
    const item: BridgeEvent = { seq: this.nextSeq, event, payload }
    this.nextSeq += 1
    this.ring.push(item)
    if (this.ring.length > BUFFER_SIZE) this.ring.shift()
    return item
  }

  /** Latest seq handed out, for a client's first subscribe. */
  head(): number {
    return this.nextSeq - 1
  }

  /**
   * Events after `since` (exclusive), or null when the client is too far
   * behind — the gap no longer lives in the buffer.
   */
  since(since: number): BridgeEvent[] | null {
    if (since >= this.nextSeq) return []
    if (since === 0) return []
    if (this.ring.length === 0) return since < this.nextSeq ? null : []
    const oldest = this.ring[0]!.seq
    if (since + 1 < oldest) return null
    return this.ring.filter(item => item.seq > since)
  }
}
