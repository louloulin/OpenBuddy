/**
 * CLI entry for the desktop-side agent. Run next to the desktop server:
 *
 *   GATEWAY_URL=wss://gateway.example.com \
 *   GATEWAY_AGENT_TOKEN=dsk_... \
 *   LOCAL_SERVER_URL=http://127.0.0.1:3456 \
 *   bun run agent
 *
 * The tunnel logic lives in `agentCore.ts`, which the Electron main process
 * also embeds; this file only reads the environment.
 */

import { createAgentClient } from './agentCore.js'

export { createAgentClient, agentRelayUrl } from './agentCore.js'
export type { AgentClient, AgentCoreOptions } from './agentCore.js'

if (import.meta.main) {
  createAgentClient({
    gatewayUrl: process.env.GATEWAY_URL ?? 'ws://127.0.0.1:8787',
    agentToken: process.env.GATEWAY_AGENT_TOKEN ?? '',
    getLocalServerUrl: () => process.env.LOCAL_SERVER_URL ?? 'http://127.0.0.1:3456',
    localAccessToken: process.env.LOCAL_ACCESS_TOKEN ?? process.env.LUMOS_LOCAL_ACCESS_TOKEN ?? null,
  })
}
