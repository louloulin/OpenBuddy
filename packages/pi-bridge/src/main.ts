/**
 * Desktop wiring (20261115-mobile.md §2): connects the Pi engine's host
 * handlers and event stream to the gateway through lumos' `agentCore` client.
 *
 * The desktop dials OUT to the gateway (`/relay/agent` WS); the gateway
 * forwards phone HTTP traffic as `http_req` tunnel frames. This module answers
 * those frames against the local bridge server — one fetch per tunnel request,
 * no reimplementation of routing.
 */

import { serve } from 'bun'

import { createAgentClient } from '../../gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher, type BridgeServer } from './server.js'

export type DesktopBridgeOptions = {
  /** Gateway WS address, e.g. ws://127.0.0.1:8080. */
  gatewayUrl: string
  /** The gateway's agent credential (`dsk_…` or legacy shared token). */
  agentToken: string
  /** Credential the bridge requires on every request. */
  bridgeToken: string
  /** Local bind, loopback only. */
  port?: number
  host?: string
  log?: (message: string) => void
}

export type DesktopBridge = {
  /** Local bridge base URL, e.g. http://127.0.0.1:43117. */
  localUrl: string
  close: () => void
  connected: () => boolean
}

export function startDesktopBridge(
  dispatcher: HostDispatcher,
  options: DesktopBridgeOptions,
): DesktopBridge {
  const log = options.log ?? ((message: string) => console.log(message))
  const bridge: BridgeServer = createBridgeServer(dispatcher, { token: options.bridgeToken })

  const server = serve({
    port: options.port ?? 0,
    hostname: options.host ?? '127.0.0.1',
    fetch: bridge.app.fetch,
  })

  const localUrl = `http://127.0.0.1:${server.port}`

  const agent = createAgentClient({
    gatewayUrl: options.gatewayUrl,
    agentToken: options.agentToken,
    getLocalServerUrl: () => localUrl,
    localAccessToken: options.bridgeToken,
    log,
  })

  return {
    localUrl,
    connected: agent.connected,
    close: () => {
      agent.close()
      server.stop(true)
      bridge.close()
    },
  }
}
