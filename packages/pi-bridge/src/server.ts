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

import { isCommand } from '@openbuddy/protocol/commands'
import { validateCommandPayload, type Payload } from '@openbuddy/protocol/validate'
import { EVENTS, isEvent, type EventName } from '@openbuddy/protocol/events'

import { EventBuffer, type BridgeEvent } from './event-buffer.js'
import { isAllowedCommand } from './scopes.js'

export type HostDispatcher = {
  /** Runs one host-module handler; same dispatch ipcMain.handle uses. */
  dispatch: (command: string, payload: Payload) => unknown | Promise<unknown>
  /** Subscribes to engine events; returns the unlisten function. */
  listen: (handler: (event: string, payload: unknown) => void) => () => void
  /** Commands this surface serves; the mobile host_capabilities answer. */
  servedCommands: () => readonly string[]
}

export type BridgeServerOptions = {
  /** Bearer token required on every request; the gateway agent supplies it. */
  token: string
  /** True (tests) disables the token check. */
  noAuth?: boolean
}

export type BridgeServer = {
  app: Hono
  /** Feeds one engine event into the buffer; the desktop wiring calls this. */
  emit: (event: string, payload: unknown) => void
  close: () => void
}

export function createBridgeServer(dispatcher: HostDispatcher, options: BridgeServerOptions): BridgeServer {
  const buffer = new EventBuffer()
  // Only commands this desktop actually serves AND the mobile surface allows.
  const allowed = new Set(
    dispatcher.servedCommands().filter(command => isAllowedCommand(command) && isCommand(command)),
  )
  const events = EVENTS.filter((event): event is EventName => isEvent(event))
  /** Live subscribers of the SSE tail; each holds its own queue. */
  const streams = new Set<(item: BridgeEvent) => void>()

  const authorized = (header: string | null): boolean =>
    options.noAuth || header === `Bearer ${options.token}`

  const app = new Hono()

  app.on(['GET', 'POST'], ['/health', '/api/health'], (c) => c.json({ ok: true, commands: allowed.size }))

  app.on('GET', ['/capabilities', '/api/capabilities'], (c) => {
    if (!authorized(c.req.header('authorization'))) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    return c.json({
      platform: 'mobile-host',
      commands: [...allowed],
      events,
    })
  })

  app.on('POST', ['/cmd/:command', '/api/cmd/:command'], async (c) => {
    if (!authorized(c.req.header('authorization'))) {
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
      payload = validateCommandPayload(command, input)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'invalid_payload' }, 400)
    }
    try {
      const result = await dispatcher.dispatch(command, payload)
      return c.json({ ok: true, result: result ?? null })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  })

  app.on('GET', ['/events', '/api/events'], (c) => {
    if (!authorized(c.req.header('authorization'))) {
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
      try {
        while (true) {
          while (queue.length > 0) {
            const item = queue.shift()!
            await stream.writeSSE({ id: String(item.seq), event: item.event, data: JSON.stringify(item.payload) })
          }
          await stream.sleep(50)
          if (c.req.raw.signal.aborted) break
        }
      } finally {
        streams.delete(deliver)
      }
    })
  })

  // Every engine event lands in the buffer exactly once, then fans out to the
  // connected SSE streams.
  const offEngine = dispatcher.listen((event, payload) => {
    const item = buffer.push(event, payload)
    for (const deliver of streams) deliver(item)
  })

  return {
    app,
    emit: (event, payload) => {
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
