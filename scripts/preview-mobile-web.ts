/**
 * Serves the exported Expo web build behind a real gateway + PiBridge so the
 * phone UI can be inspected (and screenshotted) without a simulator
 * (20261115-mobile.md Phase 3.5 preview).
 *
 *   cd apps/mobile && npx expo export --platform web --output-dir /tmp/expo-web
 *   bun run scripts/preview-mobile-web.ts /tmp/expo-web
 *
 * It prints the web URL, gateway URL and a fresh pairing code. The demo host
 * below answers with sample sessions/messages so every screen has content.
 */

import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

import { serve } from 'bun'
import { websocket } from 'hono/bun'

import { createGateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher } from '../packages/pi-bridge/src/server.js'

const webDir = resolve(process.argv[2] ?? '/tmp/expo-web')

const listeners = new Set<(event: string, payload: unknown) => void>()
const demoQueue = { steering: [] as string[], followUp: [] as string[] }
let demoTaskAlive = true
const now = Date.now()

const SESSIONS: Array<{ id: string; title: string; updatedAt: number; pinned: boolean; archived?: boolean; cwd?: string }> = [
  { id: 'sess-mobile', title: '手机端接入设计', updatedAt: now - 60_000, pinned: true, cwd: '/Users/louloulin/stock/OpenBuddy' },
  { id: 'sess-review', title: '评审：网关隧道改动', updatedAt: now - 3 * 3_600_000, pinned: false, cwd: '/Users/louloulin/stock/OpenBuddy' },
  { id: 'sess-notes', title: '周会纪要', updatedAt: now - 26 * 3_600_000, pinned: false, cwd: '/tmp/scratch' },
]

const DEMO_THINKING = { level: 'medium' }

const DEMO_NOTIFICATIONS = [
  { id: 2, kind: 'approval', title: '需要你批准：写入 3 个文件', body: '会话「手机端接入设计」请求修改文档。', sessionId: 'sess-mobile', severity: 'info', read: false, at: new Date(now - 30_000).toISOString() },
  { id: 1, kind: 'done', title: '会话已完成', body: '这一轮已经结束。', sessionId: 'sess-notes', severity: 'info', read: true, at: new Date(now - 3_600_000).toISOString() },
]

const AUTOMATIONS: Array<Record<string, unknown>> = [
  {
    id: 'auto-demo', name: '每日晨报', prompt: '整理今天的日程与待办，发一段摘要。',
    cwds: '/tmp/scratch', status: 'ACTIVE', scheduleType: 'recurring',
    nextRunAt: new Date(now + 3_600_000).toISOString(), createdAt: new Date(now).toISOString(),
  },
]

const HISTORY: Record<string, unknown[]> = {
  'sess-mobile': [
    { type: 'message_end', sessionId: 'sess-mobile', message: { role: 'user', content: '手机端现在能直接用了？' } },
    {
      type: 'message_end', sessionId: 'sess-mobile',
      message: { role: 'assistant', content: '可以。手机通过网关隧道连到这台电脑，会话、流式回复和审批都在。' },
    },
    {
      type: 'toolcall_start', sessionId: 'sess-mobile', toolCallId: 'tc-1', toolName: 'read_text_file',
      assistantMessageEvent: { type: 'toolcall_start', toolCall: { type: 'toolCall', id: 'tc-1', name: 'read_text_file' } },
    },
    {
      type: 'toolcall_delta', sessionId: 'sess-mobile', toolCallId: 'tc-1',
      assistantMessageEvent: { type: 'toolcall_delta', partialArgs: { path: 'docs/plan/20261115-mobile.md' } },
    },
    {
      type: 'toolcall_end', sessionId: 'sess-mobile', toolCallId: 'tc-1',
      result: { content: [{ type: 'text', text: 'Phase 3 · Expo App —— 会话、聊天、审批、推送' }] },
    },
    {
      type: 'toolcall_start', sessionId: 'sess-mobile', toolCallId: 'tc-write-1', toolName: 'write_text_file',
      assistantMessageEvent: { type: 'toolcall_start', toolCall: { type: 'toolCall', id: 'tc-write-1', name: 'write_text_file' } },
    },
    {
      type: 'toolcall_end', sessionId: 'sess-mobile', toolCallId: 'tc-write-1',
      result: { content: [{ type: 'text', text: '已写入 42 行' }] },
    },
    {
      type: 'toolcall_start', sessionId: 'sess-mobile', toolCallId: 'tc-search-1', toolName: 'web_search',
      assistantMessageEvent: { type: 'toolcall_start', toolCall: { type: 'toolCall', id: 'tc-search-1', name: 'web_search' } },
    },
    {
      type: 'toolcall_end', sessionId: 'sess-mobile', toolCallId: 'tc-search-1',
      result: {
        content: [{
          type: 'text',
          text: '1. [MDN: Server-sent events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)\n2. https://www.rfc-editor.org/rfc/rfc9110',
        }],
      },
    },
    {
      type: 'message_end', sessionId: 'sess-mobile',
      message: { role: 'assistant', content: '计划文档里 Phase 3 已经全部完成，剩下的是 H5 兜底和真机验证。' },
    },
  ],
  'sess-review': [
    { type: 'message_end', sessionId: 'sess-review', message: { role: 'user', content: '隧道那边有回归吗？' } },
    {
      type: 'message_end', sessionId: 'sess-review',
      message: { role: 'assistant', content: '没有。网关 359 个测试全绿，我只加了 expo 推送 provider。' },
    },
  ],
  'sess-notes': [
    { type: 'message_end', sessionId: 'sess-notes', message: { role: 'user', content: '整理下今天的结论。' } },
    {
      type: 'message_end', sessionId: 'sess-notes',
      message: { role: 'assistant', content: '1. 手机端用 Expo；2. 传输先 SSE；3. 附件走 /api/upload。' },
    },
  ],
}

const dispatcher: HostDispatcher = {
  dispatch: async (command, payload) => {
    switch (command) {
      case 'agent_list_sessions': {
        const cwd = typeof payload.cwd === 'string' ? payload.cwd : null
        return SESSIONS.filter(session => !cwd || session.cwd === cwd)
      }
      case 'projects_snapshot':
        return {
          projects: [
            { id: 'proj-openbuddy', name: 'OpenBuddy', cwd: '/Users/louloulin/stock/OpenBuddy' },
            { id: 'proj-scratch', name: '临时试验', cwd: '/tmp/scratch' },
          ],
        }
      case 'agent_load_session':
        return { updates: HISTORY[String(payload.sessionId)] ?? [] }
      case 'agent_send': {
        const sessionId = String(payload.sessionId ?? 'sess-mobile')
        const text = String(payload.text ?? '')
        // One turn that exercises the whole chat surface: thinking → tool card
        // → paced text deltas → settle. The pacing leaves a visible streaming
        // window so the review screenshots can catch the caret mid-answer.
        setTimeout(() => {
          const emit = (event: unknown) => { for (const listener of listeners) listener('agent://event', { sessionId, event }) }
          emit({ type: 'message_start' })
          emit({ type: 'thinking_delta', assistantMessageEvent: { type: 'thinking_delta', delta: '先看手机端的桥接有没有做缓冲。' } })
          emit({
            type: 'toolcall_start', toolCallId: 'tc-live', toolName: 'read_text_file',
            assistantMessageEvent: { type: 'toolcall_start', toolCall: { type: 'toolCall', id: 'tc-live', name: 'read_text_file' } },
          })
          emit({
            type: 'toolcall_delta', toolCallId: 'tc-live',
            assistantMessageEvent: { type: 'toolcall_delta', partialArgs: { path: 'docs/plan/20261115-mobile.md' } },
          })
          emit({
            type: 'toolcall_end', toolCallId: 'tc-live',
            result: { content: [{ type: 'text', text: 'Phase 3 · Expo App 28/28' }] },
          })
          const askApprovals = text.includes('审批演示')
          const chunks = ['收到：', text, '。这是演示回复，', '流式输出经过网关和桌面桥。']
          chunks.forEach((chunk, index) => {
            setTimeout(() => {
              emit({ type: 'message_delta', assistantMessageEvent: { type: 'text_delta', delta: chunk } })
              if (index === chunks.length - 1) {
                emit({
                  type: 'message_end',
                  message: { role: 'assistant', content: `收到：${text}。这是演示回复，流式输出经过网关和桌面桥。` },
                })
                if (askApprovals) {
                  for (const listener of listeners) {
                    listener('agent://permission', {
                      requestId: 'perm-demo', sessionId, title: '允许修改 proxy.ts？',
                      rawInput: { path: 'packages/gateway/src/proxy.ts' },
                      options: [
                        { optionId: 'allow-once', kind: 'allow', title: '允许一次' },
                        { optionId: 'deny', kind: 'deny', title: '拒绝' },
                      ],
                    })
                    listener('agent://ui-request', {
                      requestId: 'q-demo', sessionId, kind: 'select', title: '选哪种压测？',
                      options: ['100 并发', '500 并发'], message: '桌面在等你回答。',
                    })
                    listener('agent://folder-trust', { cwd: '/demo/workspace' })
                  }
                }
                emit({ type: 'agent_settled' })
              }
            }, 320 * (index + 1))
          })
        }, 30)
        return { promptId: `demo-${Date.now()}` }
      }
      case 'session_search':
        return SESSIONS
          .filter(session => session.title.includes(String(payload.query ?? '')))
          .map(session => ({ sessionId: session.id, title: session.title, snippet: '演示搜索结果' }))
      case 'agent_get_queue':
        return { steering: [...demoQueue.steering], followUp: [...demoQueue.followUp] }
      case 'agent_follow_up':
        demoQueue.followUp.push(String(payload.text ?? ''))
        return { steering: [...demoQueue.steering], followUp: [...demoQueue.followUp] }
      case 'agent_steer':
        demoQueue.steering.push(String(payload.text ?? ''))
        return { steering: [...demoQueue.steering], followUp: [...demoQueue.followUp] }
      case 'agent_set_queue':
        demoQueue.steering = Array.isArray(payload.steering) ? payload.steering.map(String) : []
        demoQueue.followUp = Array.isArray(payload.followUp) ? payload.followUp.map(String) : []
        return { steering: [...demoQueue.steering], followUp: [...demoQueue.followUp] }
      case 'agent_clear_queue':
        demoQueue.steering = []
        demoQueue.followUp = []
        return { steering: [], followUp: [] }
      case 'notification_list':
        return DEMO_NOTIFICATIONS.map(item => ({ ...item }))
      case 'notification_mark_all_read':
        for (const item of DEMO_NOTIFICATIONS) item.read = true
        return { ok: true }
      case 'agent_resolve_permission':
        for (const listener of listeners) listener('agent://permission-dismiss', { requestId: payload.requestId, sessionId: payload.sessionId })
        return { resolved: true }
      case 'agent_resolve_ui':
        for (const listener of listeners) listener('agent://ui-dismiss', { requestId: payload.requestId, sessionId: payload.sessionId, reason: 'resolved' })
        return { resolved: true }
      case 'folder_trust_respond':
        return { trusted: payload.trusted }
      case 'agent_init':
        return { ok: true, cwd: '/Users/louloulin/stock/OpenBuddy', inbox: '/tmp/inbox' }
      case 'agent_new_session':
        return 'sess-new'
      case 'agent_list_workspaces':
        return [
          { cwd: '/Users/louloulin/stock/OpenBuddy', sessionCount: 3, lastTitle: '手机端接入设计' },
          { cwd: '/tmp/scratch', sessionCount: 1, lastTitle: '临时试验' },
        ]
      case 'agent_set_session_pinned': {
        const session = SESSIONS.find(item => item.id === payload.sessionId)
        if (session) session.pinned = Boolean(payload.pinned)
        return { ok: true }
      }
      case 'agent_rename_session': {
        const session = SESSIONS.find(item => item.id === payload.sessionId)
        if (session) session.title = String(payload.title ?? session.title)
        return { ok: true }
      }
      case 'agent_set_session_archived': {
        const session = SESSIONS.find(item => item.id === payload.sessionId)
        if (session) session.archived = Boolean(payload.archived)
        return { ok: true }
      }
      case 'agent_delete_session': {
        const index = SESSIONS.findIndex(item => item.id === payload.sessionId)
        if (index >= 0) SESSIONS.splice(index, 1)
        return { ok: true }
      }
      case 'agent_get_model_state':
        return { thinkingLevel: DEMO_THINKING.level }
      case 'agent_set_thinking_level':
        DEMO_THINKING.level = String(payload.level ?? 'medium')
        return { ok: true }
      case 'agent_export_jsonl':
        return '/tmp/openbuddy-preview-export.jsonl'
      case 'turn_revert':
        return { restored: ['packages/gateway/src/relay/sse.ts'], conflicts: [] }
      case 'agent_session_info':
        return { cwd: '/tmp/scratch', usage: { used: 38_400, total: 200_000 } }
      case 'list_dir':
        return [
          { name: 'src', path: '/tmp/scratch/src', kind: 'directory', size: 0 },
          { name: 'notes.md', path: '/tmp/scratch/notes.md', kind: 'file', size: 120 },
        ]
      case 'files_search': {
        const query = String(payload.query ?? '').toLowerCase()
        const hits = [
          { path: 'docs/plan.md', name: 'plan.md', size: 99, mtimeMs: Date.now() },
          { path: 'src/main.ts', name: 'main.ts', size: 88, mtimeMs: Date.now() },
        ].filter(hit => !query || hit.path.toLowerCase().includes(query))
        return { cwd: '/tmp/scratch', hits, partial: false }
      }
      case 'commands_list':
        return [
          { name: 'compact', description: '压缩上下文：总结较早的对话以释放空间', source: 'builtin' },
          { name: 'skill:review', description: '代码评审', source: 'skill' },
          { name: 'skill:weekly', description: '周报整理', source: 'skill' },
        ]
      case 'library_list':
        return [
          { id: '/Users/louloulin/stock/OpenBuddy/docs', kind: 'folder', label: 'docs', path: '/Users/louloulin/stock/OpenBuddy/docs', addedAt: new Date(now).toISOString() },
          { id: '/tmp/scratch', kind: 'folder', label: 'scratch', path: '/tmp/scratch', addedAt: new Date(now).toISOString() },
        ]
      case 'memory_list':
        return [
          { scope: 'global', path: 'MEMORY.md', content: '# 长期偏好\n\n- 回答用中文\n- 先给结论', size: 40 },
          { scope: 'global', path: 'people/team.md', content: '- 小林负责安卓', size: 18 },
          { scope: 'workspace', path: 'notes.md', content: '# 项目笔记', size: 12 },
        ]
      case 'memory_get':
        return '# 长期偏好\n\n- 回答用中文\n- 先给结论再给理由'
      case 'agent_tree':
        return {
          sessionId: 'sess-mobile',
          leafId: 'leaf-2',
          turns: [{
            entryId: 'u-1', timestamp: now - 300_000, index: 1, total: 2,
            siblings: [
              { entryId: 'v1', leafId: 'leaf-1', timestamp: now - 320_000, preview: '手机端现在能直接用了？', files: [] },
              { entryId: 'v2', leafId: 'leaf-2', timestamp: now - 300_000, preview: '手机端现在能直接用了？顺便看看重连。', files: [] },
            ],
          }],
        }
      case 'rewind_points':
        return [{ entryId: 'u-1', index: 0, preview: '手机端现在能直接用了？' }]
      case 'checkpoint_list':
        return [{
          id: 'ck-1', toolCallId: 'tc-write-1', path: 'docs/plan/20261115-mobile.md',
          before: null, after: 'a'.repeat(64), at: now - 240_000, source: 'tool',
        }]
      case 'automations_snapshot':
        return { automations: AUTOMATIONS.map(item => ({ ...item })), records: [] }
      case 'automations_save': {
        const input = (payload.automation ?? {}) as Record<string, unknown>
        const existing = typeof input.id === 'string' ? AUTOMATIONS.find(item => item.id === input.id) : undefined
        if (existing) {
          Object.assign(existing, input)
          return { ...existing }
        }
        const created = {
          id: `auto-${Date.now()}`, status: 'ACTIVE', scheduleType: 'recurring',
          nextRunAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: new Date().toISOString(),
          ...input,
        }
        AUTOMATIONS.push(created)
        return { ...created }
      }
      case 'automations_delete': {
        const index = AUTOMATIONS.findIndex(item => item.id === payload.id)
        if (index >= 0) AUTOMATIONS.splice(index, 1)
        return { ok: true }
      }
      case 'automations_set_status': {
        const task = AUTOMATIONS.find(item => item.id === payload.id)
        if (task) task.status = payload.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE'
        return { ok: true }
      }
      case 'automations_run':
        return { recordId: 'rec-demo', ok: true, sessionId: 'sess-mobile' }
      case 'read_text_file': {
        if (payload.path === '/tmp/scratch/src/main.ts') return 'export const answer = 42\n'
        if (payload.path === '/tmp/scratch/notes.md') return '# 临时试验\n\n- 验证文件搜索\n'
        if (payload.path !== '/tmp/openbuddy-preview-export.jsonl') {
          throw new Error(`preview has no file ${String(payload.path)}`)
        }
        return [
          '{"type":"session","version":3,"id":"sess-mobile"}',
          '{"type":"message","role":"user","content":"手机端现在能直接用了？"}',
          '{"type":"message","role":"assistant","content":"可以。手机通过网关隧道连到这台电脑。"}',
        ].join('\n') + '\n'
      }
      case 'agent_fork_session':
        return 'sess-fork'
      case 'agent_handoff':
        return { sessionId: 'sess-handoff', prompt: `## 背景接手（演示）\n\n下一步：${String(payload.goal ?? '')}`, from: { sessionId: payload.sessionId } }
      case 'agent_compact':
        return { tokensBefore: 1000, tokensAfter: 400 }
      case 'tasks_list':
        return demoTaskAlive ? [{
          id: 'sess-mobile', kind: 'bash', title: '演示：跑测试', status: 'running',
          startedAt: Date.now() - 12_000, pending: 1, sessionId: 'sess-mobile',
        }] : []
      case 'task_kill':
        demoTaskAlive = false
        return { killed: true }
      default:
        throw new Error(`demo host has no ${command}`)
    }
  },
  listen: handler => {
    listeners.add(handler)
    return () => listeners.delete(handler)
  },
  servedCommands: () => [
    'agent_list_sessions', 'agent_load_session', 'agent_send', 'agent_resolve_permission',
    'agent_get_queue', 'agent_follow_up', 'agent_steer', 'agent_set_queue', 'agent_clear_queue',
    'agent_resolve_ui', 'folder_trust_respond', 'tasks_list', 'task_kill', 'permission_mode_get',
    'agent_init', 'agent_new_session', 'agent_list_workspaces', 'agent_fork_session', 'agent_handoff', 'agent_compact',
    'agent_set_session_pinned', 'agent_rename_session', 'agent_set_session_archived', 'agent_delete_session',
    'agent_export_jsonl', 'read_text_file', 'agent_session_info', 'list_dir', 'files_search', 'commands_list',
    'agent_get_model_state', 'agent_set_thinking_level',
    'automations_snapshot', 'automations_save', 'automations_delete', 'automations_set_status', 'automations_run',
    'library_list', 'projects_snapshot', 'turn_revert', 'session_search',
    'memory_list', 'memory_get', 'agent_tree', 'rewind_points', 'checkpoint_list', 'notification_list',
    'notification_mark_all_read',
  ],
}

const bridge = createBridgeServer(dispatcher, { token: 'preview-bridge' })
const bridgeServer = serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: (req, server) => bridge.fetch(req, server),
  websocket: bridge.websocket as never,
})
const bridgeUrl = `http://127.0.0.1:${bridgeServer.port}`

// The web page's origin must be allowed before the gateway exists, so bind the
// static server first on an ephemeral port and feed it into the gateway config.
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
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
const webOrigin = `http://127.0.0.1:${web.port}`

const gateway = createGateway({
  host: '127.0.0.1',
  port: 0,
  upstreamUrl: 'http://127.0.0.1:1',
  adminToken: 'preview-admin',
  agentToken: 'preview-agent',
  dbPath: ':memory:',
  pairTtlMs: 30 * 60_000,
  claimLimitPerMinute: 100,
  maxBodyBytes: 20 * 1024 * 1024,
  allowedOrigins: [webOrigin],
  h5Enabled: false,
  h5Dir: '.',
  pairAllowsSharedRoute: true,
  webhookAllowedHosts: [],
  webhookAllowCleartext: false,
  pushWatchIntervalMs: 60_000,
  fcmChannelId: 'preview',
  trustProxy: false,
} as Parameters<typeof createGateway>[0])

const gatewayServer = serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: (req, server) => gateway.app.fetch(req, server),
  websocket,
})
const gatewayUrl = `http://127.0.0.1:${gatewayServer.port}`

const agent = createAgentClient({
  gatewayUrl,
  agentToken: 'preview-agent',
  getLocalServerUrl: () => bridgeUrl,
  localAccessToken: 'preview-bridge',
  log: () => {},
})
await new Promise<void>(resolvePromise => {
  const timer = setInterval(() => {
    if (agent.connected()) { clearInterval(timer); resolvePromise() }
  }, 20)
  setTimeout(() => { clearInterval(timer); resolvePromise() }, 5000)
})

const pairResponse = await fetch(`${gatewayUrl}/pair/start`, {
  method: 'POST',
  headers: { authorization: 'Bearer preview-admin', 'content-type': 'application/json' },
  body: JSON.stringify({ scopes: ['sessions:read', 'sessions:write', 'approve'] }),
})
const pair = (await pairResponse.json()) as { code: string }

console.log(JSON.stringify({
  webUrl: webOrigin,
  gatewayUrl,
  pairCode: pair.code,
  desktopConnected: agent.connected(),
}, null, 2))

const shutdown = () => {
  agent.close()
  gatewayServer.stop(true)
  bridgeServer.stop(true)
  web.stop(true)
  gateway.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
