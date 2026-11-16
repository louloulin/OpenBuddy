/**
 * WsBridgeTransport (20261115-mobile.md §3.2, phase 2.4): the same `Transport`
 * contract over one multiplexed WebSocket (`openbuddy/bridge/1`).
 *
 * Why it exists: a phone on a mobile network pays for every connection in
 * battery and handshake time. SSE works (and stays the default for H5), but a
 * single socket carries both commands and events, with a heartbeat the app can
 * tune. Frames are JSON:
 *
 *   → { t: "cmd",   id, command, payload }
 *   → { t: "ping" }
 *   ← { t: "hello", head, resync } / { t: "resync", head }
 *   ← { t: "reply", id, ok, result | error }
 *   ← { t: "evt",   event, seq, payload }
 *   ← { t: "pong" }
 *
 * Web standards only (global `WebSocket`), so the same class runs in a browser,
 * React Native and Bun.
 */

import type { Transport, TransportState, UnlistenFn } from './transport'

export type WsBridgeTransportOptions = {
  /** Bridge base URL, e.g. https://gw.example.com/api (socket path appended). */
  baseUrl: string
  token: string
  /** Reconnect backoff ceiling; default 15s. */
  maxBackoffMs?: number
  /** Heartbeat interval; default 25s (weak networks: 15s). */
  heartbeatMs?: number
  /** Injected for tests. */
  socketFactory?: (url: string) => WebSocket
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const COMMAND_TIMEOUT_MS = 30_000

export class WsBridgeTransport implements Transport {
  private readonly socketUrl: string
  private readonly maxBackoffMs: number
  private readonly heartbeatMs: number
  private readonly socketFactory: (url: string) => WebSocket

  private socket: WebSocket | null = null
  private stateValue: TransportState = 'connecting'
  private readonly stateListeners = new Set<(state: TransportState) => void>()
  private readonly eventListeners = new Map<string, Set<(payload: unknown) => void>>()
  private readonly earlyEvents: { event: string; payload: unknown }[] = []
  private readonly pending = new Map<string, Pending>()

  private lastSeq = 0
  private stopped = false
  private attempt = 0
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private nextId = 1

  constructor(options: WsBridgeTransportOptions) {
    const base = options.baseUrl.replace(/\/+$/, '')
    const url = new URL(`${base}/ws`)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('token', options.token)
    if (this.lastSeq > 0) url.searchParams.set('since', String(this.lastSeq))
    this.socketUrl = url.toString()
    this.maxBackoffMs = options.maxBackoffMs ?? 15_000
    this.heartbeatMs = options.heartbeatMs ?? 25_000
    this.socketFactory = options.socketFactory ?? (target => new WebSocket(target))
    void this.connect()
  }

  invoke<T = unknown>(command: string, payload?: unknown): Promise<T> {
    if (!this.socket || this.stateValue !== 'open') {
      return Promise.reject(new Error(`bridge is ${this.stateValue}: ${command}`))
    }
    const id = String(this.nextId++)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`command timed out: ${command}`))
      }, COMMAND_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject,
        timer,
      })
      try {
        this.socket!.send(JSON.stringify({ t: 'cmd', id, command, payload: payload ?? {} }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async listen<T = unknown>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
    let set = this.eventListeners.get(event)
    if (!set) {
      set = new Set()
      this.eventListeners.set(event, set)
    }
    const wrapped = handler as (payload: unknown) => void
    set.add(wrapped)
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
    return () => { this.stateListeners.delete(listener) }
  }

  close(): void {
    this.stopped = true
    if (this.retry) clearTimeout(this.retry)
    this.stopHeartbeat()
    this.failPending(new Error('bridge closed'))
    try {
      this.socket?.close()
    } catch {
      // already closing
    }
    this.socket = null
    this.setState('closed')
  }

  private setState(state: TransportState): void {
    if (state === this.stateValue) return
    this.stateValue = state
    for (const listener of [...this.stateListeners]) listener(state)
  }

  private failPending(error: Error): void {
    for (const [id, item] of this.pending) {
      clearTimeout(item.timer)
      item.reject(error)
      this.pending.delete(id)
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => {
      try {
        this.socket?.send(JSON.stringify({ t: 'ping' }))
      } catch {
        // onclose owns the retry
      }
    }, this.heartbeatMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  private connect(): void {
    if (this.stopped) return
    // The socket URL carries the last seq, so a reconnect replays the gap.
    const url = new URL(this.socketUrl)
    if (this.lastSeq > 0) url.searchParams.set('since', String(this.lastSeq))
    this.setState(this.stateValue === 'open' ? 'open' : 'connecting')

    let socket: WebSocket
    try {
      socket = this.socketFactory(url.toString())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.attempt = 0
      this.setState('open')
      this.startHeartbeat()
    }
    socket.onmessage = event => {
      if (typeof event.data === 'string') this.handleFrame(event.data)
    }
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null
      this.stopHeartbeat()
      this.failPending(new Error('bridge disconnected'))
      if (this.stopped) return
      this.setState('connecting')
      this.scheduleReconnect()
    }
    socket.onerror = () => {
      // onclose carries the retry.
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retry) return
    this.attempt += 1
    const delay = Math.min(this.maxBackoffMs, 500 * 2 ** Math.min(this.attempt, 5))
    this.retry = setTimeout(() => {
      this.retry = null
      this.connect()
    }, delay)
  }

  private handleFrame(raw: string): void {
    let frame: {
      t?: string
      id?: string
      ok?: boolean
      result?: unknown
      error?: string
      event?: string
      seq?: number
      payload?: unknown
      head?: number
      resync?: boolean
    }
    try {
      frame = JSON.parse(raw)
    } catch {
      return
    }

    switch (frame.t) {
      case 'hello':
        // A hello with resync means the replay gap is too old; the app must
        // reload the session. Closing surfaces it through `state`.
        if (frame.resync) {
          this.setState('closed')
          this.stopped = true
          try { this.socket?.close() } catch { /* already closed */ }
        }
        return
      case 'resync':
        this.setState('closed')
        this.stopped = true
        try { this.socket?.close() } catch { /* already closed */ }
        return
      case 'pong':
        return
      case 'reply': {
        if (typeof frame.id !== 'string') return
        const item = this.pending.get(frame.id)
        if (!item) return
        clearTimeout(item.timer)
        this.pending.delete(frame.id)
        if (frame.ok) item.resolve(frame.result ?? null)
        else item.reject(new Error(frame.error ?? 'command failed'))
        return
      }
      case 'evt': {
        if (typeof frame.seq === 'number' && Number.isFinite(frame.seq)) {
          this.lastSeq = Math.max(this.lastSeq, frame.seq)
        }
        if (typeof frame.event !== 'string') return
        this.deliver(frame.event, frame.payload)
        return
      }
      default:
        return
    }
  }

  private deliver(event: string, payload: unknown): void {
    const set = this.eventListeners.get(event)
    if (!set || set.size === 0) {
      this.earlyEvents.push({ event, payload })
      if (this.earlyEvents.length > 256) this.earlyEvents.shift()
      return
    }
    for (const handler of [...set]) handler(payload)
  }
}
