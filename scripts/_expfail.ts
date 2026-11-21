// Export failure paths: the host refuses or truncates. The phone must explain,
// never share a half file, never show raw protocol English.
import playwright from 'playwright-core'
import { serve } from 'bun'
import { websocket } from 'hono/bun'
import { createGateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher } from '../packages/pi-bridge/src/server.js'
const webUrl = process.argv[2]
const mode = process.argv[3] ?? 'truncated'
const TRUNC = '\n\n…(已截断，仅预览前部分内容)'
const dispatcher: HostDispatcher = {
  dispatch: async (cmd) => {
    switch (cmd) {
      case 'agent_init': return { ok:true, cwd:'/tmp/w' }
      case 'agent_list_workspaces': return [{ cwd:'/tmp/w', sessionCount:1 }]
      case 'agent_list_sessions': return [{ sessionId:'s1', title:'导出失败', updatedAt:new Date().toISOString(), cwd:'/tmp/w' }]
      case 'projects_snapshot': return { projects: [] }
      case 'agent_load_session': return { updates: [] }
      case 'permission_mode_get': return { mode:'ask' }
      case 'tasks_list': return []
      case 'agent_export_jsonl':
        if (mode === 'nopath') return ''
        return '/tmp/export.jsonl'
      case 'read_text_file':
        if (mode === 'truncated') return '{"a":1}\n' + TRUNC
        throw new Error('EACCES: permission denied')
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
const p = await (await b.newContext({ viewport:{width:390,height:844}, locale:'zh-CN' })).newPage()
await p.goto(webUrl+'/pair',{waitUntil:'load'}); await p.waitForTimeout(1000)
await p.locator('input').nth(0).fill(gw); await p.locator('input').nth(1).fill(code)
await p.getByText('连接',{exact:true}).click()
await p.waitForFunction(()=>location.pathname==='/', null, {timeout:20000})
await p.waitForTimeout(1500)
await p.goto(webUrl+'/session/s1',{waitUntil:'load'}); await p.waitForTimeout(2000)
const row = p.getByText('导出会话')
if (await row.count()) { await row.first().click(); await p.waitForTimeout(2500) }
const t = await p.evaluate(()=>document.body.innerText)
const lines = t.split('\n').filter(l=>/导出|截断|失败|EACCES|电脑|稍后|重新/.test(l))
console.log('mode:', mode, '| messages:', JSON.stringify(lines.slice(-4)))
console.log('raw english leaked:', /EACCES|permission denied/.test(t))
await p.screenshot({ path:`/tmp/expfail-${mode}.png` })
await b.close(); agent.close(); gs.stop(true); bs.stop(true); gateway.close(); process.exit(0)
