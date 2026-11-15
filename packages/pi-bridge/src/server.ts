/**
 * The bridge server (20261115-mobile.md §3.1): the OpenBuddy IPC contract over
 * HTTP + SSE, shaped so the gateway's existing HTTP tunnel forwards it
 * unchanged.
 *
 * Endpoints (all behind the gateway on the phone path; locally the loopback):
 *   POST /cmd/:command   validate → scope-check → host handler → JSON reply
 *   GET  /events?since=  SSE stream of `agent://…` events, `id:` = seq
 *   GET  /capabilities   the host_capabilities answer for this surface
 *   GET  /health         readiness
 *
 * Auth: local deployments use the shared bridge token the gateway's agent
 * injects as the upstream bearer (`localAccessToken` in agentCore); every
 * request must carry it. The desktop binds to 127.0.0.1.
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import { isCommand, validateCommandPayload, type Payload } from '@openbuddy/protocol/validate'
import { EVENTS, isEvent, type EventName } from '@openbuddy/protocol/events'


import { EventBuffer, type BridgeEvent } from './event-buffer.js'
import { isAllowedCommand, scopeForCommand } from './scopes.js'

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
  const allowed = new Set(dispatcher.servedCommands().filter(isAllowedCommand))
  const events = EVENTS.filter((event): event is EventName => isEvent(event))

  const authorized = (header: string | null): boolean =>
    options.noAuth || header === `Bearer ${options.token}`

  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true, commands: allowed.size }))

  app.get('/capabilities', (c) => {
    if (!authorized(c.req.header('authorization'))) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    return c.json({
      platform: 'mobile-host',
      commands: [...allowed],
      events,
    })
  })

  app.post('/cmd/:command', async (c) => {
    if (!authorized(c.req.header('authorization'))) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const command = c.req.param('command')
    if (!isCommand(command) || !isAllowedCommand(command) || !allowed.has(command)) {
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

  app.get('/events', (c) => {
    if (!authorized(c.req.header('authorization'))) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const sinceParam = c.req.query('since')
    const since = sinceParam !== undefined && sinceParam !== '' && /^\d+$/.test(sinceParam)
      ? Number(sinceParam)
      : 0
    let replay: BridgeEvent[] | null = since > 0 ? buffer.since(since) : []
    // A gap means the client is too far behind; replaying nothing would
    // silently skip turns, so the stream tells it to resync instead.
    const resync = replay === null
    const unlisten = dispatcher.listen((event, payload) => {
      buffer.push(event, payload)
    })

    return streamSSE(c, async (stream) => {
      let closed = false
      const unsubscribe = dispatcher.listen((event, payload) => {
        // Live events after the buffer write below are delivered via the
        // SSE writer inside the loop; buffering first keeps one seq source.
      })
      void unsubscribe

      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ head: buffer.head(), resync }) })
      if (resync) {
        await stream.writeSSE({ event: 'resync', data: JSON.stringify({ head: buffer.head() }) })
        replay = []
      }
      for (const item of replay ?? []) {
        await stream.writeSSE({ id: String(item.seq), event: item.event, data: JSON.stringify(item.payload) })
      }

      // Live tail: the dispatcher listener above cannot write to the stream
      // directly (the stream does not exist yet when events fire), so the
      // queue drains here until the client goes away.
      const pending: BridgeEvent[] = []
      const pushLive = (event: string, payload: unknown) => pending.push(buffer.push(event, payload))
      const offLive = dispatcher.listen(pushLive)

      try {
        while (!closed) {
          while (pending.length > 0) {
            const item = pending.shift()!
            await stream.writeSSE({ id: String(item.seq), event: item.event, data: JSON.stringify(item.payload) })
          }
          await stream.sleep(50)
          if (c.req.raw.signal.aborted) closed = true
        }
      } catch {
        closed = true
      } finally {
        offLive()
        unlisten()
      }
    })
  })

  return {
    app,
    emit: (event, payload) => {
      buffer.push(event, payload)
    },
    close: () => {
      // The Hono app owns no sockets here; the embedding process closes them.
    },
  }
}

/** Scope of one command, exported for tests and the desktop's UI gating. */
export { scopeForCommand, isAllowedCommand } from './scopes.js'
