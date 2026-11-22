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
  /**
   * Called when the credential is refused (HTTP 401).
   *
   * A revoked device must not keep retrying forever: the phone clears the
   * token and asks the user to pair again.
   */
  onUnauthorized?: () => void
  /**
   * How long the stream may stay silent before it counts as dead.
   *
   * The bridge sends a heartbeat every 25s, so a silent stream for longer than
   * that means the tunnel is gone even though the socket looked open.
   */
  heartbeatTimeoutMs?: number
  /**
   * The bridge's ring buffer no longer reaches back to our `since`, so the gap
   * cannot be replayed. The app must reload the session snapshot; the
   * transport reconnects on its own and continues from the new head.
   *
   * Before this existed, `resync` closed the stream and returned from the
   * connect loop — the phone stayed dead with a stale transcript and no way to
   * notice (20261117-mobile.md §2.5).
   */
  onResync?: () => void
}

/**
 * Only http(s) gateways are allowed.
 *
 * The request host always comes from the configured base URL — no request
 * target can move it — so validating the scheme is what keeps a mistyped
 * URL (`file:`, `data:`, `javascript:`) from turning the transport into an
 * arbitrary fetch sink. A malformed URL is reported, not thrown: the app
 * builds the transport during boot and must survive a bad setting.
 */
function validateGatewayBaseUrl(baseUrl: string): Error | null {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return new Error(`gateway base URL is not a valid URL: ${baseUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return new Error(`gateway base URL must be http(s): ${baseUrl}`)
  }
  return null
}

export class GatewayTransport implements Transport {
  private readonly baseUrl: string
  /** Set when the configured base URL is unusable (malformed or non-http scheme). */
  private readonly configError: Error | null
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
  private readonly onUnauthorized: (() => void) | undefined
  private readonly onResync: (() => void) | undefined
  private readonly heartbeatTimeoutMs: number
  /** When the last frame of any kind arrived; the liveness measure. */
  private lastSeenAt = 0
  /**
   * Bumped by `reconnectNow`.
   *
   * The connect loop compares it with the value it started with: a changed
   * value means somebody asked for a fresh attempt, so the loop skips the
   * backoff instead of making the user wait out a delay that no longer makes
   * sense.
   */
  private generation = 0

  constructor(options: GatewayTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.configError = validateGatewayBaseUrl(this.baseUrl)
    this.token = options.token
    this.maxBackoffMs = options.maxBackoffMs ?? 15_000
    // Never store the bare global: browsers implement `fetch` on Window, and
    // calling a detached reference (`this.fetchImpl(...)`) sets a foreign
    // receiver, which throws "Illegal invocation". The arrow keeps the call a
    // plain global one.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.onUnauthorized = options.onUnauthorized
    this.onResync = options.onResync
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 16_000
    void this.connect()
  }

  /** Build a request URL from the configured base; the path is fixed by us. */
  private url(path: string): string {
    let url: URL
    try {
      url = new URL(`${this.baseUrl}${path}`)
    } catch (e) {
      throw new Error(`gateway URL is not valid: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`gateway URL scheme is not allowed: ${url.protocol}`)
    }
    return url.toString()
  }

  async invoke<T = unknown>(command: string, payload?: unknown): Promise<T> {
    if (this.configError) throw this.configError
    const response = await this.fetchImpl(this.url(`/cmd/${encodeURIComponent(command)}`), {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    })
    if (response.status === 401) {
      // The credential was refused: the device may have been revoked.
      this.onUnauthorized?.()
      throw new Error('unauthorized')
    }
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

  /**
   * Reconnects right away instead of waiting out the backoff.
   *
   * The phone calls this when it comes back to the foreground: the radio was
   * off, the tunnel is certainly gone, and waiting out a backoff would leave
   * the user staring at a disconnected screen.
   */
  reconnectNow(): void {
    if (this.stopped) return
    this.generation += 1
    this.abort?.abort()
    this.attempt = 0
    this.setStateInternal('connecting')
    // Start the new attempt right away instead of waiting for the old loop to
    // notice the abort: the old reader may never wake up.
    void this.connect()
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
      const generation = this.generation
      this.abort = new AbortController()
      this.setStateInternal(this.stateValue === 'open' ? 'open' : 'connecting')
      try {
        const url = this.url(`/events?since=${this.lastSeq}`)
        const response = await this.fetchImpl(url, {
          headers: { authorization: `Bearer ${this.token}`, accept: 'text/event-stream' },
          signal: this.abort.signal,
        })
        if (response.status === 401) {
          // The device was revoked: stop retrying and let the app re-pair.
          this.onUnauthorized?.()
          this.setStateInternal('closed')
          return
        }
        if (!response.ok || !response.body) throw new Error(`events http_${response.status}`)
        this.attempt = 0
        this.lastSeenAt = Date.now()
        this.setStateInternal('open')

        // React Native's Hermes has no TextDecoderStream, so decode by hand
        // when it is missing rather than assuming the browser platform.
        const reader = typeof TextDecoderStream === 'undefined'
          ? null
          : response.body.pipeThrough(new TextDecoderStream()).getReader()
        const rawReader = reader ? null : response.body.getReader()
        const decoder = new TextDecoder()
        let bufferText = ''
        try {
          while (true) {
            // A stream that has been silent past the heartbeat window is dead
            // even though the socket never closed: mobile networks drop idle
            // connections without a FIN.
            if (Date.now() - this.lastSeenAt > this.heartbeatTimeoutMs) {
              throw new Error('heartbeat timeout')
            }
            let done: boolean
            let value: string | undefined
            if (reader) {
              const next = await reader.read()
              done = next.done
              value = next.value
            } else {
              const next = await rawReader!.read()
              done = next.done
              value = next.value ? decoder.decode(next.value, { stream: true }) : ''
            }
            if (done) break
            bufferText += value ?? ''
            let boundary: number
            while ((boundary = bufferText.indexOf('\n\n')) !== -1) {
              const raw = bufferText.slice(0, boundary)
              bufferText = bufferText.slice(boundary + 2)
              const frame = this.parseFrame(raw)
              // Any frame proves the link is alive; the heartbeat is one of them.
              this.lastSeenAt = Date.now()
              if (!frame) continue
              if (frame.event === 'ping') {
                // The bridge's keepalive: proof of life, not business.
                continue
              }
              if (frame.event === 'hello') {
                // The hello frame names the buffer head; a `resync` event (not
                // a flag) is what asks the client to reload the session.
                continue
              }
              if (frame.event === 'resync') {
                // The server cannot replay the gap. Ask the app for a fresh
                // snapshot, then start over from the new head instead of
                // abandoning the stream: a dead phone that never reconnects is
                // worse than a reload.
                this.onResync?.()
                this.lastSeq = 0
                this.setStateInternal('connecting')
                this.abort.abort()
                break
              }
              const seq = frame.id ? Number(frame.id) : null
              if (seq !== null && Number.isFinite(seq)) this.lastSeq = Math.max(this.lastSeq, seq)
              this.deliver(frame.event, frame.data)
            }
          }
        } finally {
          if (reader) reader.releaseLock()
          else rawReader?.releaseLock()
        }
      } catch {
        // fall through to backoff
      }
      if (this.stopped) return
      // A newer attempt took over: this loop hands the connection over and
      // stops. Waiting for the old reader to notice the abort is not safe —
      // a stream that never yields never notices.
      if (this.generation !== generation) return
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
