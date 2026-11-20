/**
 * Device revocation (20261117-mobile.md §2.1, §9.33).
 *
 * The desktop撤销 a paired phone; from then on every request answers 401. The
 * phone must:
 *
 *   1. drop back to the pairing screen
 *   2. keep the credential gone across a reload
 *   3. **say why** — landing on a bare pair screen makes a revocation look like
 *      a bug (this line was missing until this check existed)
 *
 *   bun run scripts/verify-mobile-revoke.ts <webUrl>
 *
 * Exit code 0 only when every assertion held.
 */
import { serve } from 'bun'
import { websocket } from 'hono/bun'
import playwright from 'playwright-core'

import { createGateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher } from '../packages/pi-bridge/src/server.js'

const webUrl = process.argv[2]
const dispatcher: HostDispatcher = {
  dispatch: async (cmd) => {
    if (cmd === 'agent_init') return { ok:true, cwd:'/tmp/w' }
    if (cmd === 'agent_list_workspaces') return [{ cwd:'/tmp/w', sessionCount:1 }]
    if (cmd === 'agent_list_sessions') return [{ sessionId:'s1', title:'吊销验证', updatedAt:new Date().toISOString(), cwd:'/tmp/w' }]
    if (cmd === 'projects_snapshot') return { projects: [] }
    if (cmd === 'agent_load_session') return { updates: [] }
    if (cmd === 'permission_mode_get') return { mode:'ask' }
    if (cmd === 'tasks_list') return []
    return {}
  },
  listen: () => () => {},
  servedCommands: () => ['agent_init','agent_list_workspaces','agent_list_sessions','projects_snapshot','agent_load_session','permission_mode_get','tasks_list'],
}
const bridge = createBridgeServer(dispatcher, { token:'bt' })
const bs = serve({ port:0, hostname:'127.0.0.1', fetch:(r,s)=>bridge.fetch(r,s), websocket: bridge.websocket as never })
const gateway = createGateway({ host:'127.0.0.1', port:0, upstreamUrl:'http://127.0.0.1:1', adminToken:'a', agentToken:'g',
  dbPath:':memory:', pairTtlMs:600000, claimLimitPerMinute:100, maxBodyBytes:2e7, allowedOrigins:[webUrl], h5Enabled:false, h5Dir:'.',
  pairAllowsSharedRoute:true, webhookAllowedHosts:[], webhookAllowCleartext:false, pushWatchIntervalMs:60000, fcmChannelId:'x', trustProxy:false })
const gs = serve({ port:0, hostname:'127.0.0.1', fetch:(r,s)=>gateway.app.fetch(r,s), websocket })
const gw = `http://127.0.0.1:${gs.port}`
const agent = createAgentClient({ gatewayUrl:gw, agentToken:'g', getLocalServerUrl:()=>`http://127.0.0.1:${bs.port}`, localAccessToken:'bt', log:()=>{} })
await new Promise<void>(r=>{const t=setInterval(()=>{if(agent.connected()){clearInterval(t);r()}},20);setTimeout(()=>{clearInterval(t);r()},5000)})
const code = (await (await fetch(gw+'/pair/start',{method:'POST',headers:{authorization:'Bearer a','content-type':'application/json'},body:JSON.stringify({scopes:['sessions:read','sessions:write','approve']})})).json()).code
const b = await playwright.chromium.launch({ channel:'chrome' })
const p = await (await b.newContext({ viewport:{width:390,height:844}, locale:'zh-CN' })).newPage()
await p.goto(webUrl+'/pair',{waitUntil:'load'}); await p.waitForTimeout(1000)
await p.locator('input').nth(0).fill(gw); await p.locator('input').nth(1).fill(code)
await p.getByText('连接',{exact:true}).click()
await p.waitForFunction(()=>location.pathname==='/', null, {timeout:20000})
await p.waitForTimeout(2000)
console.log('1. paired, list shows desktop data:', (await p.evaluate(()=>document.body.innerText)).includes('吊销验证'))
// The desktop revokes this device through the real admin endpoint.
const list = await (await fetch(gw+'/admin/devices', { headers: { authorization:'Bearer a' } })).json()
const deviceId = Array.isArray(list) ? list[0]?.id : list?.devices?.[0]?.id
console.log('2. device id:', deviceId)
const revokeRes = await fetch(`${gw}/admin/devices/${deviceId}/revoke`, { method:'POST', headers:{ authorization:'Bearer a' } })
console.log('3. revoke status:', revokeRes.status)
// The phone only learns on its next request; touch it by reloading the list.
await p.goto(webUrl+'/',{waitUntil:'load'}).catch(()=>{})
const t0 = Date.now()
await p.waitForFunction(()=>location.pathname==='/pair', null, {timeout:25000}).catch(()=>{})
const back = p.url().endsWith('/pair')
const backMs = Date.now() - t0
console.log('4. returned to /pair:', back, '| took', backMs, 'ms')
await p.waitForTimeout(800)
const body = await p.evaluate(()=>document.body.innerText)
console.log('5. body head:', JSON.stringify(body.slice(0, 200)))
// The credential must be gone: reload and it must stay on /pair.
await p.goto(webUrl+'/',{waitUntil:'load'}).catch(()=>{})
await p.waitForTimeout(2500)
const stillOut = p.url().endsWith('/pair')
console.log('6. still locked out after reload:', stillOut)
await p.screenshot({ path:'/tmp/revoked.png' })
await b.close(); agent.close(); gs.stop(true); bs.stop(true); gateway.close()
const results = {
  returnedToPairing: back,
  credentialCleared: stillOut,
  explained: body.includes('解除了这台手机'),
}
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([key]) => key)
console.log(`\nREVOKE VERIFY: ${failed.length === 0 ? 'ALL PASSED' : `${failed.length} FAILED`} ${JSON.stringify(results)} (back in ${backMs}ms)`)
process.exit(failed.length === 0 ? 0 : 1)
