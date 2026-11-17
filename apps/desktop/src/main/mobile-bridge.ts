/**
 * The desktop side of the mobile path (20261115-mobile.md Phase 2.6).
 *
 * The phone never talks to the engine directly: it talks to the PiBridge over
 * the loopback, and the gateway tunnels that traffic to this process. So the
 * desktop has to do three things at startup:
 *
 *   1. serve the bridge on 127.0.0.1 (the gateway's agent dials it),
 *   2. dial the gateway itself (outbound only — the desktop is usually behind
 *      a NAT, and the gateway may be anywhere),
 *   3. hand the bridge the *same* host handlers the renderer uses, so a phone
 *      and the desktop window drive one engine.
 *
 * Everything here is optional: without `OPENBUDDY_GATEWAY_URL` the desktop
 * behaves exactly as before, and no port is opened.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { serve, type ServerType } from '@hono/node-server'
import { createBridgeServer, type HostDispatcher } from '@openbuddy/pi-bridge/server'
import { createAgentClient } from '@openbuddy/gateway/agentCore'
import type { CommandHandlers, Payload } from '@openbuddy/protocol/contract'

/**
 * A tiny event hub between the engine and the bridge.
 *
 * The engine's `emit` is a single callback; the bridge wants to subscribe and
 * unsubscribe. One set of listeners is all that is needed, and it keeps the
 * engine unaware that a phone exists.
 */
export type EngineEventHub = {
  emit: (event: string, payload: unknown) => void
  subscribe: (handler: (event: string, payload: unknown) => void) => () => void
}

export function createEngineEventHub(): EngineEventHub {
  const listeners = new Set<(event: string, payload: unknown) => void>()
  return {
    emit(event, payload) {
      for (const listener of [...listeners]) {
        try {
          listener(event, payload)
        } catch (error) {
          console.error('[mobile-bridge] event listener failed', error)
        }
      }
    },
    subscribe(handler) {
      listeners.add(handler)
      return () => { listeners.delete(handler) }
    },
  }
}

/**
 * The bridge's view of the desktop: the host handlers, minus everything the
 * phone may not touch.
 *
 * The command allow-list is not written here — `packages/pi-bridge/src/scopes.ts`
 * owns it, so the phone's surface cannot drift from the desktop's rules.
 */
export function createBridgeDispatcher(handlers: CommandHandlers, hub: EngineEventHub): HostDispatcher {
  return {
    async dispatch(command: string, payload: Payload) {
      const handler = handlers[command]
      if (!handler) throw new Error(`not_implemented: ${command}`)
      return handler(payload)
    },
    listen(handler) {
      return hub.subscribe(handler)
    },
    servedCommands() {
      return Object.keys(handlers)
    },
  }
}

export type MobileBridgeOptions = {
  /** The host handlers the renderer already uses. */
  handlers: CommandHandlers
  /** Engine events, shared with the renderer. */
  hub: EngineEventHub
  /** Where camera uploads land (inside the app's user data). */
  uploadsDir: string
  /** Gateway origin; without it the bridge stays off. */
  gatewayUrl?: string
  /** Agent token the gateway expects on the relay socket. */
  agentToken?: string
}

export type MobileBridge = {
  /** Local address the gateway agent dials. */
  url: string
  /** Token the bridge requires from the agent hop. */
  token: string
  close: () => Promise<void>
}

/** A token the phone never sees: it only travels desktop → gateway agent. */
export function createBridgeToken(): string {
  return randomBytes(24).toString('hex')
}

export async function startMobileBridge(options: MobileBridgeOptions): Promise<MobileBridge | null> {
  const gatewayUrl = options.gatewayUrl?.trim()
  if (!gatewayUrl) return null

  const token = createBridgeToken()
  const dispatcher = createBridgeDispatcher(options.handlers, options.hub)

  await mkdir(options.uploadsDir, { recursive: true })
  const bridge = createBridgeServer(dispatcher, {
    token,
    uploads: {
      maxBytes: 8 * 1024 * 1024,
      async save(bytes, extension) {
        // The name is generated, never the one the phone asked for: a phone
        // must not be able to choose where a file lands on the desktop.
        const name = `upload-${randomBytes(12).toString('hex')}.${extension}`
        const path = join(options.uploadsDir, name)
        await writeFile(path, bytes)
        return { path }
      },
    },
  })

  // `serve` listens asynchronously, so the real port is only known once the
  // server reports it; asking for port 0 and reading `address()` too early
  // would hand the gateway agent an address of ":0".
  const { server, url } = await new Promise<{ server: ServerType; url: string }>(resolve => {
    const server = serve(
      { fetch: bridge.app.fetch, hostname: '127.0.0.1', port: 0 },
      info => resolve({ server, url: `http://127.0.0.1:${info.port}` }),
    )
  })

  const agent = createAgentClient({
    gatewayUrl,
    agentToken: options.agentToken ?? '',
    getLocalServerUrl: () => url,
    localAccessToken: token,
  })

  console.log(`[mobile-bridge] serving ${url} for gateway ${gatewayUrl}`)

  return {
    url,
    token,
    async close() {
      agent.close()
      bridge.close()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
