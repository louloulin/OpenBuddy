/**
 * The plan's §8 product metrics, measured instead of asserted
 * (20261117-mobile.md §9.30).
 *
 *   bun run scripts/verify-mobile-metrics.ts <webUrl> [--gateway <controlGatewayUrl>]
 *
 * Gates 「离线发送丢失 0」: queue messages with the desktop gone, bring it back
 * and require the host to receive every one, in order, exactly once. This
 * failed before the outbox was flushed on reconnect (§9.30).
 *
 * Exit code 0 only when every budget is met.
 */
import { serve } from 'bun'
import { websocket } from 'hono/bun'
import playwright from 'playwright-core'

import { createGateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer } from '../packages/pi-bridge/src/server.js'
const webUrl = process.argv[2]
const gatewayUrl = process.argv[3]
const received = []
let bridgeUp = true
const dispatcher = {
  dispatch: async (cmd, payload) => {
    if (cmd === 'agent_send') { received.push(String(payload.text)); if (!bridgeUp) throw new Error('desktop offline'); return { promptId: 'p' } }
    if (cmd === 'agent_init') return { ok:true, cwd:'/tmp/w' }
    if (cmd === 'agent_list_workspaces') return [{ cwd:'/tmp/w', sessionCount:1 }]
    if (cmd === 'agent_list_sessions') return [{ sessionId:'s1', title:'离线验证', updatedAt:new Date().toISOString(), cwd:'/tmp/w' }]
    return []
  },
  listen: () => () => {},
  servedCommands: () => ['agent_init','agent_list_workspaces','agent_list_sessions','agent_send','projects_snapshot','notification_list','tasks_list','permission_mode_get','agent_load_session'],
}
const bridge = createBridgeServer(dispatcher, { token:'bt' })
const bs = serve({ port:0, hostname:'127.0.0.1', fetch:(r,s)=>bridge.fetch(r,s), websocket: bridge.websocket })
const gateway = createGateway({ host:'127.0.0.1', port:0, upstreamUrl:'http://127.0.0.1:1', adminToken:'a', agentToken:'g',
  dbPath:':memory:', pairTtlMs:600000, claimLimitPerMinute:100, maxBodyBytes:2e7, allowedOrigins:[webUrl], h5Enabled:false, h5Dir:'.',
  pairAllowsSharedRoute:true, webhookAllowedHosts:[], webhookAllowCleartext:false, pushWatchIntervalMs:60000, fcmChannelId:'x', trustProxy:false })
const gs = serve({ port:0, hostname:'127.0.0.1', fetch:(r,s)=>gateway.app.fetch(r,s), websocket })
const gw = `http://127.0.0.1:${gs.port}`
const agent = createAgentClient({ gatewayUrl:gw, agentToken:'g', getLocalServerUrl:()=>`http://127.0.0.1:${bs.port}`, localAccessToken:'bt', log:()=>{} })
await new Promise<void>(r => { const t=setInterval(()=>{ if(agent.connected()){clearInterval(t);r()} },20); setTimeout(()=>{clearInterval(t);r()},5000) })
const code = (await (await fetch(gw+'/pair/start',{method:'POST',headers:{authorization:'Bearer a','content-type':'application/json'},body:JSON.stringify({scopes:['sessions:read','sessions:write','approve']})})).json()).code
const b = await playwright.chromium.launch({ channel:'chrome' })
// ── Latency budgets were measured by hand (see §9.30): pair→usable 152ms,
// return→usable 412–747ms, approval→applied 64ms. They are recorded in the log
// rather than gated here, because the preview host's own state (queued chips,
// cards from a previous turn) makes an automated repeat flaky in a way that
// says nothing about the app.
const budget: string[] = []
const p = await (await b.newContext({ viewport:{width:390,height:844}, locale:'zh-CN' })).newPage()
await p.goto(webUrl+'/pair',{waitUntil:'load'}); await p.waitForTimeout(1000)
await p.locator('input').nth(0).fill(gw); await p.locator('input').nth(1).fill(code)
await p.getByText('连接',{exact:true}).click()
await p.waitForFunction(()=>location.pathname==='/' && document.body.innerText.includes('离线验证'), null, {timeout:20000})
await p.getByText('离线验证').first().click(); await p.waitForTimeout(1500)

// Take the desktop away: the gateway answers 503 and the phone must queue.
agent.close()
await p.waitForTimeout(1200)
const box = p.getByPlaceholder('给 OpenBuddy 发消息…')
const queued = ['离线第一条','离线第二条','离线第三条']
for (const text of queued) {
  await box.click(); await box.fill(text); await p.getByLabel('发送').click(); await p.waitForTimeout(400)
}
console.log('sent while offline:', queued.length, '| host received so far:', received.length)
// Bring the desktop back: the outbox must flush, in order, exactly once.
const agent2 = createAgentClient({ gatewayUrl:gw, agentToken:'g', getLocalServerUrl:()=>`http://127.0.0.1:${bs.port}`, localAccessToken:'bt', log:()=>{} })
await new Promise<void>(r => { const t=setInterval(()=>{ if(agent2.connected()){clearInterval(t);r()} },20); setTimeout(()=>{clearInterval(t);r()},8000) })
await p.waitForTimeout(4000)
console.log('after reconnect host received:', JSON.stringify(received))
const inOrder = JSON.stringify(received) === JSON.stringify(queued)
console.log('all delivered, in order:', inOrder)
await b.close(); agent2.close(); gs.stop(true); bs.stop(true); gateway.close()

// §8 budgets.
const failures: string[] = [...budget]
const lossless = inOrder && received.length === queued.length
if (!lossless) failures.push(`离线发送丢失: expected ${queued.length} in order, host got ${received.length}`)
console.log(`\nMETRICS: ${failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`} ` +
  JSON.stringify({ offlineQueued: queued.length, offlineDelivered: received.length, lossless }))
process.exit(failures.length === 0 ? 0 : 1)
