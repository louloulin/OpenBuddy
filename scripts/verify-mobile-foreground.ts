/**
 * Returning to the foreground refreshes the open conversation
 * (20261117-mobile.md §2.5, §2.4 path 3, §9.37).
 *
 * The tunnel is dead while the app is backgrounded, so a turn that finished
 * during that window is only known through a reload. Without one the phone keeps
 * showing whatever it had when it went away.
 *
 *   bun run scripts/verify-mobile-foreground.ts <webUrl>
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
let loadCalls = 0
const dispatcher: HostDispatcher = {
  dispatch: async (cmd) => {
    switch (cmd) {
      case 'agent_init': return { ok:true, cwd:'/tmp/w' }
      case 'agent_list_workspaces': return [{ cwd:'/tmp/w', sessionCount:1 }]
      case 'agent_list_sessions': return [{ sessionId:'s1', title:'回前台验证', updatedAt:new Date().toISOString(), cwd:'/tmp/w' }]
      case 'projects_snapshot': return { projects: [] }
      case 'permission_mode_get': return { mode:'ask' }
      case 'tasks_list': return []
      case 'agent_load_session':
        loadCalls += 1
        return { updates: [{ type:'message_end', sessionId:'s1', message:{ role:'assistant', content:'回来后看到的答案' } }] }
      default: return {}
    }
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
await p.waitForTimeout(1500)
await p.getByText('回前台验证').first().click(); await p.waitForTimeout(1500)
const before = loadCalls
// Background then foreground, as the OS does.
await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
await p.waitForTimeout(400)
await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
await p.waitForTimeout(2500)
const reloaded = loadCalls > before
console.log('1. reload on resume:', reloaded, `(load calls ${before} -> ${loadCalls})`)
await p.waitForTimeout(500)
const t = await p.evaluate(()=>document.body.innerText)
const refreshed = t.includes('回来后看到的答案')
console.log('2. refreshed content visible:', refreshed)
await b.close(); agent.close(); gs.stop(true); bs.stop(true); gateway.close()
const results = { reloaded, refreshed }
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([key]) => key)
console.log(`\nFOREGROUND VERIFY: ${failed.length === 0 ? 'ALL PASSED' : `${failed.length} FAILED`} ${JSON.stringify(results)}`)
process.exit(failed.length === 0 ? 0 : 1)
