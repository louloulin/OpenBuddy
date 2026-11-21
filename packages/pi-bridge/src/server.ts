/**
 * The bridge server (20261115-mobile.md §3.1): the OpenBuddy IPC contract over
 * HTTP + SSE, shaped so the gateway's existing HTTP tunnel forwards it
 * unchanged.
 *
 * Endpoints (all behind the gateway on the phone path; locally the loopback):
 *   POST /cmd/:command   validate → host handler → JSON reply
 *   GET  /events?since=  SSE stream of `agent://…` events, `id:` = seq
 *   GET  /capabilities   the host_capabilities answer for this surface
 *   GET  /health         readiness
 *
 * Every route answers both at the root and under `/api/…`: the gateway's HTTP
 * tunnel forwards the phone's path verbatim (its upstream owns `/api/*`
 * itself), so the bridge serves the same surface under both prefixes.
 *
 * Auth: local deployments use the shared bridge token the gateway's agent
 * injects as the upstream bearer (`localAccessToken` in agentCore); every
 * request must carry it. The desktop binds to 127.0.0.1.
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import { isCommand, type CommandName } from '@openbuddy/protocol/commands'
import { validateCommandPayload, type Payload } from '@openbuddy/protocol/validate'
import { EVENTS, isEvent, type EventName } from '@openbuddy/protocol/events'

import { EventBuffer, type BridgeEvent } from './event-buffer.js'
import { createLiveStatusTracker } from './live-status.js'
import { isAllowedCommand, mobileCapabilities } from './scopes.js'

export type HostDispatcher = {
  /** Runs one host-module handler; same dispatch ipcMain.handle uses. */
  dispatch: (command: string, payload: Payload) => unknown | Promise<unknown>
  /** Subscribes to engine events; returns the unlisten function. */
  listen: (handler: (event: string, payload: unknown) => void) => () => void
  /** Commands this surface serves; the mobile host_capabilities answer. */
  servedCommands: () => readonly string[]
}

/**
 * How often an idle event stream says "still here".
 *
 * Two clocks have to be satisfied: a reverse proxy closes an idle response
 * after roughly a minute (nginx 60s, Cloudflare 100s), and Bun's own server
 * drops an idle response after 10 seconds unless it is told otherwise. Five
 * seconds is comfortably inside both, and it gives the phone a frame it can
 * measure liveness against.
 */
export const HEARTBEAT_INTERVAL_MS = 5_000

/** Image types the upload route accepts, mapped to the stored extension. */
const UPLOAD_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

export type UploadSink = {
  /** Refuse bodies larger than this. */
  maxBytes: number
  /** Persists the bytes and returns the absolute path to send as an attachment. */
  save: (bytes: Uint8Array, extension: string) => Promise<{ path: string }>
}

export type BridgeServerOptions = {
  /** Bearer token required on every request; the gateway agent supplies it. */
  token: string
  /** True (tests) disables the token check. */
  noAuth?: boolean
  /**
   * Camera uploads. Absent means the route answers 404 — a desktop without a
   * temp directory to write to simply does not offer image attachments.
   */
  uploads?: UploadSink
  /**
   * How often an idle event stream says "still here". Defaults to 5s; tests
   * use a much shorter value so the frame arrives within the test's patience.
   */
  heartbeatIntervalMs?: number
}

/** Minimal Bun socket surface the bridge needs (kept structural for tests). */
export type BridgeSocket = {
  data: { since?: number }
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
}

export type BridgeServer = {
  app: Hono
  /**
   * Bun fetch handler. Handles the `GET /ws` upgrade itself and delegates
   * everything else to `app`; hosting code passes it to `Bun.serve` together
   * with `websocket`.
   */
  fetch: (req: Request, server?: unknown) => Response | undefined | Promise<Response | undefined>
  /** Bun socket handlers; pass to `Bun.serve({ websocket })`. */
  websocket: {
    open: (socket: BridgeSocket) => void
    message: (socket: BridgeSocket, message: string | ArrayBuffer | Uint8Array) => void
    close: (socket: BridgeSocket) => void
  }
  /** Feeds one engine event into the buffer; the desktop wiring calls this. */
  emit: (event: string, payload: unknown) => void
  close: () => void
}

export function createBridgeServer(dispatcher: HostDispatcher, options: BridgeServerOptions): BridgeServer {
  const buffer = new EventBuffer()
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
  // Only commands this desktop actually serves AND the mobile surface allows.
  const allowed = new Set(
    dispatcher.servedCommands().filter(command => isAllowedCommand(command) && isCommand(command)),
  )
  const events = EVENTS.filter((event): event is EventName => isEvent(event))
  /** Live subscribers of the SSE tail; each holds its own queue. */
  const streams = new Set<(item: BridgeEvent) => void>()
  /**
   * What the gateway's push watcher polls. Fed from the same event stream the
   * phone subscribes to — the bridge never reads the engine directly.
   */
  const liveStatus = createLiveStatusTracker()

  const authorized = (header: string | null): boolean =>
    options.noAuth || header === `Bearer ${options.token}`

  /**
   * `host_capabilities` must describe *this surface*, not the desktop's.
   *
   * Asking the desktop would answer with `window_*`, file writes and MCP
   * management; the web/mobile FeatureRegistry would then render buttons the
   * bridge immediately refuses. The mobile answer is the filtered set the
   * bridge actually serves.
   */
  const runCommand = (command: string, payload: Payload): unknown | Promise<unknown> =>
    command === 'host_capabilities'
      ? mobileCapabilities([...allowed], events)
      : dispatcher.dispatch(command, payload)

  const app = new Hono()

  app.on(['GET', 'POST'], ['/health', '/api/health'], (c) => c.json({ ok: true, commands: allowed.size }))

  app.on('GET', ['/capabilities', '/api/capabilities'], (c) => {
    if (!authorized((c.req.header('authorization') ?? null))) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    return c.json({
      platform: 'mobile-host',
      commands: [...allowed],
      events,
    })
  })

  app.on('POST', ['/cmd/:command', '/api/cmd/:command'], async (c) => {
    if (!authorized((c.req.header('authorization') ?? null))) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const command = c.req.param('command')
    if (!allowed.has(command)) {
      return c.json({ error: `not_implemented: ${String(command).slice(0, 128)}` }, 404)
    }
    let input: unknown
    try {
      input = await c.req.json()
    } catch {
      input = {}
    }
    let payload: Payload
    try {
      payload = validateCommandPayload(command as CommandName, input)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'invalid_payload' }, 400)
    }
    try {
      const result = await runCommand(command, payload)
      return c.json({ ok: true, result: result ?? null })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  })

  /**
   * Camera images (20261115-mobile.md §5.6).
   *
   * `validate.ts` forbids image bytes on `agent_send`; the contract only takes
   * `attachments: [{ path }]`, and a phone has no path on the desktop's disk.
   * So the phone PUTs the bytes here and sends back the path it gets.
   *
   * The bytes never reach a model directly: they land in a private temp
   * directory with a random name, and the caller still has to spend a turn
   * (`agent_send`) to use them, which is what the desktop's permission model
   * already governs.
   */
  app.on('POST', ['/upload', '/api/upload'], async (c) => {
    if (!authorized((c.req.header('authorization') ?? null))) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    if (!options.uploads) {
      return c.json({ error: 'uploads_disabled' }, 404)
    }
    const mime = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    const extension = UPLOAD_TYPES.get(mime)
    if (!extension) {
      return c.json({ error: 'unsupported_media_type', allowed: [...UPLOAD_TYPES.keys()] }, 415)
    }
    const declared = Number(c.req.header('content-length') ?? '')
    if (Number.isFinite(declared) && declared > options.uploads.maxBytes) {
      return c.json({ error: 'payload_too_large', maxBytes: options.uploads.maxBytes }, 413)
    }
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await c.req.arrayBuffer())
    } catch {
      return c.json({ error: 'unreadable_body' }, 400)
    }
    if (bytes.byteLength === 0) return c.json({ error: 'empty_body' }, 400)
    if (bytes.byteLength > options.uploads.maxBytes) {
      return c.json({ error: 'payload_too_large', maxBytes: options.uploads.maxBytes }, 413)
    }
    try {
      const written = await options.uploads.save(bytes, extension)
      return c.json({ path: written.path, bytes: bytes.byteLength })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'upload_failed' }, 500)
    }
  })

  /**
   * The gateway polls this to decide when to interrupt a phone
   * (`packages/gateway/src/push/watcher.ts`, `LIVE_STATUS_PATH`). Answering it
   * is what closes the loop: without it the watcher only ever sees 404 and no
   * push is ever sent.
   */
  app.on('GET', ['/sessions/live-status', '/api/sessions/live-status'], (c) => {
    if (!authorized(c.req.header('authorization') ?? null)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    return c.json(liveStatus.snapshot())
  })

  app.on('GET', ['/events', '/api/events'], (c) => {
    if (!authorized((c.req.header('authorization') ?? null))) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const sinceParam = c.req.query('since')
    const since = sinceParam !== undefined && sinceParam !== '' && /^\d+$/.test(sinceParam)
      ? Number(sinceParam)
      : 0
    const replay = buffer.since(since)
    // A gap means the client is too far behind; replaying nothing would
    // silently skip turns, so the stream tells it to resync instead.
    const resync = replay === null

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ head: buffer.head(), resync }) })
      if (resync) {
        await stream.writeSSE({ event: 'resync', data: JSON.stringify({ head: buffer.head() }) })
      }
      for (const item of resync ? [] : replay ?? []) {
        await stream.writeSSE({ id: String(item.seq), event: item.event, data: JSON.stringify(item.payload) })
      }

      // Live tail. The queue is the stream's own; the shared fan-out below
      // hands each buffered event to every connected stream in order.
      const queue: BridgeEvent[] = []
      const deliver = (item: BridgeEvent): void => { queue.push(item) }
      streams.add(deliver)
      // A quiet conversation must still look alive: every reverse proxy
      // closes an idle response after a minute or so, and a phone on a mobile
      // network loses the tunnel long before the user notices. A heartbeat
      // frame keeps the connection open *and* lets the client measure that the
      // link is still there (the transport treats a missing heartbeat as dead).
      let sincePing = 0
      try {
        while (true) {
          while (queue.length > 0) {
            const item = queue.shift()!
            await stream.writeSSE({ id: String(item.seq), event: item.event, data: JSON.stringify(item.payload) })
            sincePing = 0
          }
          if (sincePing >= heartbeatIntervalMs) {
            await stream.writeSSE({ event: 'ping', data: JSON.stringify({ t: Date.now() }) })
            sincePing = 0
          } else {
            sincePing += 50
          }
          await stream.sleep(50)
          if (c.req.raw.signal.aborted) break
        }
      } finally {
        streams.delete(deliver)
      }
    })
  })

  // ── WebSocket multiplex (openbuddy/bridge/1) ────────────────────────────
  //
  // One socket carries commands and the event tail: the phone cannot afford a
  // connection per session on a mobile network. Frames are JSON, one object per
  // message; `cmd`/`reply` correlate on `id`, `evt` carries the same monotonic
  // `seq` the SSE stream uses.

  const sendFrame = (socket: BridgeSocket, frame: unknown): void => {
    try {
      socket.send(JSON.stringify(frame))
    } catch {
      // The socket closed between the lookup and the write.
    }
  }

  const onSocketMessage = async (socket: BridgeSocket, raw: string | ArrayBuffer | Uint8Array): Promise<void> => {
    if (typeof raw !== 'string') {
      sendFrame(socket, { t: 'reply', id: '', ok: false, error: 'binary frames are not supported' })
      return
    }
    let frame: { t?: unknown; id?: unknown; command?: unknown; payload?: unknown }
    try {
      frame = JSON.parse(raw) as typeof frame
    } catch {
      sendFrame(socket, { t: 'reply', id: '', ok: false, error: 'bad_frame' })
      return
    }
    if (frame.t === 'ping') {
      sendFrame(socket, { t: 'pong' })
      return
    }
    if (frame.t !== 'cmd') return

    const id = typeof frame.id === 'string' ? frame.id : ''
    const command = String(frame.command ?? '')
    if (!allowed.has(command)) {
      sendFrame(socket, { t: 'reply', id, ok: false, error: `not_implemented: ${command.slice(0, 128)}` })
      return
    }
    let payload: Payload
    try {
      payload = validateCommandPayload(command as CommandName, frame.payload ?? {})
    } catch (error) {
      sendFrame(socket, { t: 'reply', id, ok: false, error: error instanceof Error ? error.message : 'invalid_payload' })
      return
    }
    try {
      const result = await runCommand(command, payload)
      sendFrame(socket, { t: 'reply', id, ok: true, result: result ?? null })
    } catch (error) {
      sendFrame(socket, { t: 'reply', id, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const onSocketOpen = (socket: BridgeSocket): void => {
    const since = typeof socket.data.since === 'number' && Number.isFinite(socket.data.since)
      ? socket.data.since
      : 0
    const replay = buffer.since(since)
    const resync = replay === null
    sendFrame(socket, { t: 'hello', head: buffer.head(), resync })
    if (resync) sendFrame(socket, { t: 'resync', head: buffer.head() })
    for (const item of resync ? [] : replay ?? []) {
      sendFrame(socket, { t: 'evt', event: item.event, seq: item.seq, payload: item.payload })
    }

    // Subscribe after the replay, in the same tick as the replay snapshot, so
    // no event falls between them (the buffer is synchronous).
    const deliver = (item: BridgeEvent): void => {
      sendFrame(socket, { t: 'evt', event: item.event, seq: item.seq, payload: item.payload })
    }
    streams.add(deliver)
    ;(socket.data as { deliver?: (item: BridgeEvent) => void }).deliver = deliver
  }

  const onSocketClose = (socket: BridgeSocket): void => {
    const deliver = (socket.data as { deliver?: (item: BridgeEvent) => void }).deliver
    if (deliver) streams.delete(deliver)
  }

  /**
   * Bun fetch entry point: upgrades `/ws` and `/api/ws`, and otherwise serves
   * the HTTP app unchanged. Hosting code must pass the second `server`
   * argument to `Bun.serve`'s fetch for the upgrade to be possible.
   */
  const fetchHandler: BridgeServer['fetch'] = (req, server) => {
    const url = new URL(req.url)
    if (url.pathname !== '/ws' && url.pathname !== '/api/ws') return app.fetch(req)

    const tokenFromQuery = url.searchParams.get('token')
    const header = req.headers.get('authorization')
    if (!options.noAuth && header !== `Bearer ${options.token}` && tokenFromQuery !== options.token) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }
    const upgradable = server as { upgrade?: (req: Request, opts: { data: { since: number } }) => boolean } | undefined
    if (!upgradable?.upgrade) {
      return new Response(JSON.stringify({ error: 'websocket_unsupported' }), {
        status: 426,
        headers: { 'content-type': 'application/json' },
      })
    }
    const since = Number(url.searchParams.get('since') ?? '')
    const ok = upgradable.upgrade(req, { data: { since: Number.isFinite(since) ? since : 0 } })
    // Bun expects `undefined` once it owns the socket.
    return ok ? undefined : new Response(JSON.stringify({ error: 'upgrade_failed' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  // Every engine event lands in the buffer exactly once, then fans out to the
  // connected SSE streams and sockets.
  const offEngine = dispatcher.listen((event, payload) => {
    liveStatus.observe(event, payload)
    const item = buffer.push(event, payload)
    for (const deliver of streams) deliver(item)
  })

  return {
    app,
    fetch: fetchHandler,
    websocket: {
      open: onSocketOpen,
      message: (socket, message) => { void onSocketMessage(socket, message) },
      close: onSocketClose,
    },
    emit: (event, payload) => {
      liveStatus.observe(event, payload)
      const item = buffer.push(event, payload)
      for (const deliver of streams) deliver(item)
    },
    close: () => {
      offEngine()
      streams.clear()
    },
  }
}

/** Scope of one command, exported for tests and the desktop's UI gating. */
export { scopeForCommand, isAllowedCommand } from './scopes.js'
