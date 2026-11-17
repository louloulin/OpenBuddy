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
import { toSearchHits } from '../apps/mobile/src/core/files.js'
import { matchCommands, slashQuery, toSlashCommands } from '../apps/mobile/src/core/slash.js'
import { automationSavePayload, validateAutomationDraft } from '../apps/mobile/src/core/automations.js'
import { toLibrarySources } from '../apps/mobile/src/core/library.js'
import { messageMarkdown, transcriptMarkdown } from '../apps/mobile/src/core/share.js'
import { toSessionList } from '../apps/mobile/src/core/session-list.js'
import { groupSessions } from '../apps/mobile/src/core/session-actions.js'
import { toProjects } from '../apps/mobile/src/core/projects.js'
import { cleanSessionTitle, sessionActions } from '../apps/mobile/src/core/session-actions.js'
import { bumpUnread, shouldMarkUnread, totalUnread } from '../apps/mobile/src/core/unread.js'
import { parseLockSetting, shouldRelock } from '../apps/mobile/src/core/app-lock.js'
import { parseSpeakSetting, serializeSpeakSetting, shouldSpeak, speakableText } from '../apps/mobile/src/core/speech.js'
import { followUpsFor } from '../apps/mobile/src/core/follow-ups.js'
import { dispositionFor } from '../apps/mobile/src/core/turn-input.js'
import { workspaceChoices } from '../apps/mobile/src/core/new-session.js'
import { exportFilename, isTruncatedRead, jsonlEntryCount, MAX_EXPORT_BYTES } from '../apps/mobile/src/core/export.js'
import { batchSummary, toggleSelection } from '../apps/mobile/src/core/batch.js'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  const mark = condition ? 'PASS' : 'FAIL'
  if (!condition) failures += 1
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── 1. Desktop side: host handlers + bridge with a real upload sink ─────────

const engineListeners = new Set<(event: string, payload: unknown) => void>()
const sentAttachments: { text: string; attachments: unknown[] }[] = []
const resolved: { requestId: string; optionId?: unknown; reason?: unknown }[] = []
const uiAnswers: { requestId: string; sessionId?: unknown; value?: unknown; cancelled?: unknown }[] = []
const trustAnswers: { cwd: string; trusted: unknown }[] = []
const killedTasks: string[] = []
const savedMemory: { scope: string; path: string; content: string }[] = []
const navigated: string[] = []
const rewound: string[] = []
const restoredFiles: { path: string; hash: string | null }[] = []
const newSessionCalls: unknown[] = []
const sessionMeta: { op: string; sessionId: string; value: unknown }[] = []
const savedAutomations: Record<string, unknown>[] = []
const deletedAutomations: string[] = []
const deletedSessions: string[] = []
const turnQueue = { steering: [] as string[], followUp: [] as string[] }
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
      case 'agent_set_session_pinned':
        sessionMeta.push({ op: 'pin', sessionId: String(payload.sessionId), value: payload.pinned })
        return Boolean(payload.pinned)
      case 'agent_rename_session':
        sessionMeta.push({ op: 'rename', sessionId: String(payload.sessionId), value: payload.title })
        return { renamed: true }
      case 'agent_set_session_archived':
        sessionMeta.push({ op: 'archive', sessionId: String(payload.sessionId), value: payload.archived })
        return Boolean(payload.archived)
      case 'agent_delete_session':
        deletedSessions.push(String(payload.sessionId))
        return { deleted: true }
      case 'agent_get_queue':
        return { steering: [...turnQueue.steering], followUp: [...turnQueue.followUp] }
      case 'agent_follow_up':
        turnQueue.followUp.push(String(payload.text))
        return { steering: [...turnQueue.steering], followUp: [...turnQueue.followUp] }
      case 'agent_steer':
        turnQueue.steering.push(String(payload.text))
        return { steering: [...turnQueue.steering], followUp: [...turnQueue.followUp] }
      case 'agent_set_queue':
        turnQueue.steering = Array.isArray(payload.steering) ? payload.steering.map(String) : []
        turnQueue.followUp = Array.isArray(payload.followUp) ? payload.followUp.map(String) : []
        return { steering: [...turnQueue.steering], followUp: [...turnQueue.followUp] }
      case 'agent_clear_queue':
        turnQueue.steering = []
        turnQueue.followUp = []
        return { steering: [], followUp: [] }
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
        resolved.push({ requestId: String(payload.requestId ?? ''), optionId: payload.optionId, reason: payload.reason })
        return { resolved: true }
      case 'agent_resolve_ui':
        uiAnswers.push({
          requestId: String(payload.requestId ?? ''),
          sessionId: payload.sessionId,
          value: payload.value,
          cancelled: payload.cancelled,
        })
        return { resolved: true }
      case 'folder_trust_respond':
        trustAnswers.push({ cwd: String(payload.cwd ?? ''), trusted: payload.trusted })
        return { trusted: payload.trusted }
      case 'tasks_list':
        return [
          { id: 'sess-1', kind: 'bash', title: '跑测试', startedAt: Date.now() - 5_000, pending: 1, sessionId: 'sess-1' },
          { id: 'sess-2', kind: 'task', title: '另一个会话', startedAt: Date.now() - 9_000, sessionId: 'sess-2' },
        ]
      case 'task_kill':
        killedTasks.push(String(payload.taskId ?? ''))
        return { killed: true }
      case 'permission_mode_get':
        return 'ask'
      case 'agent_list_workspaces':
        return [
          { cwd: '/e2e/workspace', sessionCount: 3, lastTitle: 'App E2E session' },
          { cwd: '/e2e/other', sessionCount: 1 },
        ]
      case 'agent_fork_session':
        sessionMeta.push({ op: 'fork', sessionId: String(payload.sessionId), value: true })
        return 'sess-fork'
      case 'agent_handoff':
        sessionMeta.push({ op: 'handoff', sessionId: String(payload.sessionId), value: payload.goal })
        return { sessionId: 'sess-handoff', prompt: '## 背景接手', from: { sessionId: payload.sessionId } }
      case 'agent_compact':
        sessionMeta.push({ op: 'compact', sessionId: String(payload.sessionId), value: payload.instructions })
        return { tokensBefore: 1000, tokensAfter: 400 }
      case 'agent_export_jsonl':
        sessionMeta.push({ op: 'export', sessionId: String(payload.sessionId), value: true })
        return '/e2e/export.jsonl'
      case 'files_search':
        return {
          cwd: String(payload.cwd),
          hits: [{ path: 'src/server.ts', name: 'server.ts', size: 10, mtimeMs: 1 }],
          partial: false,
        }
      case 'commands_list':
        return [
          { name: 'compact', description: '压缩上下文', source: 'builtin' },
          { name: 'skill:review', description: '代码评审', source: 'skill' },
        ]
      case 'automations_save': {
        const input = (payload.automation ?? {}) as Record<string, unknown>
        savedAutomations.push(input)
        return { id: 'auto-e2e', ...input }
      }
      case 'automations_delete':
        deletedAutomations.push(String(payload.id))
        return { ok: true }
      case 'library_list':
        return [{ id: '/e2e/workspace/docs', kind: 'folder', label: 'docs', path: '/e2e/workspace/docs' }]
      case 'read_text_file':
        if (payload.path !== '/e2e/export.jsonl') throw new Error(`no such file ${String(payload.path)}`)
        return '{"type":"session"}\n{"type":"message"}\n'
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
    'agent_set_session_pinned', 'agent_rename_session', 'agent_set_session_archived', 'agent_delete_session',
    'agent_get_queue', 'agent_follow_up', 'agent_steer', 'agent_set_queue', 'agent_clear_queue',
    'agent_cancel', 'agent_resolve_ui', 'folder_trust_respond', 'tasks_list', 'task_kill', 'permission_mode_get',
    'agent_list_workspaces', 'agent_fork_session', 'agent_handoff', 'agent_compact',
    'agent_export_jsonl', 'read_text_file', 'files_search', 'commands_list',
    'automations_save', 'automations_delete', 'library_list',
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

await transport.invoke('agent_resolve_permission', { requestId: 'req-1', optionId: 'allow', cancelled: false })
check('approval resolves through the tunnel', resolved.some(entry => entry.requestId === 'req-1' && entry.optionId === 'allow'))

// ── 8a. Question / folder trust / tasks (v3 阶段 B) ────────────────────────

await transport.invoke('agent_resolve_ui', { requestId: 'q-1', sessionId: 'sess-1', value: 'One' })
check('a UI question answer reaches the desktop', uiAnswers.some(entry => entry.requestId === 'q-1' && entry.value === 'One'))

await transport.invoke('folder_trust_respond', { cwd: '/e2e/workspace', trusted: true })
check('folder trust reaches the desktop', trustAnswers.some(entry => entry.cwd === '/e2e/workspace' && entry.trusted === true))

const runningTasks = await transport.invoke<Array<{ id: string; sessionId?: string }>>('tasks_list', {})
check('running tasks arrive over the tunnel', Array.isArray(runningTasks) && runningTasks.length === 2)

await transport.invoke('task_kill', { taskId: 'sess-1' })
check('killing a task reaches the desktop', killedTasks.includes('sess-1'))

const mode = await transport.invoke<unknown>('permission_mode_get', {})
check('permission mode is readable', mode === 'ask')

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

// ── 8e. Session management: menu gating and the four desktop commands ──────

const manage = sessionActions({ pinned: false, archived: false }, command => canRun(capabilities, command))
check('the menu offers pin, rename, archive, delete', manage.map(action => action.key).join(',') === 'pin,rename,archive,delete')
check('titles are cleaned before they leave the phone', cleanSessionTitle('  周报 \n 改写  ') === '周报 改写')

await transport.invoke('agent_set_session_pinned', { sessionId: 'sess-1', pinned: true })
check('pinning reached the desktop', sessionMeta.some(item => item.op === 'pin' && item.sessionId === 'sess-1' && item.value === true))

await transport.invoke('agent_rename_session', { sessionId: 'sess-1', title: cleanSessionTitle('  周报 \n 改写  ')! })
check('rename reached the desktop', sessionMeta.some(item => item.op === 'rename' && item.value === '周报 改写'))

await transport.invoke('agent_set_session_archived', { sessionId: 'sess-1', archived: true })
check('archiving reached the desktop', sessionMeta.some(item => item.op === 'archive' && item.value === true))

await transport.invoke('agent_delete_session', { sessionId: 'sess-new' })
check('delete reached the desktop', deletedSessions.includes('sess-new'))

// ── 8f. Unread marks: settles elsewhere count, the open session does not ───

const unreadRows = [
  { id: 'sess-1', title: 'A', updatedAt: 1, pinned: false, archived: false, preview: '', unread: 0 },
  { id: 'sess-2', title: 'B', updatedAt: 2, pinned: false, archived: false, preview: '', unread: 2 },
]
check('a settle for another session becomes an unread mark', shouldMarkUnread('sess-2', 'sess-1') && bumpUnread(unreadRows[0]!).unread === 1)
check('the open session never collects a mark', !shouldMarkUnread('sess-1', 'sess-1'))
check('the tab badge sums the rows', totalUnread(unreadRows) === 2)

// ── 8g. App lock: grace window and stored flag ─────────────────────────────

check('a quick app switch does not demand the lock', !shouldRelock(true, Date.now() - 5_000, Date.now()))
check('a long absence relocks the app', shouldRelock(true, Date.now() - 10 * 60_000, Date.now()))
check('the stored lock flag is read strictly', parseLockSetting('1') && !parseLockSetting('0') && !parseLockSetting(null))

// ── 8h. Read-aloud: Markdown flattening, scope, stored flag ────────────────

check('code blocks become a spoken placeholder', speakableText('看：\n```ts\nx=1\n```\n完。') === '看： （代码略） 完。')
check('only the open conversation is read aloud', shouldSpeak(true, 'sess-1', 'sess-1') && !shouldSpeak(true, 'sess-1', 'sess-2'))
check('the speak setting round-trips', parseSpeakSetting(serializeSpeakSetting(true)) && !parseSpeakSetting(serializeSpeakSetting(false)))

// ── 8i. Follow-up chips: shape-aware next questions ────────────────────────

check('code answers offer code follow-ups', followUpsFor('```ts\nconst a = 1\n```')[0] === '解释这段代码')
check('risk answers offer risk follow-ups', followUpsFor('最大的风险是回滚很难。')[0] === '展开风险')
check('plain answers fall back to three generic chips', followUpsFor('可以。').join(',') === '展开细节,给出例子,总结成要点')

// ── 8j. Busy-turn input: queue by default, steer on request ────────────────

check('busy turns queue the message by default', dispositionFor(true) === 'follow_up')
check('explicit steer bypasses the queue', dispositionFor(true, true) === 'steer')
check('idle turns send immediately', dispositionFor(false) === 'send')

await transport.invoke('agent_follow_up', { sessionId: 'sess-1', text: '排队一' })
const queued = await transport.invoke<{ followUp: string[] }>('agent_get_queue', { sessionId: 'sess-1' })
check('a queued prompt is visible in the desktop queue', queued.followUp.includes('排队一'))

await transport.invoke('agent_steer', { sessionId: 'sess-1', text: '改方向' })
await transport.invoke('agent_set_queue', { sessionId: 'sess-1', steering: [], followUp: [] })
const drained = await transport.invoke<{ steering: string[]; followUp: string[] }>('agent_get_queue', { sessionId: 'sess-1' })
check('withdrawing a queue item reaches the desktop', drained.steering.length === 0 && drained.followUp.length === 0)

// ── 8k. Workspaces, fork, handoff, compact (v3 阶段 C) ─────────────────────

const workspaces = await transport.invoke<Array<{ cwd: string; sessionCount?: number }>>('agent_list_workspaces', {})
check('the desktop lists workspaces', Array.isArray(workspaces) && workspaces[0]?.cwd === '/e2e/workspace')
check('workspace choices put the current directory first', workspaceChoices('/e2e/workspace', workspaces)[0]?.detail === '桌面当前目录')

const forked = await transport.invoke<string>('agent_fork_session', { sessionId: 'sess-1' })
check('forking reaches the desktop', forked === 'sess-fork' && sessionMeta.some(item => item.op === 'fork'))

const handed = await transport.invoke<{ sessionId: string; prompt: string }>('agent_handoff', { sessionId: 'sess-1', goal: '继续压测' })
check('handoff returns a new session and a draft', handed.sessionId === 'sess-handoff' && handed.prompt.length > 0)

await transport.invoke('agent_compact', { sessionId: 'sess-1' })
check('compacting reaches the desktop', sessionMeta.some(item => item.op === 'compact' && item.sessionId === 'sess-1'))

// ── 8l. Export and multi-select (v3 C2/C4) ────────────────────────────────

const exportPath = await transport.invoke<string>('agent_export_jsonl', { sessionId: 'sess-1' })
const exportText = await transport.invoke<string>('read_text_file', { path: exportPath, maxBytes: MAX_EXPORT_BYTES })
check('the desktop writes the session JSONL', exportPath === '/e2e/export.jsonl' && sessionMeta.some(item => item.op === 'export'))
check('the export reads back as shareable text', !isTruncatedRead(exportText) && jsonlEntryCount(exportText) === 2)
check('the share filename carries the title and stamp',
  exportFilename('手机端接入设计', 'sess-1', new Date(2026, 10, 17, 9, 5)) === 'openbuddy-手机端接入设计-20261117-0905.jsonl')

await transport.invoke('agent_set_session_archived', { sessionId: 'sess-2', archived: true })
await transport.invoke('agent_set_session_archived', { sessionId: 'sess-3', archived: true })
check('batch archive reaches every session',
  ['sess-2', 'sess-3'].every(id => sessionMeta.some(item => item.op === 'archive' && item.sessionId === id && item.value === true)))

await transport.invoke('agent_delete_session', { sessionId: 'sess-2' })
await transport.invoke('agent_delete_session', { sessionId: 'sess-3' })
check('batch delete reaches every session',
  ['sess-2', 'sess-3'].every(id => deletedSessions.includes(id)))
check('selection toggles without duplicates', toggleSelection(['a', 'b'], 'a').join(',') === 'b')
check('batch summary keeps the failure count', batchSummary('已删除', { ok: ['a'], failed: [{ id: 'b', reason: 'x' }] }) === '已删除 1 个，1 个失败')
check('unknown capabilities keep every tab mounted', Object.values(visibleTabs(null)).every(Boolean))

// ── 8m. File search and slash commands (v3 D2/D4) ──────────────────────────

const searchResult = await transport.invoke<unknown>('files_search', { cwd: '/e2e/workspace', query: 'serv' })
const hitEntries = toSearchHits(searchResult, '/e2e/workspace')
check('file search returns an absolute path', hitEntries[0]?.path === '/e2e/workspace/src/server.ts')

const commandList = await transport.invoke<unknown>('commands_list', {})
const slashMenu = matchCommands(toSlashCommands(commandList), 'rev')
check('slash commands come from the desktop and filter', slashMenu[0]?.name === 'skill:review')
check('slash menu closes once an argument is typed', slashQuery('/skill:review 试一下') === null)

// ── 8n. Automation editing (v3 D3) ─────────────────────────────────────────

check('automation drafts require absolute workspaces',
  validateAutomationDraft({ name: '晨报', prompt: '整理', cwds: '/e2e/workspace' }) === null
  && validateAutomationDraft({ name: '晨报', prompt: '整理', cwds: 'relative' }) !== null)
await transport.invoke('automations_save', {
  automation: automationSavePayload({ name: '演示巡检', prompt: '检查 CI', cwds: '/e2e/workspace, /e2e/other' }),
})
check('automation save reaches the desktop',
  savedAutomations.some(item => item.name === '演示巡检' && item.cwds === '/e2e/workspace,/e2e/other'))
await transport.invoke('automations_delete', { id: 'auto-e2e' })
check('automation delete reaches the desktop', deletedAutomations.includes('auto-e2e'))

// ── 8o. Library knowledge sources (v3 D1) ──────────────────────────────────

const library = toLibrarySources(await transport.invoke<unknown>('library_list', {}))
check('library sources keep their label and path', library[0]?.label === 'docs' && library[0]?.path === '/e2e/workspace/docs')

// ── 8p. Sharing (v3 E1/E2) ─────────────────────────────────────────────────

check('a single reply shares as Markdown', messageMarkdown('assistant', '可以。') === '## OpenBuddy\n\n可以。\n')
const sharedTranscript = transcriptMarkdown({
  rows: [
    { kind: 'text', id: 'u', role: 'user', text: '问题' },
    { kind: 'text', id: 'a', role: 'assistant', text: '回答' },
  ],
  lastAssistantText: '回答',
}, 'E2E 会话')
check('the transcript shares with both roles and a title',
  sharedTranscript.includes('# E2E 会话')
  && sharedTranscript.includes('## 我\n\n问题')
  && sharedTranscript.includes('## OpenBuddy\n\n回答'))

// ── 8q. Session list normalisation and project grouping (v3 C5) ────────────

const hostRows = toSessionList([
  { sessionId: 's1', title: '甲', updatedAt: '2026-11-17T10:00:00.000Z', cwd: '/w/a', pinned: false },
  { id: 's2', title: '乙', updatedAt: 5, cwd: '/w/b' },
])
const hostS1 = hostRows.find(row => row.id === 's1')
check('the host session shape (sessionId + ISO) is normalised',
  hostS1?.updatedAt === Date.parse('2026-11-17T10:00:00.000Z') && hostS1?.cwd === '/w/a')
const projectRows = groupSessions(hostRows, false, {
  projects: toProjects({ projects: [{ id: 'p', name: '甲项目', cwd: '/w/a' }] }),
})
check('sessions fold into project sections',
  projectRows.some(row => row.kind === 'label' && row.title === '甲项目' && row.count === 1)
  && projectRows.some(row => row.kind === 'label' && row.title === 'b'))

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
