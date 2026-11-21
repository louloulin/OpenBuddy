/**
 * Multiplexes HTTP and WebSocket traffic over the outbound WebSockets that
 * desktop agents keep open to the gateway. This is what lets a desktop behind
 * NAT serve a phone without any inbound port or third-party tunnel.
 *
 * A gateway can now hold more than one agent: every enrolled desktop dials in
 * with its own credential, and each phone routes to exactly the desktop it was
 * paired with. `LEGACY_ROUTE` is the pre-account slot, so an operator running
 * the old shared `GATEWAY_AGENT_TOKEN` keeps working.
 */

export const LEGACY_ROUTE = 'legacy'

export type AgentSocket = {
  /**
   * Writes one frame. Returns the runtime's verdict: `0`/`false` means the
   * frame was **dropped** (send buffer full, socket closing), not queued.
   * A runtime that returns nothing is assumed to have accepted it.
   */
  send(data: string): void | number | boolean
  close(code?: number, reason?: string): void
  /**
   * Bytes queued in the kernel for this socket, when the runtime can report it.
   *
   * One tunnel socket carries every phone's traffic for this desktop. When a
   * slow consumer (or a burst of heartbeats) fills the buffer, `send` keeps
   * accepting frames that then sit in memory: the caller sees success, the
   * phone sees a timeout 30 seconds later. Knowing the number lets the hub
   * refuse work instead of pretending it was delivered.
   */
  bufferedAmount?: () => number
}

export type TunnelHttpRequest = {
  method: string
  path: string
  headers: Record<string, string>
  body?: Uint8Array
}

export type TunnelWsHandlers = {
  onOpen?: () => void
  onMessage: (data: string | Uint8Array) => void
  onClose?: (code?: number, reason?: string) => void
}

type PendingHttp = {
  route: string
  controller: ReadableStreamDefaultController<Uint8Array>
  resolveHead: (head: { status: number; headers: Headers }) => void
  rejectHead: (error: Error) => void
  headSent: boolean
  /** The agent gzipped the whole body; it is inflated before the client sees it. */
  compressed: boolean
  compressedChunks: Uint8Array[]
  /** Compressed bytes buffered so far, against the tunnel budget below. */
  bufferedBytes: number
  timer: ReturnType<typeof setTimeout>
}

/**
 * The desktop's tunnel is carrying more than it can deliver right now.
 *
 * Distinct from "offline": the agent is connected, so a retry may work as soon
 * as the queue drains. The gateway maps it to 503 rather than 502.
 */
export class TunnelBackpressureError extends Error {
  constructor(readonly route: string) {
    super('agent tunnel is backpressured')
  }
}

type WsBridge = {
  route: string
  send: (data: string | Uint8Array) => void
  handlers: TunnelWsHandlers
}

const HEAD_TIMEOUT_MS = 30_000

/**
 * How much may queue in one tunnel socket before the hub refuses new work.
 *
 * A healthy tunnel holds well under a megabyte; several megabytes means the
 * agent is not reading (a slow disk, a stalled body) and anything added now
 * would only wait out the head timeout. Failing fast turns a 30-second hang
 * into an immediate, retryable error.
 */
export const MAX_TUNNEL_BUFFER_BYTES = 4 * 1024 * 1024


/**
 * How long a response body may stay silent after its head arrived.
 *
 * The head timeout only covers the wait for the first byte; once headers are
 * through, a streaming body can legitimately pause — but *forever* is not a
 * pause. Without a body idle timer, an agent that dies mid-body leaves the
 * phone's request hung and the pending map entry resident until the route
 * disconnects. Every chunk restarts the clock; silence past this window fails
 * the stream instead.
 */
export const BODY_IDLE_TIMEOUT_MS = 120_000

/**
 * Compressed bytes this hub will buffer for one response before giving up.
 *
 * The agent gzips whole bodies and the hub inflates only at the end, so the
 * accumulator — not the client — pays for a body the agent never finishes. A
 * bound turns a runaway or hostile body into a failed request instead of
 * gateway memory.
 */
export const MAX_TUNNELLED_BODY_BYTES = 64 * 1024 * 1024

/** Overridable bounds; tests shrink them so stalls happen in real milliseconds. */
export type AgentHubLimits = {
  bodyIdleTimeoutMs?: number
  maxBodyBytes?: number
}

function encodeBody(value: Uint8Array | undefined): string | undefined {
  return value ? Buffer.from(value).toString('base64') : undefined
}

function decodeBody(value: unknown): Uint8Array | undefined {
  return typeof value === 'string' && value.length > 0 ? new Uint8Array(Buffer.from(value, 'base64')) : undefined
}

/** Inflates a body the agent compressed for the tunnel. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export class AgentHub {
  private readonly sockets = new Map<string, AgentSocket>()
  private readonly pendingHttp = new Map<string, PendingHttp>()
  private readonly pendingWs = new Map<string, WsBridge>()
  private readonly bodyIdleMs: number
  private readonly maxBodyBytes: number

  constructor(limits: AgentHubLimits = {}) {
    this.bodyIdleMs = limits.bodyIdleTimeoutMs ?? BODY_IDLE_TIMEOUT_MS
    this.maxBodyBytes = limits.maxBodyBytes ?? MAX_TUNNELLED_BODY_BYTES
  }

  /** True when any agent is connected, which is what the legacy contract means. */
  get connected(): boolean {
    return this.sockets.size > 0
  }

  /** True when the legacy shared-token agent is connected. */
  get legacyConnected(): boolean {
    return this.sockets.has(LEGACY_ROUTE)
  }

  isOnline(route: string): boolean {
    return this.sockets.has(route)
  }

  onlineRoutes(): string[] {
    return [...this.sockets.keys()]
  }

  attach(route: string, socket: AgentSocket): void {
    // One agent per route keeps routing deterministic; a reconnect replaces the
    // old socket instead of leaking a half-dead route. Other desktops are
    // untouched — that separation is the whole point of routing by id.
    const previous = this.sockets.get(route)
    if (previous && previous !== socket) {
      this.sockets.delete(route)
      previous.close(4000, 'replaced')
      // Work already handed to the old socket died with it: the replacement
      // never saw those frames, so they must fail now. Left alone, an HTTP
      // request would stall for its whole head timeout and a bridged
      // websocket would hang until this route disconnected again.
      this.failPending(route, new Error('agent reconnected'), 'agent reconnected')
    }
    this.sockets.set(route, socket)
    // Advertise what this hub can undo. An agent dialed into an older gateway
    // never hears this, so it keeps sending plain bodies instead of producing
    // frames that hub would hand to a client undecoded.
    this.sendQuietly(route, { t: 'hello', capabilities: ['gzip'] })
  }

  detach(route: string, socket: AgentSocket): void {
    if (this.sockets.get(route) !== socket) return
    this.sockets.delete(route)
    this.failPending(route, new Error('agent disconnected'), 'agent disconnected')
  }

  /**
   * Fails every in-flight request and bridged websocket of one route.
   *
   * Only that route's work fails; a second desktop's requests keep running.
   * Bridged clients are closed with a retryable 1011 so the phone reconnects
   * instead of waiting on a tunnel nobody is carrying anymore.
   */
  private failPending(route: string, error: Error, reason: string): void {
    for (const [id, pending] of this.pendingHttp) {
      if (pending.route !== route) continue
      clearTimeout(pending.timer)
      if (pending.headSent) pending.controller.error(error)
      else pending.rejectHead(error)
      this.pendingHttp.delete(id)
    }
    for (const [id, bridge] of this.pendingWs) {
      if (bridge.route !== route) continue
      bridge.handlers.onClose?.(1011, reason)
      this.pendingWs.delete(id)
    }
  }

  async requestHttp(route: string, request: TunnelHttpRequest, signal?: AbortSignal): Promise<Response> {
    const socket = this.sockets.get(route)
    if (!socket) throw new Error('agent not connected')
    // The tunnel already has more queued than it can drain: adding this
    // request would only make the phone wait out the head timeout. Fail now,
    // with an error the gateway turns into a retryable 503.
    if (this.tunnelSaturated(route)) throw new TunnelBackpressureError(route)
    const id = crypto.randomUUID()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
      cancel: () => {
        const pending = this.pendingHttp.get(id)
        if (pending) clearTimeout(pending.timer)
        this.pendingHttp.delete(id)
        this.sendQuietly(route, { t: 'http_abort', id })
      },
    })

    const head = new Promise<{ status: number; headers: Headers }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingHttp.delete(id)
        this.sendQuietly(route, { t: 'http_abort', id })
        reject(new Error('agent response timed out'))
      }, HEAD_TIMEOUT_MS)
      this.pendingHttp.set(id, {
        route,
        controller,
        resolveHead: resolve,
        rejectHead: reject,
        headSent: false,
        compressed: false,
        compressedChunks: [],
        bufferedBytes: 0,
        timer,
      })
    })

    const sent = this.writeFrame(route, {
      t: 'http_req',
      id,
      method: request.method,
      path: request.path,
      headers: request.headers,
      body: encodeBody(request.body),
    })
    if (!sent) {
      // The frame never left the gateway. Waiting out the head timeout would
      // report a 502 thirty seconds later; failing now tells the phone to
      // retry while the queue is still short.
      clearTimeout((this.pendingHttp.get(id) as PendingHttp | undefined)?.timer)
      this.pendingHttp.delete(id)
      throw new TunnelBackpressureError(route)
    }

    const onAbort = () => {
      const pending = this.pendingHttp.get(id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pendingHttp.delete(id)
      this.sendQuietly(route, { t: 'http_abort', id })
      pending.controller.error(new DOMException('aborted', 'AbortError'))
      pending.rejectHead(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      const { status, headers } = await head
      return new Response(stream, { status, headers })
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  openWs(route: string, path: string, headers: Record<string, string>, handlers: TunnelWsHandlers): {
    send: (data: string | Uint8Array) => void
    close: (code?: number, reason?: string) => void
  } {
    if (!this.sockets.has(route)) throw new Error('agent not connected')
    const id = crypto.randomUUID()
    const bridge: WsBridge = {
      route,
      handlers,
      send: (data) => {
        this.sendQuietly(route, {
          t: 'ws_msg',
          id,
          ...(typeof data === 'string' ? { text: data } : { b64: Buffer.from(data).toString('base64') }),
        })
      },
    }
    this.pendingWs.set(id, bridge)
    this.sendQuietly(route, { t: 'ws_open', id, path, headers })
    return {
      send: bridge.send,
      close: (code, reason) => {
        this.pendingWs.delete(id)
        this.sendQuietly(route, { t: 'ws_close', id, code, reason })
      },
    }
  }

  /**
   * Rearms the per-request clock for the next body frame.
   *
   * The head timer dies the moment headers arrive; from then on every chunk
   * buys another idle window. A request whose agent falls silent mid-body
   * therefore fails instead of hanging the client and the map entry forever.
   */
  private armBodyTimer(id: string, pending: PendingHttp): void {
    clearTimeout(pending.timer)
    pending.timer = setTimeout(() => this.stallHttp(id, pending), this.bodyIdleMs)
  }

  /** The agent went silent past the idle window: fail the stream, free the entry. */
  private stallHttp(id: string, pending: PendingHttp): void {
    if (this.pendingHttp.get(id) !== pending) return
    clearTimeout(pending.timer)
    this.pendingHttp.delete(id)
    this.sendQuietly(pending.route, { t: 'http_abort', id })
    if (pending.headSent) {
      pending.controller.error(new Error('agent response stalled mid-body'))
    } else {
      pending.rejectHead(new Error('agent response stalled mid-body'))
    }
  }

  /** Frame dispatch, scoped to the route the frame arrived on. */
  receive(route: string, raw: string): void {
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    const id = typeof frame.id === 'string' ? frame.id : ''
    switch (frame.t) {
      case 'http_head': {
        const pending = this.pendingHttp.get(id)
        if (!pending || pending.route !== route || pending.headSent) return
        clearTimeout(pending.timer)
        pending.headSent = true
        const headers = new Headers()
        if (frame.headers && typeof frame.headers === 'object') {
          for (const [name, value] of Object.entries(frame.headers as Record<string, unknown>)) {
            if (typeof value === 'string') headers.set(name, value)
          }
        }
        // The agent already read the decoded body; framing headers no longer apply.
        headers.delete('content-length')
        headers.delete('transfer-encoding')
        // The tunnel encoding is between the agent and this hub only: the body
        // is inflated below, so the client must never be told it is gzipped.
        headers.delete('content-encoding')
        pending.compressed = frame.encoding === 'gzip'
        this.armBodyTimer(id, pending)
        pending.resolveHead({ status: Number(frame.status) || 502, headers })
        return
      }
      case 'http_chunk': {
        const pending = this.pendingHttp.get(id)
        const chunk = decodeBody(frame.data)
        if (!pending || pending.route !== route || !chunk) return
        this.armBodyTimer(id, pending)
        if (pending.compressed) {
          pending.bufferedBytes += chunk.byteLength
          if (pending.bufferedBytes > this.maxBodyBytes) {
            this.stallHttp(id, pending)
            return
          }
          pending.compressedChunks.push(chunk)
        } else {
          pending.controller.enqueue(chunk)
        }
        return
      }
      case 'http_end': {
        const pending = this.pendingHttp.get(id)
        if (!pending || pending.route !== route) return
        clearTimeout(pending.timer)
        this.pendingHttp.delete(id)
        if (!pending.headSent) {
          pending.rejectHead(new Error('agent ended without a response'))
          return
        }
        if (pending.compressed) {
          const joined = new Uint8Array(pending.compressedChunks.reduce((total, chunk) => total + chunk.byteLength, 0))
          let offset = 0
          for (const chunk of pending.compressedChunks) { joined.set(chunk, offset); offset += chunk.byteLength }
          pending.compressedChunks = []
          void inflate(joined).then(
            bytes => { pending.controller.enqueue(bytes); pending.controller.close() },
            error => pending.controller.error(error),
          )
          return
        }
        pending.controller.close()
        return
      }
      case 'http_error': {
        const pending = this.pendingHttp.get(id)
        if (!pending || pending.route !== route) return
        clearTimeout(pending.timer)
        this.pendingHttp.delete(id)
        const error = new Error(typeof frame.message === 'string' ? frame.message : 'agent request failed')
        if (pending.headSent) pending.controller.error(error)
        else pending.rejectHead(error)
        return
      }
      case 'ws_opened': {
        const bridge = this.pendingWs.get(id)
        if (bridge?.route === route) bridge.handlers.onOpen?.()
        return
      }
      case 'ws_open_error': {
        const bridge = this.pendingWs.get(id)
        if (!bridge || bridge.route !== route) return
        this.pendingWs.delete(id)
        bridge.handlers.onClose?.(1011, typeof frame.message === 'string' ? frame.message : 'open failed')
        return
      }
      case 'ws_msg': {
        const bridge = this.pendingWs.get(id)
        if (!bridge || bridge.route !== route) return
        if (typeof frame.text === 'string') bridge.handlers.onMessage(frame.text)
        else {
          const bytes = decodeBody(frame.b64)
          if (bytes) bridge.handlers.onMessage(bytes)
        }
        return
      }
      case 'ws_close': {
        const bridge = this.pendingWs.get(id)
        if (!bridge || bridge.route !== route) return
        this.pendingWs.delete(id)
        bridge.handlers.onClose?.(
          typeof frame.code === 'number' ? frame.code : undefined,
          typeof frame.reason === 'string' ? frame.reason : undefined,
        )
        return
      }
      default:
        return
    }
  }

  closeAll(): void {
    for (const socket of this.sockets.values()) {
      try {
        socket.close(1001, 'gateway shutting down')
      } catch {
        // already closed
      }
    }
    this.sockets.clear()
  }

  /**
   * True when this route's socket has more queued than the tunnel may hold.
   *
   * A runtime that cannot report its buffer (or an older agent) is treated as
   * healthy: refusing work on a guess would be worse than trying.
   */
  private tunnelSaturated(route: string): boolean {
    const socket = this.sockets.get(route)
    const queued = socket?.bufferedAmount?.()
    return typeof queued === 'number' && queued > MAX_TUNNEL_BUFFER_BYTES
  }

  private sendQuietly(route: string, frame: Record<string, unknown>): void {
    this.writeFrame(route, frame)
  }

  /**
   * Writes a frame and reports whether the runtime accepted it.
   *
   * Bun's `send` returns 0 when the frame is dropped because the peer is not
   * reading fast enough. Ignoring that return value is what turned a burst
   * into a mystery: the hub believed it had handed a request to the desktop,
   * nothing arrived, and the phone learned about it 30 seconds later as a
   * 502. The verdict is returned so callers can fail fast instead.
   */
  private writeFrame(route: string, frame: Record<string, unknown>): boolean {
    const socket = this.sockets.get(route)
    if (!socket) return false
    try {
      const verdict = socket.send(JSON.stringify(frame))
      // `undefined` (runtimes without a verdict) counts as accepted.
      return verdict === undefined || verdict === 1 || verdict === true
    } catch {
      // The socket went away between the lookup and the write.
      return false
    }
  }
}
