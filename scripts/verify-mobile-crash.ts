/**
 * Desktop-crash recovery (20261117-mobile.md §2.5, §9.32).
 *
 * The supervising phone must never claim work is happening when the machine
 * doing it is gone. This stands up a desktop that starts a turn and then dies
 * mid-stream (the tunnel drops), and requires:
 *
 *   1. the partial answer stays visible (nothing is thrown away)
 *   2. the streaming caret stops
 *   3. one system line explains that the turn did not finish
 *
 * Before this check, the caret blinked forever and the screen said nothing:
 * the client tolerated 70s of silence while the bridge pings every 5s.
 *
 *   bun run scripts/verify-mobile-crash.ts <webUrl>
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
    if (cmd === 'agent_init') return { ok:true, cwd:'/tmp/w' }
    if (cmd === 'agent_list_workspaces') return [{ cwd:'/tmp/w', sessionCount:1 }]
    if (cmd === 'agent_list_sessions') return [{ sessionId:'s1', title:'崩溃验证', updatedAt:new Date().toISOString(), cwd:'/tmp/w' }]
    if (cmd === 'projects_snapshot') return { projects: [] }
    if (cmd === 'agent_load_session') return { updates: [] }
    if (cmd === 'permission_mode_get') return { mode:'ask' }
    if (cmd === 'tasks_list') return []
    if (cmd === 'agent_send') {
      // Start a turn, emit one delta, then go silent (the desktop process dies).
      setTimeout(() => { for (const l of listeners) l('agent://event', { sessionId:'s1', event:{ type:'message_start' } }) }, 50)
      setTimeout(() => { for (const l of listeners) l('agent://event', { sessionId:'s1', event:{ type:'message_delta', assistantMessageEvent:{ type:'text_delta', delta:'正在处理' } } }) }, 150)
      return { promptId:'p1' }
    }
    return {}
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
await p.getByText('崩溃验证').first().click(); await p.waitForTimeout(2000)
const box = p.getByPlaceholder('给 OpenBuddy 发消息…')
await box.click(); await box.fill('开始一个会崩的回合')
await p.getByLabel('发送').click()
await p.waitForTimeout(1500)
const midTurn = (await p.evaluate(()=>document.body.innerText)).includes('正在处理')
console.log('1. mid-turn text:', midTurn)
// The desktop process dies: the tunnel drops.
agent.close(); bs.stop(true)
await p.waitForTimeout(6000)
const t = await p.evaluate(()=>document.body.innerText)
const banner = t.split('\n').filter(l=>/断开|重连|失败|错误/.test(l))
console.log('2. notice:', JSON.stringify(banner.slice(0,2)))
const caret = t.includes('▍')
console.log('3. still shows streaming caret:', caret)
await p.screenshot({ path:'/tmp/crash.png' })
await b.close(); gs.stop(true); gateway.close()
const results = {
  partialAnswerKept: midTurn && t.includes('正在处理'),
  caretStopped: !caret,
  explained: banner.some(line => /没有收尾|断开/.test(line)),
}
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([key]) => key)
console.log(`\nCRASH VERIFY: ${failed.length === 0 ? 'ALL PASSED' : `${failed.length} FAILED`} ${JSON.stringify(results)}`)
process.exit(failed.length === 0 ? 0 : 1)
