/**
 * Failed approvals (20261117-mobile.md §2.4, §9.36).
 *
 * 「回答失败保留卡片并提示，不自动重试」. The store used to swallow the
 * rejection after recording it, so the caller believed the answer was accepted
 * and removed the card — the user lost the prompt *and* the reason.
 *
 * Asserts:
 *   1. the card survives a failed answer (still tappable)
 *   2. exactly one attempt was made (no auto-retry)
 *
 *   bun run scripts/verify-mobile-approval-failure.ts <webUrl>
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
let resolveCalls = 0
const dispatcher: HostDispatcher = {
  dispatch: async (cmd) => {
    switch (cmd) {
      case 'agent_init': return { ok:true, cwd:'/tmp/w' }
      case 'agent_list_workspaces': return [{ cwd:'/tmp/w', sessionCount:1 }]
      case 'agent_list_sessions': return [{ sessionId:'s1', title:'审批失败验证', updatedAt:new Date().toISOString(), cwd:'/tmp/w' }]
      case 'projects_snapshot': return { projects: [] }
      case 'agent_load_session': return { updates: [] }
      case 'permission_mode_get': return { mode:'ask' }
      case 'tasks_list': return []
      case 'agent_send':
        setTimeout(() => {
          for (const l of listeners) l('agent://permission', {
            requestId:'perm-x', sessionId:'s1', title:'允许写入 relay.ts？',
            rawInput:{ path:'packages/gateway/src/relay.ts' },
            options:[{optionId:'allow-once',kind:'allow',title:'允许一次'},{optionId:'deny',kind:'deny',title:'拒绝'}],
          })
        }, 300)
        return { promptId:'p1' }
      case 'agent_resolve_permission':
        resolveCalls += 1
        // The desktop refuses to accept the answer (request already expired).
            throw new Error('permission request expired')
      default: return {}
    }
  },
  listen: (f: Function) => { listeners.add(f); return () => listeners.delete(f) },
  servedCommands: () => ['agent_init','agent_list_workspaces','agent_list_sessions','projects_snapshot','agent_load_session','permission_mode_get','tasks_list','agent_send','agent_resolve_permission'],
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
await p.getByText('审批失败验证').first().click(); await p.waitForTimeout(2000)
const box = p.getByPlaceholder('给 OpenBuddy 发消息…')
await box.click(); await box.fill('触发审批')
await p.getByLabel('发送').click()
p.on('console', m => { if (m.text().includes('[probe]')) console.log('PROBE', m.text().slice(0,200)) })
await p.waitForFunction(()=>document.body.innerText.includes('允许写入'), null, {timeout:20000})
console.log('1. card shown:', true)
await p.getByLabel('允许一次').first().click()
await p.waitForTimeout(2000)
const t = await p.evaluate(()=>document.body.innerText)
const cardKept = t.includes('允许写入')
console.log('2. card kept after failure:', cardKept)

console.log('3. error explained:', JSON.stringify((t.match(/.*(过期|失败|错误|expired).*/) ?? [''])[0].slice(0,120)))
console.log('4. resolve attempts (no auto-retry):', resolveCalls)
await p.screenshot({ path:'/tmp/appfail.png' })
await b.close(); agent.close(); gs.stop(true); bs.stop(true); gateway.close()
const results = { cardKept, singleAttempt: resolveCalls === 1 }
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([key]) => key)
console.log(`\nAPPROVAL-FAILURE VERIFY: ${failed.length === 0 ? 'ALL PASSED' : `${failed.length} FAILED`} ${JSON.stringify({ ...results, resolveCalls })}`)
process.exit(failed.length === 0 ? 0 : 1)
