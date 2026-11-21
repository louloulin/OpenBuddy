/**
 * Session export, end to end (20261117-mobile.md §2.2, §9.38).
 *
 * The desktop owns the transcript: `agent_export_jsonl` writes a file on the
 * desktop, and the phone reads it back with `read_text_file`. This proves the
 * round trip rather than the UI alone:
 *
 *   1. the phone asked to read exactly the path the desktop returned
 *   2. the record count matches the file's JSONL lines
 *
 *   bun run scripts/verify-mobile-export.ts <webUrl>
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
const EXPORT_PATH = '/tmp/openbuddy-export-test.jsonl'
const EXPORT_BODY = [
  '{"type":"session","version":3,"id":"s1"}',
  '{"type":"message","role":"user","content":"导出验证"}',
  '{"type":"message","role":"assistant","content":"可以了"}',
].join('\n') + '\n'
let readPath = ''
const dispatcher: HostDispatcher = {
  dispatch: async (cmd, payload) => {
    switch (cmd) {
      case 'agent_init': return { ok:true, cwd:'/tmp/w' }
      case 'agent_list_workspaces': return [{ cwd:'/tmp/w', sessionCount:1 }]
      case 'agent_list_sessions': return [{ sessionId:'s1', title:'导出验证', updatedAt:new Date().toISOString(), cwd:'/tmp/w' }]
      case 'projects_snapshot': return { projects: [] }
      case 'agent_load_session': return { updates: [] }
      case 'permission_mode_get': return { mode:'ask' }
      case 'tasks_list': return []
      case 'agent_export_jsonl': return EXPORT_PATH
      case 'read_text_file':
        readPath = String(payload.path)
        return EXPORT_BODY
      default: return {}
    }
  },
  listen: () => () => {},
  servedCommands: () => ['agent_init','agent_list_workspaces','agent_list_sessions','projects_snapshot','agent_load_session','permission_mode_get','tasks_list','agent_export_jsonl','read_text_file'],
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
const p = await (await b.newContext({ viewport:{width:390,height:844}, locale:'zh-CN', acceptDownloads:true })).newPage()
await p.goto(webUrl+'/pair',{waitUntil:'load'}); await p.waitForTimeout(1000)
await p.locator('input').nth(0).fill(gw); await p.locator('input').nth(1).fill(code)
await p.getByText('连接',{exact:true}).click()
await p.waitForFunction(()=>location.pathname==='/', null, {timeout:20000})
await p.waitForTimeout(1500)
// The export lives in the session panel; open the conversation first.
await p.goto(webUrl+'/chat/s1',{waitUntil:'load'})
await p.waitForFunction(()=>document.querySelector('textarea')!==null, null, {timeout:20000})
await p.waitForTimeout(1500)
await p.getByLabel(/打开会话设置/).first().click().catch(async () => {
  await p.getByText('导出验证').first().click()
})
await p.waitForTimeout(2000)
const exportRow = p.getByText('导出会话')
if (await exportRow.count()) {
  await exportRow.first().click()
  await p.waitForTimeout(2500)
}
const t = await p.evaluate(()=>document.body.innerText)
const readRight = readPath === EXPORT_PATH
console.log('1. export read the desktop path:', readRight, '|', readPath)
const countMatch = t.match(/(\d+)\s*条记录/)
const counted = countMatch ? Number(countMatch[1]) : 0
const expected = EXPORT_BODY.trim().split('\n').length
console.log('2. entry count:', counted, '(expected', expected + ')')
await p.screenshot({ path:'/tmp/export.png' })
await b.close(); agent.close(); gs.stop(true); bs.stop(true); gateway.close()
const results = { readRight, countMatches: counted === expected }
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([key]) => key)
console.log(`\nEXPORT VERIFY: ${failed.length === 0 ? 'ALL PASSED' : `${failed.length} FAILED`} ${JSON.stringify(results)}`)
process.exit(failed.length === 0 ? 0 : 1)
