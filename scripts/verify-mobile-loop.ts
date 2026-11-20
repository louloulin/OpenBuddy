/**
 * Closed-loop check against a *production* build (20261117-mobile.md §8, §9.28).
 *
 * The preview build answers from `core/preview.ts`, so it can never prove the
 * real path. This script stands up a real gateway + real PiBridge, then drives
 * the production web build the way a user does:
 *
 *   pair (real form) → session list → send → desktop asks for permission
 *   → phone shows the card → tap 「允许一次」 → card clears
 *   → the host handler really received `agent_resolve_permission`
 *
 * The gateway's origin allowlist is set to the page's own origin: the phone is
 * served from one origin and the gateway on another, and a CORS refusal must
 * not be mistaken for a network problem (that mistake was a real bug).
 *
 *   NODE_ENV=production CI=1 npx expo export --platform web --output-dir /tmp/expo-prod   # in apps/mobile
 *   bun run scripts/preview-mobile-web.ts /tmp/expo-prod &        # prints {"webUrl": …}
 *   bun run scripts/verify-mobile-loop.ts <webUrl>
 *
 * Exit code 0 only when every step passed.
 */

import playwright from 'playwright-core'
import { serve } from 'bun'
import { websocket } from 'hono/bun'

import { createGateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher } from '../packages/pi-bridge/src/server.js'
const webUrl = process.argv[2]
if (!webUrl) {
  console.error('usage: bun run scripts/verify-mobile-loop.ts <webUrl>')
  process.exit(2)
}
const listeners = new Set(); const seen = []
const dispatcher: HostDispatcher = {
  dispatch: async (cmd, payload) => {
    seen.push(cmd)
    switch(cmd){
      case 'agent_init': return { ok:true, cwd:'/tmp/work' }
      case 'agent_list_workspaces': return [{ cwd:'/tmp/work', sessionCount:1 }]
      case 'agent_list_sessions': return [{ sessionId:'s1', title:'闭环验证', updatedAt:new Date().toISOString(), cwd:'/tmp/work' }]
      case 'projects_snapshot': return { projects: [] }
      case 'notification_list': return []
      case 'tasks_list': return []
      case 'permission_mode_get': return { mode:'ask' }
      case 'agent_load_session': return { updates: [] }
      case 'agent_send':
        setTimeout(() => { for (const l of listeners) l('agent://permission', { requestId:'perm-loop', sessionId:'s1',
          title:'允许写入 relay.ts？', rawInput:{ path:'packages/gateway/src/relay.ts' },
          options:[{optionId:'allow-once',kind:'allow',title:'允许一次'},{optionId:'deny',kind:'deny',title:'拒绝'}] }) }, 400)
        return { promptId:'p1' }
      case 'agent_resolve_permission': return { resolved:true }
      default: return {}
    }
  },
  listen: f => { listeners.add(f); return () => listeners.delete(f) },
  servedCommands: () => ['agent_init','agent_list_workspaces','agent_list_sessions','projects_snapshot','notification_list','tasks_list','permission_mode_get','agent_load_session','agent_send','agent_resolve_permission'],
}
const bridge = createBridgeServer(dispatcher, { token:'bt' })
const bs = serve({ port:0, hostname:'127.0.0.1', fetch:(r,s)=>bridge.fetch(r,s), websocket: bridge.websocket })
const gateway = createGateway({ host:'127.0.0.1', port:0, upstreamUrl:'http://127.0.0.1:1', adminToken:'a', agentToken:'g',
  dbPath:':memory:', pairTtlMs:600000, claimLimitPerMinute:100, maxBodyBytes:2e7, allowedOrigins:[webUrl], h5Enabled:false, h5Dir:'.',
  pairAllowsSharedRoute:true, webhookAllowedHosts:[], webhookAllowCleartext:false, pushWatchIntervalMs:60000, fcmChannelId:'x', trustProxy:false })
const gs = serve({ port:0, hostname:'127.0.0.1', fetch:(r,s)=>gateway.app.fetch(r,s), websocket })
const gw = `http://127.0.0.1:${gs.port}`
const agent = createAgentClient({ gatewayUrl:gw, agentToken:'g', getLocalServerUrl:()=>`http://127.0.0.1:${bs.port}`, localAccessToken:'bt', log:()=>{} })
await new Promise(r => { const t=setInterval(()=>{ if(agent.connected()){clearInterval(t);r()} },20); setTimeout(()=>{clearInterval(t);r()},5000) })
const code = (await (await fetch(gw+'/pair/start',{method:'POST',headers:{authorization:'Bearer a','content-type':'application/json'},body:JSON.stringify({scopes:['sessions:read','sessions:write','approve']})})).json()).code
const b = await playwright.chromium.launch({ channel:'chrome' })
const p = await (await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, locale:'zh-CN' })).newPage()
await p.goto(webUrl+'/pair',{waitUntil:'load'}); await p.waitForTimeout(1200)
await p.locator('input').nth(0).fill(gw); await p.locator('input').nth(1).fill(code)
await p.getByText('连接',{exact:true}).click(); await p.waitForTimeout(3000)
console.log('1. paired ->', p.url())
await p.getByText('闭环验证').first().click(); await p.waitForTimeout(2000)
const box = p.getByPlaceholder('给 OpenBuddy 发消息…')
await box.click(); await box.fill('触发一次审批')
await p.getByLabel('发送').click(); await p.waitForTimeout(3000)
const sawCard = (await p.evaluate(()=>document.body.innerText)).includes('允许写入')
console.log('2. card:', sawCard)
const allow = p.getByLabel('允许一次')
await allow.first().click(); await p.waitForTimeout(1500)
const cleared = !(await p.evaluate(()=>document.body.innerText)).includes('允许写入')
console.log('3. cleared:', cleared)
console.log('4. host got:', seen.filter(c=>c.startsWith('agent_resolve')))
const noStray = !(await p.evaluate(()=>document.body.innerText)).includes('运行中')
console.log('5. no stray 运行中:', noStray)
const results = {
  paired: p.url().startsWith(webUrl) && !p.url().includes('/pair'),
  card: sawCard,
  cleared: cleared,
  hostReceived: seen.filter(c => c.startsWith('agent_resolve')).length > 0,
  noStrayRunning: noStray,
}
await b.close(); agent.close(); gs.stop(true); bs.stop(true); gateway.close()
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([k]) => k)
console.log(`\nLOOP VERIFY: ${failed.length === 0 ? 'ALL PASSED' : `${failed.length} FAILED`} ${JSON.stringify(results)}`)
process.exit(failed.length === 0 ? 0 : 1)
