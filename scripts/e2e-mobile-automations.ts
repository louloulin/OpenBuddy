/**
 * The automations path, end to end: phone → gateway → PiBridge → host handler.
 * Proves the mobile surface can read the schedule and trigger a task.
 */
/**
 * The automations path, end to end (20261115-mobile.md §9.2).
 *
 *   phone (the app's own reducer) → gateway tunnel → PiBridge → host handler
 *
 * What it proves: the phone can read the desktop's schedule, see when a task
 * next runs, trigger it now and resume a paused one — through the same
 * transport the app uses in production.
 */

import { serve } from 'bun'
import { websocket } from 'hono/bun'
import { createGateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher } from '../packages/pi-bridge/src/server.js'
import { GatewayTransport } from '../packages/client/src/gateway-transport.js'
import { toAutomations, scheduleLabel } from '../apps/mobile/src/core/automations.ts'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures += 1
}

const ran: string[] = []
const toggled: { id: string; status: string }[] = []
const dispatcher: HostDispatcher = {
  dispatch: async (command, payload) => {
    if (command === 'automations_snapshot') {
      return {
        automations: [
          { id: 'auto-1', name: '每日晨报', prompt: '整理今天的日程', status: 'ACTIVE', nextRunAt: new Date(Date.now() + 3600_000).toISOString() },
          { id: 'auto-2', name: '旧提醒', prompt: '提醒', status: 'PAUSED' },
        ],
        records: [],
      }
    }
    if (command === 'automations_run') { ran.push(String(payload.id)); return { started: true } }
    if (command === 'automations_set_status') { toggled.push({ id: String(payload.id), status: String(payload.status) }); return { ok: true } }
    throw new Error(`unexpected ${command}`)
  },
  listen: () => () => {},
  servedCommands: () => ['automations_snapshot', 'automations_run', 'automations_set_status', 'agent_list_sessions'],
}

const bridge = createBridgeServer(dispatcher, { token: 'bridge-secret' })
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

const transport = new GatewayTransport({ baseUrl:`${gu}/api`, token: claim.deviceToken, maxBackoffMs: 500 })
const deadline = Date.now() + 5000
while (transport.state() !== 'open' && Date.now() < deadline) await Bun.sleep(25)
check('phone connected through the gateway', transport.state() === 'open')

const caps = await (await fetch(`${gu}/api/capabilities`, { headers:{authorization:`Bearer ${claim.deviceToken}`} })).json() as any
check('the mobile surface advertises automations_snapshot', caps.commands.includes('automations_snapshot'), JSON.stringify(caps.commands))

const snapshot = await transport.invoke<any>('automations_snapshot', {})
const rows = toAutomations(snapshot)
check('the phone folded the snapshot into rows', rows.length === 2, JSON.stringify(rows.map(r=>r.id)))
check('the first task is active with a next run', rows[0]?.status === 'ACTIVE' && Boolean(rows[0]?.nextRunAt))
check('the schedule line is human readable', scheduleLabel(rows[0]!).includes('下次'), scheduleLabel(rows[0]!))
check('a paused task says no schedule line', scheduleLabel(rows[1]!) === '')

await transport.invoke('automations_run', { id: 'auto-1' })
check('running a task reached the desktop', ran.includes('auto-1'), ran.join(','))

await transport.invoke('automations_set_status', { id: 'auto-2', status: 'ACTIVE' })
check('resuming a task reached the desktop', toggled.some(t => t.id === 'auto-2' && t.status === 'ACTIVE'), JSON.stringify(toggled))

transport.close(); agent.close(); gs.stop(true); bs.stop(true); gateway.close()
console.log(failures === 0 ? '\nAUTOMATIONS E2E: ALL CHECKS PASSED' : `\nAUTOMATIONS E2E: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
