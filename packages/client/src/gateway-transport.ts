/**
 * GatewayTransport (20261115-mobile.md §4.2): the `Transport` contract over a
 * gateway HTTPS/SSE link, for phone-shaped hosts that have no Electron bridge.
 *
 * Mapping:
 *   invoke(command, payload) → POST {baseUrl}/cmd/:command        (JSON reply)
 *   listen(event, handler)   → GET  {baseUrl}/events?since=<seq>  (SSE, id: = seq)
 *   state/onState            → SSE connection lifecycle
 *
 * Reconnect: the SSE reader retries with exponential backoff and replays from
 * the last seen seq, so no turn is lost across a drop. A `resync` frame means
 * the buffer gap was too old; the transport closes with an error the app can
 * turn into a session reload.
 *
 * No Node or Electron APIs — Web standards only, so it runs in a browser,
 * Capacitor WebView, or Bun.
 */

import type { Transport, TransportState, UnlistenFn } from './transport'

export type GatewayTransportOptions = {
  /** Bridge base URL, e.g. https://gw.example.com (paths /cmd, /events appended). */
  baseUrl: string
  /** Bridge bearer token (the gateway injects it on the desktop hop). */
  token: string
  /** Reconnect backoff ceiling; default 15s. */
  maxBackoffMs?: number
  /** Injected fetch (tests); defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch
}

type StreamHandle = { controller: ReadableStreamDefaultController<string> }

export class GatewayTransport implements Transport {
  private readonly baseUrl: string
  private readonly token: string
  private readonly maxBackoffMs: number
  private readonly fetchImpl: typeof fetch

  private stateValue: TransportState = 'connecting'
  private readonly stateListeners = new Set<(state: TransportState) => void>()

  private readonly eventListeners = new Map<string, Set<(payload: unknown) => void>>()
  /** Events that arrived before any listener; flushed on the first subscribe. */
  private readonly earlyEvents: { event: string; payload: unknown }[] = []

  private lastSeq = 0
  private abort: AbortController | null = null
  private stopped = false
  private attempt = 0
  private stream: StreamHandle | null = null

  constructor(options: GatewayTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
    this.maxBackoffMs = options.maxBackoffMs ?? 15_000
    this.fetchImpl = options.fetchImpl ?? fetch
    void this.connect()
  }

  async invoke<T = unknown>(command: string, payload?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/cmd/${encodeURIComponent(command)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    })
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; error?: string }
    if (!response.ok || body.error) throw new Error(body.error ?? `http_${response.status}`)
    return body.result as T
  }

  async listen<T = unknown>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
    let set = this.eventListeners.get(event)
    if (!set) {
      set = new Set()
      this.eventListeners.set(event, set)
    }
    const wrapped = handler as (payload: unknown) => void
    set.add(wrapped)
    // Deliver anything that arrived before this subscription (the wire-up in
    // api/events.ts subscribes several events in sequence).
    for (let index = this.earlyEvents.length - 1; index >= 0; index -= 1) {
      const item = this.earlyEvents[index]!
      if (item.event === event) wrapped(item.payload)
    }
    return () => {
      const current = this.eventListeners.get(event)
      if (!current) return
      current.delete(wrapped)
      if (current.size === 0) this.eventListeners.delete(event)
    }
  }

  state(): TransportState {
    return this.stateValue
  }

  onState(listener: (state: TransportState) => void): UnlistenFn {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  /** Stops the stream and timers; the transport is done. */
  close(): void {
    this.stopped = true
    this.abort?.abort()
    this.setState('closed')
  }

  private setState(state: TransportState): void {
    if (state === this.stateValue) return
    this.stateValue = state
    for (const listener of [...this.stateListeners]) listener(state)
  }

  private setStateInternal(state: TransportState): void {
    this.setState(state)
  }

  private async connect(): Promise<void> {
    while (!this.stopped) {
      this.abort = new AbortController()
      this.setStateInternal(this.stateValue === 'open' ? 'open' : 'connecting')
      try {
        const url = `${this.baseUrl}/events?since=${this.lastSeq}`
        const response = await this.fetchImpl(url, {
          headers: { authorization: `Bearer ${this.token}`, accept: 'text/event-stream' },
          signal: this.abort.signal,
        })
        if (!response.ok || !response.body) throw new Error(`events http_${response.status}`)
        this.attempt = 0
        this.setStateInternal('open')

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let bufferText = ''
        let resync = false
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            bufferText += value
            let boundary: number
            while ((boundary = bufferText.indexOf('\n\n')) !== -1) {
              const raw = bufferText.slice(0, boundary)
              bufferText = bufferText.slice(boundary + 2)
              const frame = this.parseFrame(raw)
              if (!frame) continue
              if (frame.event === 'hello') {
                const hello = JSON.parse(frame.data) as { head: number; resync: boolean }
                if (!frame.id && hello.resync) resync = true
                continue
              }
              if (frame.event === 'resync') {
                // The server cannot replay: the app must reload the session.
                this.setStateInternal('closed')
                this.abort.abort()
                return
              }
              const seq = frame.id ? Number(frame.id) : null
              if (seq !== null && Number.isFinite(seq)) this.lastSeq = Math.max(this.lastSeq, seq)
              this.deliver(frame.event, frame.data)
            }
          }
        } finally {
          reader.releaseLock()
        }
      } catch {
        // fall through to backoff
      }
      if (this.stopped) return
      this.setStateInternal('connecting')
      this.attempt += 1
      const delay = Math.min(this.maxBackoffMs, 500 * 2 ** Math.min(this.attempt, 5))
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  private parseFrame(raw: string): { event: string; id?: string; data: string } | null {
    let event = 'message'
    let id: string | undefined
    let data = ''
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('id:')) id = line.slice(3).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (!data) return null
    return { event, id, data }
  }

  private deliver(event: string, data: string): void {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      payload = data
    }
    const set = this.eventListeners.get(event)
    if (!set || set.size === 0) {
      this.earlyEvents.push({ event, payload })
      if (this.earlyEvents.length > 256) this.earlyEvents.shift()
      return
    }
    for (const handler of [...set]) handler(payload)
  }
}
