/**
 * End-to-end verification of the Expo app's logic layer
 * (20261115-mobile.md §9.1 "端到端（无 LLM）" + §9.2).
 *
 * The screens themselves are React Native, but everything they *decide* lives
 * in `apps/mobile/src/core/*` and in `GatewayTransport`. This script runs those
 * exact modules against a real gateway, a real AgentHub tunnel and the real
 * PiBridge, so the phone's behaviour is verified without a simulator:
 *
 *   pairing parse → claim → capabilities gating → transcript folding
 *   → camera upload → agent_send with the returned path → approval resolve
 *   → offline outbox flush
 *
 * Run: bun run scripts/e2e-mobile-app.ts
 */

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { serve } from 'bun'
import { websocket } from 'hono/bun'

import { createGateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher } from '../packages/pi-bridge/src/server.js'
import { GatewayTransport } from '../packages/client/src/gateway-transport.js'

import { buildPairQr, normalizeGatewayUrl, parsePairQr } from '../apps/mobile/src/core/pairing.js'
import { applyUpdate, emptyTranscript, transcriptPreview, type Transcript } from '../apps/mobile/src/core/transcript.js'
import { canRun, isMobileHost, visibleTabs, type Capabilities } from '../apps/mobile/src/core/surface.js'
import { checkUpload, compressOptions, MAX_EDGE } from '../apps/mobile/src/core/attachments.js'
import { flushOutbox } from '../apps/mobile/src/core/connection.js'
import { groupMemory, memoryPreview, validateMemoryDraft } from '../apps/mobile/src/core/memory.js'
import { branchLabel, branchTurns, checkpointAction, restoreHash, toCheckpoints, toRewindPoints } from '../apps/mobile/src/core/branches.js'
import { checkNewSession } from '../apps/mobile/src/core/new-session.js'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  const mark = condition ? 'PASS' : 'FAIL'
  if (!condition) failures += 1
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── 1. Desktop side: host handlers + bridge with a real upload sink ─────────

const engineListeners = new Set<(event: string, payload: unknown) => void>()
const sentAttachments: { text: string; attachments: unknown[] }[] = []
const resolved: { requestId: string; decision?: unknown }[] = []
const savedMemory: { scope: string; path: string; content: string }[] = []
const navigated: string[] = []
const rewound: string[] = []
const restoredFiles: { path: string; hash: string | null }[] = []
const newSessionCalls: unknown[] = []
const BRANCH_TREE = {
  sessionId: 'sess-1',
  leafId: 'leaf-2',
  turns: [
    {
      entryId: 'u1', timestamp: 1, index: 1, total: 2,
      siblings: [
        { entryId: 'v1', leafId: 'leaf-1', timestamp: 1, preview: '第一版', files: [] },
        { entryId: 'v2', leafId: 'leaf-2', timestamp: 2, preview: '第二版', files: [] },
      ],
    },
    { entryId: 'u2', timestamp: 3, index: 0, total: 1, siblings: [] },
  ],
}
const BEFORE_HASH = 'a'.repeat(64)
const AFTER_HASH = 'b'.repeat(64)
const CHECKPOINTS = [
  { id: 'ck1', path: 'src/a.ts', before: BEFORE_HASH, after: AFTER_HASH, at: 2_000, source: 'tool' },
  { id: 'ck2', path: 'src/b.ts', before: null, after: AFTER_HASH, at: 1_000, source: 'apply' },
]
const uploadDir = await mkdtemp(join(tmpdir(), 'openbuddy-uploads-'))
let uploadCount = 0

const dispatcher: HostDispatcher = {
  dispatch: async (command, payload) => {
    switch (command) {
      case 'agent_list_sessions':
        return [{ id: 'sess-1', title: 'App E2E session' }]
      case 'agent_init':
        return { ok: true, cwd: '/e2e/workspace', inbox: '/e2e/inbox', auth: { ready: true } }
      case 'agent_new_session':
        newSessionCalls.push(payload)
        return 'sess-new'
      case 'agent_load_session':
        return { updates: [] }
      case 'agent_send':
        sentAttachments.push({
          text: String(payload.text ?? ''),
          attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
        })
        setTimeout(() => {
          for (const listener of engineListeners) {
            listener('agent://event', { sessionId: 'sess-1', event: { type: 'message_start' } })
            listener('agent://event', { sessionId: 'sess-1', event: { type: 'message_delta', assistantMessageEvent: { type: 'text_delta', delta: '看' } } })
            listener('agent://event', { sessionId: 'sess-1', event: { type: 'message_delta', assistantMessageEvent: { type: 'text_delta', delta: '到了' } } })
            listener('agent://event', { sessionId: 'sess-1', event: { type: 'agent_settled' } })
          }
        }, 20)
        return { promptId: 'p1' }
      case 'agent_resolve_permission':
        resolved.push({ requestId: String(payload.requestId ?? ''), decision: payload.decision })
        return { resolved: true }
      case 'memory_list':
        return [
          { scope: 'global', path: 'MEMORY.md', content: '# 偏好\n\n- 回答用中文', size: 24 },
          { scope: 'workspace', path: 'notes//a.md', content: 'x', size: 1 },
          { scope: 'global', path: 'people/team.md', content: '- 小林负责安卓', size: 18 },
        ]
      case 'memory_get':
        return '# 偏好\n\n- 回答用中文'
      case 'agent_tree':
        return BRANCH_TREE
      case 'rewind_points':
        return [
          { entryId: 'u2', index: 1, preview: '第二条提问' },
          { entryId: 'u1', index: 0, preview: '第一条提问' },
        ]
      case 'checkpoint_list':
        return CHECKPOINTS
      case 'agent_navigate':
        navigated.push(String(payload.entryId))
        return { navigated: true, restored: [], conflicts: [] }
      case 'rewind_execute':
        rewound.push(String(payload.entryId))
        return { reverted: true }
      case 'checkpoint_restore':
        restoredFiles.push({ path: String(payload.path), hash: typeof payload.hash === 'string' ? payload.hash : null })
        return { restored: [String(payload.path)], conflicts: [] }
      case 'memory_save':
        savedMemory.push({ scope: String(payload.scope), path: String(payload.path), content: String(payload.content) })
        return { scope: payload.scope, path: payload.path, content: payload.content, size: String(payload.content).length }
      default:
        throw new Error(`unexpected command ${command}`)
    }
  },
  listen: handler => {
    engineListeners.add(handler)
    return () => engineListeners.delete(handler)
  },
  servedCommands: () => [
    'agent_list_sessions', 'agent_load_session', 'agent_send', 'agent_resolve_permission',
    'session_search', 'notification_list',
    'memory_list', 'memory_get', 'memory_save',
    'agent_tree', 'rewind_points', 'rewind_execute', 'agent_navigate', 'checkpoint_list', 'checkpoint_restore',
    'agent_init', 'agent_new_session',
    'window_minimize', // must be filtered off the mobile surface
  ],
}

const bridge = createBridgeServer(dispatcher, {
  token: 'bridge-secret',
  uploads: {
    maxBytes: 8 * 1024 * 1024,
    save: async (bytes, extension) => {
      uploadCount += 1
      const path = join(uploadDir, `upload-${uploadCount}.${extension}`)
      await Bun.write(path, bytes)
      return { path }
    },
  },
})
const bridgeServer = serve({
  idleTimeout: 120, port: 0, hostname: '127.0.0.1', fetch: bridge.app.fetch })
const bridgeUrl = `http://127.0.0.1:${bridgeServer.port}`

// ── 2. Real gateway on an ephemeral port ────────────────────────────────────

const gateway = createGateway({
  host: '127.0.0.1',
  port: 0,
  upstreamUrl: 'http://127.0.0.1:1',
  adminToken: 'e2e-admin-token',
  agentToken: 'e2e-agent-token',
  dbPath: ':memory:',
  pairTtlMs: 60_000,
  claimLimitPerMinute: 100,
  maxBodyBytes: 1024 * 1024,
  allowedOrigins: [],
  h5Enabled: false,
  h5Dir: '.',
  pairAllowsSharedRoute: true,
  webhookAllowedHosts: [],
  webhookAllowCleartext: false,
  pushWatchIntervalMs: 60_000,
  fcmChannelId: 'e2e',
  trustProxy: false,
} as Parameters<typeof createGateway>[0])

const gatewayServer = serve({
  idleTimeout: 120,
  port: 0,
  hostname: '127.0.0.1',
  fetch: (req, server) => gateway.app.fetch(req, server),
  websocket,
})
const gatewayUrl = `http://127.0.0.1:${gatewayServer.port}`

const agent = createAgentClient({
  gatewayUrl,
  agentToken: 'e2e-agent-token',
  getLocalServerUrl: () => bridgeUrl,
  localAccessToken: 'bridge-secret',
  log: () => {},
})

await new Promise<void>(resolve => {
  const timer = setInterval(() => {
    if (agent.connected()) { clearInterval(timer); resolve() }
  }, 50)
  setTimeout(() => { clearInterval(timer); resolve() }, 5000)
})
check('desktop tunnel dialled out to the gateway', agent.connected())

// ── 3. Pairing: mint, then parse the payload the phone would scan ───────────

const pairResponse = await fetch(`${gatewayUrl}/pair/start`, {
  method: 'POST',
  headers: { authorization: 'Bearer e2e-admin-token', 'content-type': 'application/json' },
  body: JSON.stringify({ scopes: ['sessions:read', 'sessions:write', 'approve'] }),
})
const pair = (await pairResponse.json()) as { code: string }

// The desktop renders this QR; the phone's parser must read it back exactly.
const qrText = buildPairQr({ gatewayUrl, code: pair.code })
const scanned = parsePairQr(qrText)
check('phone parses the desktop QR payload', scanned !== null && scanned.code === pair.code, qrText.slice(0, 60))
check('gateway address normalises to an origin', normalizeGatewayUrl(scanned!.gatewayUrl) === normalizeGatewayUrl(gatewayUrl))

const claimResponse = await fetch(`${gatewayUrl}/pair/claim`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: scanned!.code, deviceName: 'Expo E2E', platform: 'mobile' }),
})
const claim = (await claimResponse.json()) as { deviceToken: string }
check('claim mints a device token', typeof claim.deviceToken === 'string' && claim.deviceToken.startsWith('dvc_'))

// ── 4. The app's real transport, wired exactly like src/transport/index.ts ──

const transport = new GatewayTransport({
  baseUrl: `${gatewayUrl}/api`,
  token: claim.deviceToken,
  maxBackoffMs: 500,
})
await new Promise<void>(resolve => {
  const timer = setInterval(() => {
    if (transport.state() === 'open') { clearInterval(timer); resolve() }
  }, 25)
  setTimeout(() => { clearInterval(timer); resolve() }, 5000)
})
check('GatewayTransport reaches the bridge through the tunnel', transport.state() === 'open')

// ── 5. Capabilities gating, exactly as the tabs and screens decide it ───────

const capsResponse = await fetch(`${gatewayUrl}/api/capabilities`, {
  headers: { authorization: `Bearer ${claim.deviceToken}` },
})
const capabilities = (await capsResponse.json()) as Capabilities
check('the host reports itself as a mobile surface', isMobileHost(capabilities))
check('desktop-only command is not advertised', !canRun(capabilities, 'window_minimize'))
check('session commands are advertised', canRun(capabilities, 'agent_send'))
check('tabs follow the capability answer', (() => {
  const tabs = visibleTabs(capabilities)
  return tabs.sessions && tabs.search && tabs.notifications
})())

// ── 6. Transcript folding through the app's reducer ────────────────────────

let transcript: Transcript = emptyTranscript()
const unlisten = await transport.listen<{ sessionId: string; event: Record<string, unknown> }>('agent://event', payload => {
  transcript = applyUpdate(transcript, payload.event as never, payload.sessionId)
})
await new Promise(resolve => setTimeout(resolve, 120))

await transport.invoke('agent_list_sessions', {})

// ── 7. Camera path: compress policy → upload → send the returned path ──────

const compress = compressOptions(4000, 3000)
check('camera downscales the long edge before upload', compress.resize?.width === MAX_EDGE)

const picture = new Uint8Array(2048).fill(7)
const uploadResponse = await fetch(`${gatewayUrl}/api/upload`, {
  method: 'POST',
  headers: { authorization: `Bearer ${claim.deviceToken}`, 'content-type': 'image/jpeg' },
  body: picture,
})
const uploaded = (await uploadResponse.json()) as { path?: string; bytes?: number }
check('phone upload reaches the desktop bridge', uploadResponse.status === 200 && typeof uploaded.path === 'string', JSON.stringify(uploaded))
check('uploaded bytes were written on the desktop', uploaded.path ? (await readFile(uploaded.path)).byteLength === 2048 : false)

const preflight = checkUpload('image/jpeg', picture.byteLength, 0)
check('pre-flight accepts a normal camera shot', preflight.ok)

await transport.invoke('agent_send', { sessionId: 'sess-1', text: '这是什么？', attachments: [{ path: uploaded.path }] })

const settled = Date.now() + 3000
while (!transcript.rows.some(row => row.kind === 'text' && row.role === 'assistant' && row.text === '看到了') && Date.now() < settled) {
  await new Promise(resolve => setTimeout(resolve, 25))
}
check('events folded into one streaming assistant row', transcript.rows.filter(row => row.kind === 'text').length === 1, JSON.stringify(transcript.rows))
check('assistant text restored from deltas', transcript.rows.some(row => row.kind === 'text' && row.text === '看到了'))
check('settled cleared the streaming caret', !transcript.rows.some(row => row.kind === 'text' && row.streaming))
check('session list preview comes from the reducer', transcriptPreview(transcript) === '看到了')
check('attachment path arrived at the host handler', sentAttachments.some(entry => entry.attachments.length === 1 && (entry.attachments[0] as { path?: string })?.path === uploaded.path))
unlisten()

// ── 8. Approval resolve (the approve scope path) ───────────────────────────

await transport.invoke('agent_resolve_permission', { requestId: 'req-1', decision: 'allow' })
check('approval resolves through the tunnel', resolved.some(entry => entry.requestId === 'req-1' && entry.decision === 'allow'))

// ── 8b. Memory notes: list → group → edit → save back to the desktop ───────

const memoryEntries = await transport.invoke<Array<{ scope: string; path: string; content: string; size: number }>>('memory_list', {})
check('memory list arrives over the tunnel', Array.isArray(memoryEntries) && memoryEntries.length === 3)

const memoryGroups = groupMemory(memoryEntries)
check('memory groups put global first', memoryGroups[0]?.scope === 'global' && memoryGroups[1]?.scope === 'workspace')
check('global notes stay sorted by path', memoryGroups[0]?.entries.map(item => item.path).join(',') === 'MEMORY.md,people/team.md')
check('list preview skips headings and markers', memoryGroups[0]?.entries[0] ? memoryPreview(memoryGroups[0].entries[0].content) === '回答用中文' : false)

const fetched = await transport.invoke<string>('memory_get', { scope: 'global', path: 'MEMORY.md' })
check('memory_get returns the note body', fetched.includes('回答用中文'))

const draft = validateMemoryDraft('MEMORY.md', '# 偏好\n\n- 回答用中文，先给结论')
check('draft validation accepts a normal note', draft.ok)
const rejected = validateMemoryDraft('../escape.md', 'x')
check('draft validation refuses escaping paths', !rejected.ok)

await transport.invoke('memory_save', { scope: 'global', path: 'MEMORY.md', content: '# 偏好\n\n- 回答用中文，先给结论' })
check('memory_save reached the desktop', savedMemory.some(item => item.path === 'MEMORY.md' && item.content.includes('先给结论')))

// ── 8c. Branches and checkpoints: read the tree, switch, rewind, restore ───

const tree = await transport.invoke<typeof BRANCH_TREE>('agent_tree', { sessionId: 'sess-1' })
const turns = branchTurns(tree as never)
check('only multi-version turns get a row', turns.length === 1 && turns[0]!.entryId === 'u1')
check('branch row reads as position and preview', branchLabel(turns[0]!) === '2/2 · 第二版')

const points = toRewindPoints(await transport.invoke('rewind_points', { sessionId: 'sess-1' }))
check('rewind points arrive sorted by index', points.map(point => point.entryId).join(',') === 'u1,u2')

const checkpoints = toCheckpoints(await transport.invoke('checkpoint_list', { sessionId: 'sess-1' }))
check('checkpoints arrive newest first', checkpoints.map(item => item.id).join(',') === 'ck1,ck2')
check('a created file restores to absence', checkpointAction(checkpoints[1]!) === '恢复到「文件不存在」')

await transport.invoke('agent_navigate', { sessionId: 'sess-1', entryId: turns[0]!.siblings[turns[0]!.index]!.leafId })
check('switching a branch reached the desktop', navigated.includes('leaf-2'))

await transport.invoke('rewind_execute', { sessionId: 'sess-1', entryId: points[0]!.entryId })
check('rewind reached the desktop', rewound.includes('u1'))

await transport.invoke('checkpoint_restore', { sessionId: 'sess-1', path: 'src/a.ts', hash: restoreHash(checkpoints[0]!) })
check('restore sent the pre-write hash', restoredFiles.some(item => item.path === 'src/a.ts' && item.hash === BEFORE_HASH))

// ── 8d. Starting a task from the phone (new session) ───────────────────────

const init = await transport.invoke<{ ok: boolean; cwd: string }>('agent_init', {})
const ready = checkNewSession(init)
check('the phone learns the desktop working directory', ready.ok && ready.cwd === '/e2e/workspace')

const createdId = ready.ok ? await transport.invoke<string>('agent_new_session', { cwd: ready.cwd }) : ''
check('the phone can start a session on the desktop', createdId === 'sess-new')
check('the desktop received the chosen directory', JSON.stringify(newSessionCalls[0]) === JSON.stringify({ cwd: '/e2e/workspace' }))

// ── 9. Offline outbox: FIFO, stops on failure, resumes in order ────────────

const offline = [
  { id: 'a', sessionId: 'sess-1', text: '一', attachments: [], queuedAt: 1 },
  { id: 'b', sessionId: 'sess-1', text: '二', attachments: [], queuedAt: 2 },
  { id: 'c', sessionId: 'sess-1', text: '三', attachments: [], queuedAt: 3 },
]
const firstAttempt = await flushOutbox(offline, async item => {
  if (item.id === 'b') throw new Error('still offline')
})
check('outbox stops at the first failure', firstAttempt.sent === 1 && firstAttempt.remaining.map(i => i.id).join(',') === 'b,c')

const order: string[] = []
const secondAttempt = await flushOutbox(firstAttempt.remaining, async item => {
  order.push(item.id)
  await transport.invoke('agent_send', { sessionId: item.sessionId, text: item.text })
})
check('outbox flushes the rest in order over the real tunnel', secondAttempt.sent === 2 && order.join(',') === 'b,c')
check('every queued message reached the host', sentAttachments.filter(entry => entry.text === '二' || entry.text === '三').length === 2)

// ── Cleanup ─────────────────────────────────────────────────────────────────

transport.close()
agent.close()
gatewayServer.stop(true)
bridgeServer.stop(true)
gateway.close()

console.log(failures === 0 ? '\nAPP E2E: ALL CHECKS PASSED' : `\nAPP E2E: ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
