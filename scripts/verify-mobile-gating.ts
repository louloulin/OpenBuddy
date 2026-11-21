/**
 * Capability gating, for real (20261117-mobile.md §1.3, §9.31).
 *
 * §1.3 says a block the desktop does not offer must be **hidden**, not shown and
 * then refused. The phone decides from `/capabilities`, which the bridge filters
 * to what the desktop actually serves. This script stands up a deliberately
 * narrow desktop (sessions only) and checks the production build:
 *
 *   - the session list still works
 *   - 搜索 / 通知 / 自动化 tabs disappear
 *   - 「我」 reports memory as 未开放 instead of a working-looking row
 *   - a *partial* desktop (sessions + search only) shows exactly 会话 / 搜索 / 我
 *
 * Run against a **production** build: the design-preview build answers from a
 * fixed dataset and therefore always advertises everything.
 *
 *   NODE_ENV=production CI=1 npx expo export --platform web --output-dir /tmp/expo-prod   # apps/mobile
 *   bun run scripts/preview-mobile-web.ts /tmp/expo-prod &
 *   bun run scripts/verify-mobile-gating.ts <webUrl>
 *
 * Exit code 0 only when every gate held.
 */
import { serve } from 'bun'
import { websocket } from 'hono/bun'
import playwright from 'playwright-core'

import { createGateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher } from '../packages/pi-bridge/src/server.js'

const webUrl = process.argv[2]
// Deliberately narrow: sessions only. No search, no notifications, no automations,
// no memory, no library.
const dispatcher: HostDispatcher = {
  dispatch: async (cmd) => {
    if (cmd === 'agent_init') return { ok: true, cwd: '/tmp/w' }
    if (cmd === 'agent_list_workspaces') return [{ cwd: '/tmp/w', sessionCount: 1 }]
    if (cmd === 'agent_list_sessions') return [{ sessionId: 's1', title: '最小桌面', updatedAt: new Date().toISOString(), cwd: '/tmp/w' }]
    if (cmd === 'projects_snapshot') return { projects: [] }
    if (cmd === 'agent_load_session') return { updates: [] }
    if (cmd === 'permission_mode_get') return { mode: 'ask' }
    if (cmd === 'tasks_list') return []
    throw new Error('not served: ' + cmd)
  },
  listen: () => () => {},
  servedCommands: () => ['agent_init','agent_list_workspaces','agent_list_sessions','projects_snapshot','agent_load_session','permission_mode_get','tasks_list'],
}
const bridge = createBridgeServer(dispatcher, { token: 'bt' })
const bs = serve({ port: 0, hostname: '127.0.0.1', fetch: (r, s) => bridge.fetch(r, s), websocket: bridge.websocket as never })
const gateway = createGateway({ host:'127.0.0.1', port:0, upstreamUrl:'http://127.0.0.1:1', adminToken:'a', agentToken:'g',
  dbPath:':memory:', pairTtlMs:600000, claimLimitPerMinute:100, maxBodyBytes:2e7, allowedOrigins:[webUrl], h5Enabled:false, h5Dir:'.',
  pairAllowsSharedRoute:true, webhookAllowedHosts:[], webhookAllowCleartext:false, pushWatchIntervalMs:60000, fcmChannelId:'x', trustProxy:false })
const gs = serve({ port: 0, hostname:'127.0.0.1', fetch:(r,s)=>gateway.app.fetch(r,s), websocket })
const gw = `http://127.0.0.1:${gs.port}`
const agent = createAgentClient({ gatewayUrl: gw, agentToken:'g', getLocalServerUrl: () => `http://127.0.0.1:${bs.port}`, localAccessToken:'bt', log:()=>{} })
await new Promise<void>(r => { const t=setInterval(()=>{ if(agent.connected()){clearInterval(t);r()} },20); setTimeout(()=>{clearInterval(t);r()},5000) })
const code = (await (await fetch(gw+'/pair/start',{method:'POST',headers:{authorization:'Bearer a','content-type':'application/json'},body:JSON.stringify({scopes:['sessions:read','sessions:write','approve']})})).json()).code

const b = await playwright.chromium.launch({ channel:'chrome' })
const p = await (await b.newContext({ viewport:{width:390,height:844}, locale:'zh-CN' })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0,120)))
await p.goto(webUrl+'/pair',{waitUntil:'load'}); await p.waitForTimeout(1000)
await p.locator('input').nth(0).fill(gw); await p.locator('input').nth(1).fill(code)
await p.getByText('连接',{exact:true}).click()
await p.waitForFunction(()=>location.pathname==='/', null, {timeout:20000})
await p.waitForTimeout(2500)
const nav = await p.evaluate(()=>document.body.innerText)
const tabs = ['搜索','通知','自动化'].filter(t => nav.split('\n').slice(-8).some(l => l.trim() === t))
const listOk = nav.includes('最小桌面')
console.log('1. session list rendered:', listOk)
console.log('2. tabs still shown:', JSON.stringify(tabs), '(expected [])')
// The 我 page must not advertise memory/library as usable.
await p.goto(webUrl+'/me',{waitUntil:'load'}); await p.waitForTimeout(2500)
const me = await p.evaluate(()=>document.body.innerText)
const mem = me.split('\n').find(l=>l.includes('记忆')) ?? ''
const memoryRow = (await p.evaluate(()=>document.body.innerText)).match(/记忆\n?[^\n]*/)?.[0] ?? 'missing'
console.log('3. 记忆 row:', JSON.stringify(memoryRow))
agent.close(); gs.stop(true); bs.stop(true); gateway.close()
const results = {
  sessionListWorks: listOk,
  hiddenTabs: tabs.length === 0,
  memoryGated: /未开放/.test(memoryRow),
}
// ── Partial desktop: serves search but not notifications/automations ────────
const partialCommands = ['agent_init','agent_list_workspaces','agent_list_sessions','projects_snapshot','agent_load_session','permission_mode_get','tasks_list','session_search']
const partial: HostDispatcher = {
  dispatch: async (cmd) => {
    if (!partialCommands.includes(cmd)) throw new Error('not served: ' + cmd)
    switch (cmd) {
      case 'agent_init': return { ok: true, cwd: '/tmp/w' }
      case 'agent_list_workspaces': return [{ cwd: '/tmp/w', sessionCount: 1 }]
      case 'agent_list_sessions': return [{ sessionId:'s1', title:'部分能力桌面', updatedAt:new Date().toISOString(), cwd:'/tmp/w' }]
      case 'projects_snapshot': return { projects: [] }
      case 'agent_load_session': return { updates: [] }
      case 'permission_mode_get': return { mode: 'ask' }
      case 'tasks_list': return []
      case 'session_search': return []
      default: return {}
    }
  },
  listen: () => () => {},
  servedCommands: () => partialCommands,
}
const partialBridge = createBridgeServer(partial, { token: 'bt2' })
const pbs = serve({ port:0, hostname:'127.0.0.1', fetch:(r,s)=>partialBridge.fetch(r,s), websocket: partialBridge.websocket as never })
const pgw = createGateway({ host:'127.0.0.1', port:0, upstreamUrl:'http://127.0.0.1:1', adminToken:'a', agentToken:'g',
  dbPath:':memory:', pairTtlMs:600000, claimLimitPerMinute:100, maxBodyBytes:2e7, allowedOrigins:[webUrl], h5Enabled:false, h5Dir:'.',
  pairAllowsSharedRoute:true, webhookAllowedHosts:[], webhookAllowCleartext:false, pushWatchIntervalMs:60000, fcmChannelId:'x', trustProxy:false })
const pgs = serve({ port:0, hostname:'127.0.0.1', fetch:(r,s)=>pgw.app.fetch(r,s), websocket })
const partialAgent = createAgentClient({ gatewayUrl:`http://127.0.0.1:${pgs.port}`, agentToken:'g', getLocalServerUrl:()=>`http://127.0.0.1:${pbs.port}`, localAccessToken:'bt2', log:()=>{} })
await new Promise<void>(r=>{const t=setInterval(()=>{if(partialAgent.connected()){clearInterval(t);r()}},20);setTimeout(()=>{clearInterval(t);r()},5000)})
const pcode = (await (await fetch(`http://127.0.0.1:${pgs.port}/pair/start`,{method:'POST',headers:{authorization:'Bearer a','content-type':'application/json'},body:JSON.stringify({scopes:['sessions:read','sessions:write','approve']})})).json()).code
const ppage = await (await b.newContext({ viewport:{width:390,height:844}, locale:'zh-CN' })).newPage()
await ppage.goto(webUrl+'/pair',{waitUntil:'load'}); await ppage.waitForTimeout(1000)
await ppage.locator('input').nth(0).fill(`http://127.0.0.1:${pgs.port}`); await ppage.locator('input').nth(1).fill(pcode)
await ppage.getByText('连接',{exact:true}).click()
await ppage.waitForFunction(()=>location.pathname==='/', null, {timeout:20000})
await ppage.waitForTimeout(2500)
const partialBar = (await ppage.evaluate(()=>document.body.innerText)).split('\n').slice(-8).map(l=>l.trim()).filter(Boolean)
console.log('partial tab bar:', JSON.stringify(partialBar))
const partialOk = partialBar.includes('搜索') && !partialBar.includes('通知') && !partialBar.includes('自动化')
results.partialDesktop = partialOk
await partialAgent.close(); pgs.stop(true); pbs.stop(true); pgw.close()
await b.close()

const failed = Object.entries(results).filter(([, ok]) => !ok).map(([key]) => key)
console.log(`\nGATING: ${failed.length === 0 ? 'ALL PASSED' : `${failed.length} FAILED`} ${JSON.stringify(results)}`)
process.exit(failed.length === 0 ? 0 : 1)
