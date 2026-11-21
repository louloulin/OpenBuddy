/**
 * Terminal turn errors (20261117-mobile.md §2.2, §9.34).
 *
 * The engine emits `agent://turn-error` after the SDK settles when a turn ended
 * in a terminal failure, and the bridge forwards it. The phone used to ignore
 * it entirely: the user saw a truncated answer, **no error at all**, and a fresh
 * set of follow-up chips inviting them to continue a conversation that had
 * failed.
 *
 * Asserts:
 *   1. the partial answer stays (nothing is thrown away)
 *   2. the failure is visible
 *   3. the wording is actionable Chinese, not `401 invalid api key`
 *   4. no follow-up chips on a failed turn
 *
 *   bun run scripts/verify-mobile-turn-error.ts <webUrl>
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
const listeners = new Set<Function>()
const dispatcher: HostDispatcher = {
  dispatch: async (cmd) => {
    switch (cmd) {
      case 'agent_init': return { ok:true, cwd:'/tmp/w' }
      case 'agent_list_workspaces': return [{ cwd:'/tmp/w', sessionCount:1 }]
      case 'agent_list_sessions': return [{ sessionId:'s1', title:'失败验证', updatedAt:new Date().toISOString(), cwd:'/tmp/w' }]
      case 'projects_snapshot': return { projects: [] }
      case 'agent_load_session': return { updates: [] }
      case 'permission_mode_get': return { mode:'ask' }
      case 'tasks_list': return []
      case 'agent_send':
        // Exactly what the engine does for a terminal failure: a partial answer,
        // then settle, then the named error.
        setTimeout(() => {
          for (const l of listeners) l('agent://event', { sessionId:'s1', event:{ type:'message_delta', assistantMessageEvent:{ type:'text_delta', delta:'先看一下' } } })
        }, 60)
        setTimeout(() => {
          for (const l of listeners) l('agent://event', { sessionId:'s1', event:{ type:'agent_settled' } })
          for (const l of listeners) l('agent://turn-error', { sessionId:'s1', kind:'error', detail:'模型请求失败：401 invalid api key' })
        }, 400)
        return { promptId:'p1' }
      default: return {}
    }
  },
  listen: (f: Function) => { listeners.add(f); return () => listeners.delete(f) },
  servedCommands: () => ['agent_init','agent_list_workspaces','agent_list_sessions','projects_snapshot','agent_load_session','permission_mode_get','tasks_list','agent_send'],
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
await p.getByText('失败验证').first().click(); await p.waitForTimeout(2000)
const box = p.getByPlaceholder('给 OpenBuddy 发消息…')
await box.click(); await box.fill('跑一个会失败的回合')
await p.getByLabel('发送').click()
await p.waitForTimeout(4000)
const t = await p.evaluate(()=>document.body.innerText)
const keptPartial = t.includes('先看一下')
console.log('1. partial answer kept:', keptPartial)
const surfaced = /这一轮没有成功/.test(t)
console.log('2. error surfaced:', surfaced)
const actionable = /API Key|凭证/.test(t) && !/invalid api key/i.test(t)
console.log('3. wording actionable (no raw English):', actionable)
const noChips = !/展开细节|给出例子|总结成要点/.test(t)
console.log('4. follow-up chips suppressed:', noChips)
await p.screenshot({ path:'/tmp/turnerr.png' })
await b.close(); agent.close(); gs.stop(true); bs.stop(true); gateway.close()
const results = { keptPartial, surfaced, actionable, noChips }
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([key]) => key)
console.log(`\nTURN-ERROR VERIFY: ${failed.length === 0 ? 'ALL PASSED' : `${failed.length} FAILED`} ${JSON.stringify(results)}`)
process.exit(failed.length === 0 ? 0 : 1)
