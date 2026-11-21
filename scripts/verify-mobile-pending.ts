/**
 * Recovering an approval card the phone missed (20261117-mobile.md §2.4 path 3, §9.37).
 *
 * The event stream only carries requests that happen *while connected*. A
 * permission request raised while the app was backgrounded never reaches the
 * listener, and before `permission_pending` the phone could only show a card it
 * had already received — the request was simply invisible.
 *
 * This script stands up a real gateway + real PiBridge, drives the real web
 * build, and simulates exactly that window:
 *
 *   1. pair → open the conversation (no card yet)
 *   2. the desktop starts waiting on a permission WITHOUT emitting an event
 *   3. background → foreground (AppState 'active' → store.resume())
 *   4. the card appears, recovered through `permission_pending`
 *   5. answering it reaches the host as `agent_resolve_permission` for the same id
 *
 *   cd apps/mobile && npx expo export --platform web --output-dir /tmp/expo-pending
 *   bun run scripts/verify-mobile-pending.ts /tmp/expo-pending
 *
 * Exit code 0 only when every assertion held.
 */
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

import { serve } from 'bun'
import { websocket } from 'hono/bun'
import playwright from 'playwright-core'

import { createGateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher } from '../packages/pi-bridge/src/server.js'

const webDir = resolve(process.argv[2] ?? '/tmp/expo-pending')
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
}
const web = serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)
    const path = normalize(decodeURIComponent(url.pathname))
    const candidate = resolve(join(webDir, path === '/' ? 'index.html' : path))
    if (!candidate.startsWith(webDir)) return new Response('forbidden', { status: 403 })
    try {
      const file = await readFile(candidate)
      return new Response(file, {
        headers: {
          'content-type': MIME[extname(candidate)] ?? 'application/octet-stream',
          // expo-sqlite's web build needs cross-origin isolation.
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'require-corp',
          'cache-control': 'no-store',
        },
      })
    } catch {
      // SPA fallback: expo-router owns the paths.
      const index = await readFile(join(webDir, 'index.html'))
      return new Response(index, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'require-corp',
          'cache-control': 'no-store',
        },
      })
    }
  },
})
const webUrl = `http://127.0.0.1:${web.port}`

const listeners = new Set<Function>()
const resolved: { requestId?: string }[] = []
const questionResolved: { requestId?: string; sessionId?: string; value?: unknown }[] = []
const trustResolved: { cwd?: string; trusted?: boolean }[] = []
/** The workspace the phone passed to `memory_list` (project memory is cwd-scoped). */
let lastMemoryCwd: string | undefined
/** The workspace the phone passed to `agents_list` (experts are cwd-scoped). */
let lastAgentsCwd: string | undefined
/** The desktop's pending cards, keyed by requestId, as the real host keeps them. */
const pending = new Map<string, Record<string, unknown>>()
const pendingQuestions = new Map<string, Record<string, unknown>>()
const pendingTrust = new Map<string, Record<string, unknown>>()
const REQUEST = {
  requestId: 'perm-pending-1',
  sessionId: 's1',
  toolCallId: 'call-9',
  toolKind: 'bash',
  title: 'bash',
  rawInput: { command: 'rm -rf build' },
  options: [
    { optionId: 'allow', kind: 'allow_once', title: '允许本次' },
    { optionId: 'deny', kind: 'reject_once', title: '拒绝' },
  ],
}
const QUESTION = {
  requestId: 'q-pending-1',
  sessionId: 's1',
  kind: 'select',
  title: '选哪种压测？',
  options: ['100 并发', '500 并发'],
  message: '桌面在等你回答。',
}
const TRUST = { cwd: '/tmp/w', sessionId: 's1' }
/** A card the desktop answers on its side while the phone is not looking. */
const STALE = {
  requestId: 'perm-stale-1',
  sessionId: 's1',
  toolCallId: 'call-10',
  toolKind: 'bash',
  title: 'bash',
  rawInput: { command: 'rm -rf dist' },
  options: [
    { optionId: 'allow', kind: 'allow_once', title: '允许本次' },
    { optionId: 'deny', kind: 'reject_once', title: '拒绝' },
  ],
}
/** A card present on a cold launch (push tap is the app's first screen). */
const COLD = {
  requestId: 'perm-cold-1',
  sessionId: 's1',
  toolCallId: 'call-11',
  toolKind: 'bash',
  title: 'bash',
  rawInput: { command: 'rm -rf tmp' },
  options: [
    { optionId: 'allow', kind: 'allow_once', title: '允许本次' },
    { optionId: 'deny', kind: 'reject_once', title: '拒绝' },
  ],
}
/** Read-only rules the panel must display (permission_list). */
const RULES = [
  { action: 'allow', tool: 'bash', pattern: 'git ' },
  { action: 'deny', tool: 'any', pattern: 'rm -rf' },
]
const SKILLS = [
  { name: 'pdf', displayName: 'PDF 助手', description: '读、填、合并 PDF', scope: 'user', enabled: true, market: true },
  { name: 'repo-review', description: '按仓库规范检查改动', scope: 'repo', enabled: true, market: false },
]
const PROMPTS = [
  { name: 'summary', description: '总结这一段对话', scope: 'global', argumentHint: '<范围>' },
]

const dispatcher: HostDispatcher = {
  dispatch: async (cmd, payload) => {
    switch (cmd) {
      case 'agent_init': return { ok: true, cwd: '/tmp/w' }
      case 'agent_list_workspaces': return [{ cwd: '/tmp/w', sessionCount: 1 }]
      case 'agent_list_sessions': return [{ sessionId: 's1', title: '补卡验证', updatedAt: new Date().toISOString(), cwd: '/tmp/w' }]
      case 'projects_snapshot': return { projects: [] }
      case 'notification_list': return []
      case 'notification_prefs_get': return { system: true }
      case 'tasks_list': return []
      case 'permission_mode_get': return { mode: 'ask' }
      case 'permission_list': return RULES
      case 'skills_list': return SKILLS
      case 'prompts_list': return PROMPTS
      case 'memory_list': lastMemoryCwd = typeof payload?.cwd === 'string' ? payload.cwd : undefined; return []
      case 'agents_list': lastAgentsCwd = typeof payload?.cwd === 'string' ? payload.cwd : undefined; return []
      case 'read_text_file': return '# 验证文件搜索\n\n这是冷启动深链打开的笔记。'
      case 'list_dir': return []
      case 'agent_load_session':
        return { updates: [{ type: 'message_end', sessionId: 's1', message: { role: 'user', content: '冷启动历史消息' } }] }
      case 'permission_pending': {
        const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : undefined
        const requests = [...pending.values()].filter(request => !sessionId || request.sessionId === sessionId)
        return { requests }
      }
      case 'question_pending': {
        const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : undefined
        const requests = [...pendingQuestions.values()].filter(request => !sessionId || request.sessionId === sessionId)
        return { requests }
      }
      case 'trust_pending': {
        const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : undefined
        const requests = [...pendingTrust.values()].filter(request => !sessionId || request.sessionId === sessionId)
        return { requests }
      }
      case 'folder_trust_respond': {
        trustResolved.push({
          cwd: typeof payload?.cwd === 'string' ? payload.cwd : undefined,
          trusted: typeof payload?.trusted === 'boolean' ? payload.trusted : undefined,
        })
        for (const [id, request] of pendingTrust) if (request.cwd === payload?.cwd) pendingTrust.delete(id)
        return { ok: true }
      }
      case 'agent_resolve_permission': {
        resolved.push({ requestId: typeof payload?.requestId === 'string' ? payload.requestId : undefined })
        // A real host removes the card once answered.
        if (typeof payload?.requestId === 'string') pending.delete(payload.requestId)
        return { resolved: true }
      }
      case 'agent_resolve_ui': {
        questionResolved.push({
          requestId: typeof payload?.requestId === 'string' ? payload.requestId : undefined,
          sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : undefined,
          value: payload?.value,
        })
        if (typeof payload?.requestId === 'string') pendingQuestions.delete(payload.requestId)
        return { resolved: true }
      }
      default: return {}
    }
  },
  listen: (f: Function) => { listeners.add(f); return () => listeners.delete(f) },
  servedCommands: () => [
    'agent_init', 'agent_list_workspaces', 'agent_list_sessions', 'projects_snapshot',
    'notification_list', 'notification_prefs_get', 'tasks_list', 'permission_mode_get', 'permission_list',
    'skills_list', 'prompts_list', 'memory_list', 'agents_list', 'read_text_file', 'list_dir', 'agent_load_session',
    'permission_pending', 'question_pending', 'trust_pending',
    'agent_resolve_permission', 'agent_resolve_ui', 'folder_trust_respond',
  ],
}

const bridge = createBridgeServer(dispatcher, { token: 'bt' })
const bs = serve({ port: 0, hostname: '127.0.0.1', fetch: (r, s) => bridge.fetch(r, s), websocket: bridge.websocket as never })
const gateway = createGateway({
  host: '127.0.0.1', port: 0, upstreamUrl: 'http://127.0.0.1:1', adminToken: 'a', agentToken: 'g',
  dbPath: ':memory:', pairTtlMs: 600000, claimLimitPerMinute: 100, maxBodyBytes: 2e7, allowedOrigins: [webUrl],
  h5Enabled: false, h5Dir: '.', pairAllowsSharedRoute: true, webhookAllowedHosts: [], webhookAllowCleartext: false,
  pushWatchIntervalMs: 60000, fcmChannelId: 'x', trustProxy: false,
})
const gs = serve({ port: 0, hostname: '127.0.0.1', fetch: (r, s) => gateway.app.fetch(r, s), websocket })
const gw = `http://127.0.0.1:${gs.port}`
const agent = createAgentClient({
  gatewayUrl: gw, agentToken: 'g', getLocalServerUrl: () => `http://127.0.0.1:${bs.port}`, localAccessToken: 'bt', log: () => {},
})
await new Promise<void>(r => { const t = setInterval(() => { if (agent.connected()) { clearInterval(t); r() } }, 20); setTimeout(() => { clearInterval(t); r() }, 5000) })
const code = (await (await fetch(gw + '/pair/start', {
  method: 'POST', headers: { authorization: 'Bearer a', 'content-type': 'application/json' },
  body: JSON.stringify({ scopes: ['sessions:read', 'sessions:write', 'approve'] }),
})).json()).code

const browser = await playwright.chromium.launch({ channel: 'chrome' })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-CN' })).newPage()
page.on('pageerror', error => console.log('PAGE ERROR', error.message))

await page.goto(webUrl + '/pair', { waitUntil: 'load' })
await page.waitForTimeout(1000)
await page.locator('input').nth(0).fill(gw)
await page.locator('input').nth(1).fill(code)
await page.getByText('连接', { exact: true }).click()
await page.waitForFunction(() => location.pathname === '/', null, { timeout: 20000 })
await page.waitForTimeout(1500)
await page.getByText('补卡验证').first().click()
await page.waitForTimeout(1500)

const text = () => page.evaluate(() => document.body.innerText)
const before = (await text()).includes('rm -rf build')
  || (await text()).includes('选哪种压测')
  || (await text()).includes('信任这个文件夹')
console.log('1. no card before background:', !before)

// The desktop starts waiting, but no event is emitted: this is the gap the
// event stream cannot cover. All three blocking-card flavours are covered —
// a tool approval, an extension question, and an untrusted folder.
pending.set(REQUEST.requestId, REQUEST)
pendingQuestions.set(QUESTION.requestId, QUESTION)
pendingTrust.set(`${TRUST.cwd}:${TRUST.sessionId}`, TRUST)

// Simulate AppState background → active (react-native-web reads
// document.visibilityState on `visibilitychange`).
await page.evaluate(() => {
  let state = 'hidden'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  ;(window as unknown as { __setVisible: () => void }).__setVisible = () => {
    state = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
  }
  document.dispatchEvent(new Event('visibilitychange'))
})
await page.waitForTimeout(300)
await page.evaluate(() => (window as unknown as { __setVisible: () => void }).__setVisible())

let recovered = false
try {
  await page.waitForFunction(
    () => document.body.innerText.includes('rm -rf build')
      && document.body.innerText.includes('选哪种压测')
      && document.body.innerText.includes('信任这个文件夹'),
    null,
    { timeout: 15000 },
  )
  recovered = true
} catch { recovered = false }
console.log('2. permission + question + trust cards recovered on resume:', recovered)
await page.screenshot({ path: '/tmp/mobile-pending-card.png' })

// A recovered card must be discoverable from the session list too: the user
// may not be reading that conversation.
let badgeShown = false
const backButton = page.getByLabel('返回').first()
if ((await backButton.count()) > 0) await backButton.click()
await page.waitForTimeout(800)
try {
  await page.waitForFunction(
    () => location.pathname === '/' && document.body.innerText.includes('待审批'),
    null,
    { timeout: 6000 },
  )
  badgeShown = true
} catch { badgeShown = false }
console.log('3. session list badges the waiting conversation:', badgeShown)
await page.screenshot({ path: '/tmp/mobile-pending-badge.png' })
await page.getByText('补卡验证').first().click()
await page.waitForTimeout(800)

const allow = page.getByLabel('允许本次').first()
const canAnswer = (await allow.count()) > 0
if (canAnswer) await allow.click()
const choice = page.getByText('100 并发', { exact: true }).first()
const canChoose = (await choice.count()) > 0
if (canChoose) await choice.click()
const trust = page.getByText('信任此文件夹', { exact: true }).first()
const canTrust = (await trust.count()) > 0
if (canTrust) await trust.click()
await page.waitForTimeout(1500)
const hostGot = resolved.length === 1 && resolved[0]?.requestId === REQUEST.requestId
const questionGot = questionResolved.length === 1
  && questionResolved[0]?.requestId === QUESTION.requestId
  && questionResolved[0]?.value === '100 并发'
const trustGot = trustResolved.length === 1
  && trustResolved[0]?.cwd === TRUST.cwd
  && trustResolved[0]?.trusted === true
console.log('4. host received the recovered permission answer:', hostGot, JSON.stringify(resolved))
console.log('5. host received the recovered question answer:', questionGot, JSON.stringify(questionResolved))
console.log('6. host received the recovered trust answer:', trustGot, JSON.stringify(trustResolved))
await page.screenshot({ path: '/tmp/mobile-pending-recovered.png' })

// Stale cleanup: the desktop answers a request on its side while the phone is
// away. A later resume must drop the card (and its list badge), not keep it
// forever. The grace window keeps a just-arrived live event safe.
pending.set(STALE.requestId, STALE)
await page.evaluate(() => (window as unknown as { __setVisible: () => void }).__setVisible())
let staleRecovered = false
try {
  await page.waitForFunction(() => document.body.innerText.includes('rm -rf dist'), null, { timeout: 10000 })
  staleRecovered = true
} catch { staleRecovered = false }
pending.delete(STALE.requestId)
await page.waitForTimeout(3200)
await page.evaluate(() => (window as unknown as { __setVisible: () => void }).__setVisible())
let staleCleared = false
try {
  await page.waitForFunction(() => !document.body.innerText.includes('rm -rf dist'), null, { timeout: 10000 })
  staleCleared = true
} catch { staleCleared = false }
console.log('7. stale card recovered:', staleRecovered)
console.log('8. stale card cleared after the desktop handled it:', staleCleared)

// Read-only permission rules on the session panel (§4 P1). The phone never
// edits these; it must at least show what the desktop will apply.
await page.goto(webUrl + '/session/s1', { waitUntil: 'load' })
let rulesShown = false
try {
  await page.waitForFunction(
    () => document.body.innerText.includes('允许 bash') && document.body.innerText.includes('拒绝 any'),
    null,
    { timeout: 8000 },
  )
  rulesShown = true
} catch { rulesShown = false }
console.log('9. permission rules shown read-only:', rulesShown)
await page.screenshot({ path: '/tmp/mobile-session-rules.png' })
const agentsDeadline = Date.now() + 4000
while (!lastAgentsCwd && Date.now() < agentsDeadline) await new Promise(resolve => setTimeout(resolve, 100))
const agentsCwd = lastAgentsCwd === '/tmp/w'
console.log('9b. experts list carries the session workspace:', agentsCwd, lastAgentsCwd)

// Skills and prompt templates are read-only too (§4 P2).
await page.goto(webUrl + '/skills', { waitUntil: 'load' })
let skillsShown = false
try {
  await page.waitForFunction(
    () => document.body.innerText.includes('PDF 助手') && document.body.innerText.includes('/summary'),
    null,
    { timeout: 8000 },
  )
  skillsShown = true
} catch { skillsShown = false }
console.log('10. skills & prompts shown read-only:', skillsShown)
await page.screenshot({ path: '/tmp/mobile-skills.png' })

// Project memory is workspace-scoped: the phone must send the workspace it
// listed, not let the desktop fall back to whatever session is focused.
await page.goto(webUrl + '/memory', { waitUntil: 'load' })
const deadline = Date.now() + 8000
while (!lastMemoryCwd && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
const memoryCwd = lastMemoryCwd === '/tmp/w'
console.log('11. memory list carries the workspace cwd:', memoryCwd, lastMemoryCwd)

// Cold start from a push deep link: no event has ever reached this page, so it
// must actively pull the pending card (bootstrap + the page itself both do).
pending.set(COLD.requestId, COLD)
await page.goto(webUrl + '/approval/' + COLD.requestId, { waitUntil: 'load' })
let coldShown = false
try {
  await page.waitForFunction(() => document.body.innerText.includes('rm -rf tmp'), null, { timeout: 12000 })
  coldShown = true
} catch { coldShown = false }
console.log('12. cold-start approval deep link shows the pending card:', coldShown)
await page.screenshot({ path: '/tmp/mobile-approval-cold.png' })

// Cold start straight at a file preview (artifact link): openFile must retry
// once the tunnel arrives instead of leaving a blank preview.
await page.goto(webUrl + '/files?sessionId=s1&file=' + encodeURIComponent('/tmp/w/notes.md'), { waitUntil: 'load' })
let coldFileShown = false
try {
  await page.waitForFunction(() => document.body.innerText.includes('这是冷启动深链打开的笔记'), null, { timeout: 12000 })
  coldFileShown = true
} catch { coldFileShown = false }
console.log('13. cold-start file preview deep link renders:', coldFileShown)

// Cold start straight into a conversation (a notification without requestId):
// the first openSession runs before the tunnel exists, so it must retry once
// the tunnel is up or the transcript stays empty.
await page.goto(webUrl + '/chat/s1', { waitUntil: 'load' })
let coldChatShown = false
try {
  await page.waitForFunction(() => document.body.innerText.includes('冷启动历史消息'), null, { timeout: 12000 })
  coldChatShown = true
} catch { coldChatShown = false }
console.log('14. cold-start chat deep link loads history:', coldChatShown)

// Notification preferences are read-only (§5 Tab 3 后续): system switch state.
await page.goto(webUrl + '/notifications', { waitUntil: 'load' })
let prefsShown = false
try {
  await page.waitForFunction(() => document.body.innerText.includes('系统通知'), null, { timeout: 10000 })
  prefsShown = true
} catch { prefsShown = false }
console.log('15. notification preferences shown read-only:', prefsShown)

await browser.close(); agent.close(); gs.stop(true); bs.stop(true); gateway.close(); web.stop(true)

const results = { noCardBefore: !before, recovered, badgeShown, hostGot, questionGot, trustGot, staleRecovered, staleCleared, rulesShown, agentsCwd, skillsShown, memoryCwd, coldShown, coldFileShown, coldChatShown, prefsShown }
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([key]) => key)
console.log(`\nPENDING VERIFY: ${failed.length === 0 ? 'ALL PASSED' : `${failed.length} FAILED`} ${JSON.stringify(results)}`)
process.exit(failed.length === 0 ? 0 : 1)
