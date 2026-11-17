/**
 * The desktop-side agent, with no runtime-specific assumptions.
 *
 * It dials the gateway over one outbound WebSocket and serves the local
 * lumos server through it. Two things make this usable outside Bun's own
 * CLI entry:
 *
 * - Authentication rides the `Sec-WebSocket-Protocol` header by default,
 *   because a URL outlives the request that carried it (access logs, shell
 *   history) and a Node/Electron `WebSocket` ignores a `headers` option. The
 *   gateway echoes the protocol back, which undici requires: a client that
 *   asked for a protocol and did not get it selected fails with 1006. A
 *   gateway older than subprotocol auth closes the dial with 4401; the agent
 *   then falls back to the deprecated `?token=` query for the rest of its
 *   life.
 * - The local server address is read on every request instead of captured at
 *   construction, because the desktop's sidecar can restart on another port.
 *
 * `agent.ts` is the CLI wrapper around this; the Electron main process embeds
 * it directly.
 */

type Frame = Record<string, unknown>

/** How many frames may wait for a local socket to finish its handshake. */
const MAX_QUEUED_FRAMES = 512

/**
 * Bodies worth compressing before they cross the tunnel.
 *
 * Every chunk is base64 in a JSON frame, so a JSON response travels at roughly
 * 4/3 its size and is highly repetitive: a 500 KB history page gzips to ~80 KB
 * on the wire. SSE is excluded on purpose — compressing it would hold frames in
 * the gzip window and the phone would stop seeing tokens as they arrive.
 */
const COMPRESSIBLE_TYPE = /^(?:application\/json|text\/(?!event-stream))/i

/** Bodies above this are streamed uncompressed rather than buffered to gzip. */
const COMPRESS_LIMIT_BYTES = 16 * 1024 * 1024

/**
 * How many local requests may be *started* at once.
 *
 * One tunnel carries every phone's traffic for this desktop, so a burst can
 * ask the local server for dozens of requests in the same tick. Each request
 * is a `fetch`, and opening a hundred of them at once starves the event loop:
 * measured on Bun 1.4, 100 simultaneous requests through one tunnel left 56
 * of them waiting until the gateway's 30-second head timeout answered 502,
 * while capping the burst at 20 completed all 100 in 39ms.
 *
 * The cap covers only the fetch-and-take-headers step. A streamed response
 * (an SSE body, a long download) keeps running after its headers are in and
 * must *not* hold a slot: holding it would let a handful of open phone streams
 * starve every command, which is a worse failure than the burst it prevents.
 */
const MAX_CONCURRENT_LOCAL_REQUESTS = 24

export type AgentCoreOptions = {
  /** Gateway WebSocket address, for example `wss://gateway.example.com`. */
  gatewayUrl: string
  /** `relay/agent` path; defaults to the gateway's tunnel endpoint. */
  agentPath?: string
  agentToken: string
  /**
   * Where the local lumos server is right now, or null while it is starting.
   * Read per request so a restarted sidecar is picked up without a re-dial.
   */
  getLocalServerUrl: () => string | null
  /**
   * Credential the local server expects. The gateway forwards its own upstream
   * token, which is meaningless inside the desktop; replacing it here is what
   * lets an account desktop accept traffic from a shared gateway.
   */
  localAccessToken?: string | null
  /** Disable exponential reconnect (tests and callers that own the lifecycle). */
  reconnect?: boolean
  /**
   * Bodies larger than this are streamed instead of compressed whole. The
   * default suits production; tests inject a small cap to reach the overflow
   * path without materializing 16 MiB.
   */
  compressLimitBytes?: number
  log?: (message: string) => void
  /** Injected for tests; defaults to the global WebSocket. */
  createSocket?: (url: string, protocols?: string[]) => WebSocket
}

export type AgentClient = {
  close: () => void
  connected: () => boolean
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, name) => {
    if (name.toLowerCase() === 'content-length') return
    result[name] = value
  })
  return result
}

/** gzip/deflate over the tunnel, available in Bun and Node alike. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // Every runtime accepts any ArrayBufferView as a blob part, but TS 5.9's DOM
  // types narrow BlobPart to ArrayBuffer-backed views only — which a plain
  // Uint8Array parameter no longer promises. The cast keeps one body that
  // typechecks under both bun-types and the DOM lib.
  const parts = [bytes] as unknown as ConstructorParameters<typeof Blob>[0]
  const stream = new Blob(parts).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Whether this response may be compressed without breaking its consumer.
 *
 * Only whole-body JSON is considered: SSE must arrive frame by frame, and a
 * stream the upstream itself framed (chunked, or an explicit length) is meant
 * to be read as it is written.
 */
export function compressibleResponse(headers: Headers): boolean {
  const encoding = headers.get('content-encoding')
  if (encoding && encoding.toLowerCase() !== 'identity') return false
  const type = headers.get('content-type') ?? ''
  return COMPRESSIBLE_TYPE.test(type)
}

/**
 * Builds the relay URL.
 *
 * With `omitToken` the credential travels in the `Sec-WebSocket-Protocol`
 * header instead (the caller passes it as the connection's protocols); the
 * query-parameter form remains for gateways that predate subprotocol auth.
 */
export function agentRelayUrl(
  gatewayUrl: string,
  agentPath: string,
  agentToken: string,
  options: { omitToken?: boolean } = {},
): string {
  const url = new URL(gatewayUrl)
  // A gateway may live under a base path (a reverse proxy mounts it at
  // `/openbuddy`); the tunnel endpoint hangs off that base, not off the root.
  const base = url.pathname.replace(/\/+$/, '')
  if (!base.endsWith(agentPath)) url.pathname = `${base}${agentPath}`
  if (!options.omitToken) url.searchParams.set('token', agentToken)
  return url.toString()
}

export function createAgentClient(options: AgentCoreOptions): AgentClient {
  const gatewayUrl = options.gatewayUrl
  const agentToken = options.agentToken
  const agentPath = options.agentPath ?? '/relay/agent'
  const log = options.log ?? ((message: string) => console.log(message))
  const reconnect = options.reconnect ?? true
  const compressLimitBytes = options.compressLimitBytes ?? COMPRESS_LIMIT_BYTES
  const createSocket = options.createSocket ?? ((url: string, protocols?: string[]) => new WebSocket(url, protocols))
  /**
   * How the gateway credential is presented. Subprotocol keeps the token out
   * of URLs; the one-way fallback covers a gateway that has not been upgraded
   * to read the header yet, so a desktop never loses its tunnel to version skew.
   */
  let authMode: 'subprotocol' | 'query' = 'subprotocol'

  const httpAborts = new Map<string, AbortController>()
  /**
   * The local sockets this agent opened for the tunnel, with the messages that
   * arrived before the socket was open.
   *
   * The gateway forwards a client's first frame the moment the client sends it,
   * which is before the local socket has finished its handshake. Sending on a
   * `CONNECTING` socket throws, and an uncaught throw takes the whole agent
   * down — so every tunnel dies with it.
   */
  const wsSockets = new Map<string, {
    socket: WebSocket
    open: boolean
    queue: (string | Uint8Array)[]
  }>()
  let socket: WebSocket | null = null
  let send: ((frame: Frame) => void) | null = null
  /**
   * Tunnel features this gateway confirmed. A gateway that predates `hello`
   * stays empty, so the agent keeps its bodies plain rather than sending a
   * compressed frame nobody would decode.
   */
  let tunnelCapabilities = new Set<string>()
  let closed = false
  let attempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const localBase = (): string | null => {
    const current = options.getLocalServerUrl()
    return current ? current.replace(/\/+$/, '') : null
  }

  /** Headers for the local server: the tunnel's own plus the desktop credential. */
  const localHeaders = (given: Record<string, string> | undefined): Record<string, string> => {
    const headers = { ...(given ?? {}) }
    if (options.localAccessToken) headers.authorization = `Bearer ${options.localAccessToken}`
    return headers
  }

  const localWsUrl = (base: string, path: string): string => {
    const url = new URL(base)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const question = path.indexOf('?')
    url.pathname = question === -1 ? path : path.slice(0, question)
    url.search = question === -1 ? '' : path.slice(question)
    if (options.localAccessToken) url.searchParams.set('token', options.localAccessToken)
    return url.toString()
  }

  /**
   * Sends one frame to the gateway, if there still is a connection.
   *
   * The sender is looked up when the frame is produced, not when the handler
   * was created: a tunnel that is still open outlives the connection it was
   * opened on, and writing to a closed socket throws.
   */
  const emit = (frame: Frame): void => {
    const current = send
    if (!current) return
    try {
      current(frame)
    } catch {
      // The connection went away between the lookup and the write.
    }
  }

  /** Requests held back by the concurrency cap, in arrival order. */
  const localQueue: (() => void)[] = []
  let localInFlight = 0
  const acquireLocalSlot = (): Promise<void> => {
    if (localInFlight < MAX_CONCURRENT_LOCAL_REQUESTS) {
      localInFlight += 1
      return Promise.resolve()
    }
    return new Promise<void>(resolve => localQueue.push(resolve))
  }
  const releaseLocalSlot = (): void => {
    const next = localQueue.shift()
    if (next) {
      // Hand the slot straight to the waiter: the count never drops, so a
      // burst cannot slip past the cap between the release and the wake-up.
      next()
      return
    }
    localInFlight -= 1
  }

  const handleHttp = async (frame: Frame): Promise<void> => {
    if (!send) return
    const id = String(frame.id)
    const base = localBase()
    if (!base) {
      emit({ t: 'http_error', id, message: 'local server is not running' })
      return
    }
    await acquireLocalSlot()
    const controller = new AbortController()
    httpAborts.set(id, controller)
    let response: Response
    try {
      response = await fetch(`${base}${String(frame.path)}`, {
        method: String(frame.method),
        headers: localHeaders(frame.headers as Record<string, string | undefined> as Record<string, string> | undefined),
        body: typeof frame.body === 'string'
          ? new Uint8Array(Buffer.from(frame.body, 'base64'))
          : undefined,
        signal: controller.signal,
        redirect: 'manual',
      })
    } catch (error) {
      // The fetch itself failed: the slot is released here and the body path
      // below never runs.
      releaseLocalSlot()
      httpAborts.delete(id)
      if (controller.signal.aborted) return
      emit({ t: 'http_error', id, message: error instanceof Error ? error.message : String(error) })
      return
    }
    // Headers are in: the burst is over. A streamed body may run for minutes
    // and must not hold the slot.
    releaseLocalSlot()
    try {
      const headers = headersToObject(response.headers)
      const compress = response.body !== null && response.status === 200 &&
        tunnelCapabilities.has('gzip') && compressibleResponse(response.headers)
      if (response.body) {
        const reader = response.body.getReader()
        if (compress) {
          // A JSON answer is read whole before it is written: it is one value,
          // and gzip over the whole body beats framing it chunk by chunk.
          const chunks: Uint8Array[] = []
          let size = 0
          let overflow = false
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value || value.byteLength === 0) continue
            size += value.byteLength
            // Past the cap the body is streamed as it arrived: compressing a
            // very large answer would hold megabytes of resident memory on a
            // desktop that is also running the agent. The chunk that crossed
            // the cap has already been read, so it is forwarded too — dropping
            // it here would splice a hole in the body and hand the client
            // unparseable JSON.
            if (size > compressLimitBytes) { overflow = true; chunks.push(value); break }
            chunks.push(value)
          }
          if (!overflow) {
            const joined = new Uint8Array(size)
            let offset = 0
            for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
            const gzipped = await deflate(joined)
            emit({ t: 'http_head', id, status: response.status, headers, encoding: 'gzip' })
            emit({ t: 'http_chunk', id, data: Buffer.from(gzipped).toString('base64') })
            emit({ t: 'http_end', id })
            return
          }
          emit({ t: 'http_head', id, status: response.status, headers })
          for (const chunk of chunks) emit({ t: 'http_chunk', id, data: Buffer.from(chunk).toString('base64') })
        } else {
          emit({ t: 'http_head', id, status: response.status, headers })
        }
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value && value.byteLength > 0) {
            emit({ t: 'http_chunk', id, data: Buffer.from(value).toString('base64') })
          }
        }
      } else {
        emit({ t: 'http_head', id, status: response.status, headers })
      }
      emit({ t: 'http_end', id })
    } catch (error) {
      if (controller.signal.aborted) return
      emit({ t: 'http_error', id, message: error instanceof Error ? error.message : String(error) })
    } finally {
      httpAborts.delete(id)
    }
  }

  const handleWsOpen = (frame: Frame): void => {
    if (!send) return
    const id = String(frame.id)
    const base = localBase()
    if (!base) {
      emit({ t: 'ws_open_error', id, message: 'local server is not running' })
      return
    }
    let ws: WebSocket
    try {
      ws = createSocket(localWsUrl(base, String(frame.path)))
    } catch (error) {
      emit({ t: 'ws_open_error', id, message: error instanceof Error ? error.message : String(error) })
      return
    }
    ws.binaryType = 'arraybuffer'
    const pending = { socket: ws, open: false, queue: [] as (string | Uint8Array)[] }
    wsSockets.set(id, pending)
    ws.onopen = () => {
      pending.open = true
      // The frames that arrived during the handshake go out now, in order.
      for (const data of pending.queue.splice(0)) sendLocal(pending, data)
      emit({ t: 'ws_opened', id })
    }
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') emit({ t: 'ws_msg', id, text: event.data })
      else emit({ t: 'ws_msg', id, b64: Buffer.from(new Uint8Array(event.data as ArrayBuffer)).toString('base64') })
    }
    ws.onclose = (event) => {
      wsSockets.delete(id)
      emit({ t: 'ws_close', id, code: event.code, reason: event.reason })
    }
    ws.onerror = () => emit({ t: 'ws_open_error', id, message: 'local websocket error' })
  }

  /**
   * Writes one frame to the local socket.
   *
   * A socket that is still connecting cannot be written to: the send throws,
   * and an uncaught throw ends the agent. The frame is therefore kept until
   * the socket opens, and a socket that is already gone drops it.
   */
  const sendLocal = (
    pending: { socket: WebSocket; open: boolean; queue: (string | Uint8Array)[] },
    data: string | Uint8Array,
  ): void => {
    if (!pending.open) {
      // A socket that never opens would otherwise grow this queue forever.
      if (pending.queue.length >= MAX_QUEUED_FRAMES) pending.queue.shift()
      pending.queue.push(data)
      return
    }
    try {
      pending.socket.send(data)
    } catch {
      // The socket closed between the check and the write.
    }
  }

  const handleFrame = (raw: string): void => {
    if (!send) return
    let frame: Frame
    try {
      frame = JSON.parse(raw) as Frame
    } catch {
      return
    }
    const id = String(frame.id ?? '')
    switch (frame.t) {
      case 'hello': {
        tunnelCapabilities = new Set(
          Array.isArray(frame.capabilities) ? frame.capabilities.filter((value): value is string => typeof value === 'string') : [],
        )
        return
      }
      case 'http_req':
        void handleHttp(frame)
        return
      case 'http_abort':
        httpAborts.get(id)?.abort()
        return
      case 'ws_open':
        handleWsOpen(frame)
        return
      case 'ws_msg': {
        const pending = wsSockets.get(id)
        if (!pending) return
        if (typeof frame.text === 'string') sendLocal(pending, frame.text)
        else if (typeof frame.b64 === 'string') {
          sendLocal(pending, new Uint8Array(Buffer.from(frame.b64, 'base64')))
        }
        return
      }
      case 'ws_close': {
        const pending = wsSockets.get(id)
        if (!pending) return
        wsSockets.delete(id)
        pending.queue.length = 0
        try {
          pending.socket.close(
            typeof frame.code === 'number' ? frame.code : undefined,
            typeof frame.reason === 'string' ? frame.reason : undefined,
          )
        } catch {
          // already closed
        }
        return
      }
      default:
        return
    }
  }

  const teardown = () => {
    send = null
    tunnelCapabilities = new Set()
    for (const pending of wsSockets.values()) {
      try {
        pending.socket.close()
      } catch {
        // already closed
      }
    }
    wsSockets.clear()
    for (const controller of httpAborts.values()) controller.abort()
    httpAborts.clear()
  }

  const connect = (): void => {
    if (closed) return
    let ws: WebSocket
    try {
      ws = authMode === 'query'
        ? createSocket(agentRelayUrl(gatewayUrl, agentPath, agentToken))
        : createSocket(agentRelayUrl(gatewayUrl, agentPath, agentToken, { omitToken: true }), [agentToken])
    } catch (error) {
      log(`[agent] could not start a connection: ${error instanceof Error ? error.message : String(error)}`)
      scheduleReconnect()
      return
    }
    socket = ws
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      attempt = 0
      log(`[agent] connected to ${gatewayUrl}`)
      send = frame => {
        // Bun returns 0 when the frame is dropped because the gateway is not
        // reading fast enough. Silently dropping a response frame leaves the
        // phone waiting out its 30-second head timeout, so a drop is treated
        // as a dead tunnel: reconnect, which makes the gateway fail the
        // in-flight requests immediately instead of hanging them.
        const verdict = ws.send(JSON.stringify(frame))
        if (verdict === 0) {
          log('[agent] tunnel send dropped; reconnecting')
          try { ws.close(1013, 'send buffer full') } catch { /* already closing */ }
        }
      }
    }
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') handleFrame(event.data)
    }
    ws.onclose = (event) => {
      if (socket === ws) socket = null
      teardown()
      if (closed) return
      // 4401 from a gateway without subprotocol auth means "I never saw a
      // credential"; from a current gateway it means the token is wrong, and
      // the fallback changes nothing but the transport.
      if (event.code === 4401 && authMode === 'subprotocol') {
        authMode = 'query'
        log('[agent] gateway did not accept subprotocol auth; retrying with the query token')
      }
      scheduleReconnect()
    }
    ws.onerror = () => {
      // onclose carries the retry.
    }
  }

  const scheduleReconnect = (): void => {
    attempt += 1
    const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6))
    log(`[agent] disconnected; reconnecting in ${delay}ms`)
    if (reconnect) retryTimer = setTimeout(connect, delay)
  }

  connect()

  return {
    connected: () => send !== null,
    close: () => {
      closed = true
      if (retryTimer) clearTimeout(retryTimer)
      teardown()
      try {
        socket?.close()
      } catch {
        // already closed
      }
      socket = null
    },
  }
}
