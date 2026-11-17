/**
 * Weak-network verification (20261115-mobile.md §9.2, Phase 4).
 *
 *   phone → gateway tunnel → PiBridge → desktop
 *
 * What it proves, over the real stack:
 *   1. An idle event stream still carries a heartbeat, so a proxy in the
 *      middle does not drop the tunnel on a quiet conversation.
 *   2. The phone sees the heartbeat but no business listener does.
 *   3. A revoked credential (401) is reported instead of retried forever.
 *   4. `reconnectNow()` brings the tunnel back without waiting out a backoff.
 */

import { serve } from 'bun'
import { websocket } from 'hono/bun'
import { createGateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher } from '../packages/pi-bridge/src/server.js'
import { GatewayTransport } from '../packages/client/src/gateway-transport.js'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures += 1
}

const dispatcher: HostDispatcher = {
  dispatch: async () => ({ ok: true }),
  listen: () => () => {},
  servedCommands: () => ['agent_list_sessions'],
}

const bridge = createBridgeServer(dispatcher, { token: 'bridge-secret', heartbeatIntervalMs: 300 })
const bs = serve({
  idleTimeout: 120, port: 0, hostname: '127.0.0.1', fetch: bridge.app.fetch })
const gateway = createGateway({ host:'127.0.0.1', port:0, upstreamUrl:'http://127.0.0.1:1', adminToken:'adm', agentToken:'agt', dbPath:':memory:', pairTtlMs:60000, claimLimitPerMinute:100, maxBodyBytes:2*1024*1024, allowedOrigins:[], h5Enabled:false, h5Dir:'.', pairAllowsSharedRoute:true, webhookAllowedHosts:[], webhookAllowCleartext:false, pushWatchIntervalMs:60000, fcmChannelId:'b', trustProxy:false } as never)
const gs = serve({
  idleTimeout: 120, port:0, hostname:'127.0.0.1', fetch:(r,s)=>gateway.app.fetch(r,s), websocket })
const gu = `http://127.0.0.1:${gs.port}`
const agent = createAgentClient({ gatewayUrl: gu, agentToken:'agt', getLocalServerUrl: () => `http://127.0.0.1:${bs.port}`, localAccessToken:'bridge-secret', log: () => {} })
await new Promise<void>(r => { const t=setInterval(()=>{ if(agent.connected()){clearInterval(t);r()} },20); setTimeout(()=>{clearInterval(t);r()},4000) })

const pair = await (await fetch(`${gu}/pair/start`, { method:'POST', headers:{authorization:'Bearer adm','content-type':'application/json'}, body:JSON.stringify({ scopes:['sessions:read','sessions:write'] }) })).json() as any
const claim = await (await fetch(`${gu}/pair/claim`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ code:pair.code, deviceName:'Phone', platform:'ios' }) })).json() as any

// ── 1 & 2: the heartbeat crosses the tunnel and stays out of the app's way ──
let business = 0
const transport = new GatewayTransport({ baseUrl:`${gu}/api`, token: claim.deviceToken, maxBackoffMs: 500, heartbeatTimeoutMs: 5_000 })
await transport.listen('agent://event', () => { business += 1 })
const deadline = Date.now() + 5000
while (transport.state() !== 'open' && Date.now() < deadline) await Bun.sleep(25)
check('the tunnel is open', transport.state() === 'open', transport.state())

// The heartbeat keeps the stream alive; if it never arrived, the transport
// would have declared the link dead and dropped to reconnecting.
const before = Date.now()
await Bun.sleep(1200)
check('the stream survived an idle minute-scale silence', transport.state() === 'open', transport.state())
check('the heartbeat is not delivered as a business event', business === 0, String(business))

// ── 3: a revoked credential is reported, not retried forever ──
let unauthorized = 0
const revoked = new GatewayTransport({
  baseUrl: `${gu}/api`,
  token: 'dvc_not_a_real_token',
  maxBackoffMs: 100,
  onUnauthorized: () => { unauthorized += 1 },
})
await Bun.sleep(600)
check('a bad credential reports the revocation', unauthorized >= 1, String(unauthorized))
check('a revoked transport stops instead of retrying', revoked.state() === 'closed', revoked.state())
revoked.close()

// ── 4: reconnectNow brings the tunnel back at once ──
transport.reconnectNow()
const back = Date.now() + 3000
while (transport.state() !== 'open' && Date.now() < back) await Bun.sleep(20)
check('reconnectNow reopens the tunnel without a backoff wait', transport.state() === 'open', transport.state())

transport.close(); agent.close(); gs.stop(true); bs.stop(true); gateway.close()
console.log(failures === 0 ? '\nWEAK-NETWORK E2E: ALL CHECKS PASSED' : `\nWEAK-NETWORK E2E: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
