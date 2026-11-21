/**
 * The Pi Bridge's public surface (20261115-mobile.md §3.1).
 *
 * The desktop embeds this package; the gateway never imports it (the gateway
 * only tunnels bytes, and does not need to know the protocol).
 */

export { createBridgeServer } from './server.js'
export type { BridgeServer, BridgeServerOptions, BridgeSocket, HostDispatcher, UploadSink } from './server.js'
export { EventBuffer } from './event-buffer.js'
export type { BridgeEvent } from './event-buffer.js'
export { isAllowedCommand, scopeForCommand, mobileCapabilities } from './scopes.js'
export type { Scope } from './scopes.js'
