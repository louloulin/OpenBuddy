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
const now = Date.now()

const SESSIONS = [
  { id: 'sess-mobile', title: '手机端接入设计', updatedAt: now - 60_000, pinned: true },
  { id: 'sess-review', title: '评审：网关隧道改动', updatedAt: now - 3 * 3_600_000, pinned: false },
  { id: 'sess-notes', title: '周会纪要', updatedAt: now - 26 * 3_600_000, pinned: false },
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
      case 'agent_list_sessions':
        return SESSIONS
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
          const chunks = ['收到：', text, '。这是演示回复，', '流式输出经过网关和桌面桥。']
          chunks.forEach((chunk, index) => {
            setTimeout(() => {
              emit({ type: 'message_delta', assistantMessageEvent: { type: 'text_delta', delta: chunk } })
              if (index === chunks.length - 1) {
                emit({
                  type: 'message_end',
                  message: { role: 'assistant', content: `收到：${text}。这是演示回复，流式输出经过网关和桌面桥。` },
                })
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
      case 'notification_list':
        return []
      case 'agent_resolve_permission':
        return { resolved: true }
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
    'session_search', 'notification_list',
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
