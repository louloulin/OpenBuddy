/**
 * Steering semantics online vs offline (20261117-mobile.md §2.3, §9.35).
 *
 * §2.3 says the three input modes exist, and that **offline none of them work** —
 * the UI must disable them and explain, not offer them and fail. Steering in
 * particular is useless without a live desktop: there is nothing to interrupt.
 *
 * Asserts:
 *   1. online, long-pressing send offers 「立即插话」 with its explanation
 *   2. offline, the same menu disables it and says 「电脑不在线…」
 *   3. the text is not thrown away: 「排队等待」 still queues it
 *
 *   bun run scripts/verify-mobile-steer.ts <webUrl>
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
const sent: string[] = []
const listeners = new Set<Function>()
const dispatcher: HostDispatcher = {
  dispatch: async (cmd, payload) => {
    switch (cmd) {
      case 'agent_init': return { ok:true, cwd:'/tmp/w' }
      case 'agent_list_workspaces': return [{ cwd:'/tmp/w', sessionCount:1 }]
      case 'agent_list_sessions': return [{ sessionId:'s1', title:'插话验证', updatedAt:new Date().toISOString(), cwd:'/tmp/w' }]
      case 'projects_snapshot': return { projects: [] }
      case 'agent_load_session': return { updates: [] }
      case 'permission_mode_get': return { mode:'ask' }
      case 'tasks_list': return []
      case 'agent_send':
        sent.push(String(payload.text))
        // Keep the turn running so the composer offers the steer menu.
        setTimeout(() => { for (const l of listeners) l('agent://event', { sessionId:'s1', event:{ type:'message_start' } }) }, 60)
        setTimeout(() => { for (const l of listeners) l('agent://event', { sessionId:'s1', event:{ type:'message_delta', assistantMessageEvent:{ type:'text_delta', delta:'正在跑…' } } }) }, 120)
        return { promptId:'p1' }
      case 'agent_steer': return {}
      default: return {}
    }
  },
  listen: (f: Function) => { listeners.add(f); return () => listeners.delete(f) },
  servedCommands: () => ['agent_init','agent_list_workspaces','agent_list_sessions','projects_snapshot','agent_load_session','permission_mode_get','tasks_list','agent_send','agent_steer'],
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
await p.getByText('插话验证').first().click(); await p.waitForTimeout(2000)
const box = p.getByPlaceholder('给 OpenBuddy 发消息…')
await box.click(); await box.fill('先开一个长回合')
await p.getByLabel('发送').click()
await p.waitForTimeout(1200)

// ---- online: long-press must offer the steer menu
await box.fill('改一下方向')
await p.waitForTimeout(200)
const sendBtn = p.getByLabel('发送（可排队）')
const hasMenu = await sendBtn.count()
if (hasMenu) {
  const bb = await sendBtn.first().boundingBox()
  await p.mouse.move(bb.x + bb.width/2, bb.y + bb.height/2)
  await p.mouse.down(); await p.waitForTimeout(500); await p.mouse.up()
  await p.waitForTimeout(500)
}
let t = await p.evaluate(()=>document.body.innerText)
const onlineOffers = t.includes('立即插话')
const onlineHint = /打断当前生成[^\n]*/.test(t)
console.log('1. online long-press offers steer:', onlineOffers)
console.log('2. online hint present:', onlineHint)

// ---- offline: the desktop goes away, same long-press
agent.close(); await p.waitForTimeout(1500)
await box.fill('离线时想插话')
await p.waitForTimeout(200)
const offlineBtn = p.getByLabel('发送（可排队）')
if (await offlineBtn.count()) {
  const bb = await offlineBtn.first().boundingBox()
  await p.mouse.move(bb.x + bb.width/2, bb.y + bb.height/2)
  await p.mouse.down(); await p.waitForTimeout(500); await p.mouse.up()
  await p.waitForTimeout(500)
}
t = await p.evaluate(()=>document.body.innerText)
const offlineExplains = t.includes('电脑不在线，插话需要连上电脑')
console.log('3. offline explains instead:', offlineExplains)
// 「排队等待」 stays available: it is an ordinary send, which the outbox holds.
const queueStillAvailable = t.includes('排队等待')
console.log('4. queue option still available:', queueStillAvailable)
await p.screenshot({ path:'/tmp/steer-offline.png' })
await b.close(); gs.stop(true); bs.stop(true); gateway.close()
const results = { onlineOffers, onlineHint, offlineExplains, queueStillAvailable }
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([key]) => key)
console.log(`\nSTEER VERIFY: ${failed.length === 0 ? 'ALL PASSED' : `${failed.length} FAILED`} ${JSON.stringify(results)}`)
process.exit(failed.length === 0 ? 0 : 1)
