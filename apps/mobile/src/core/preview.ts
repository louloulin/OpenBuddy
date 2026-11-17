/**
 * Screenshot harness (20261115-mobile.md §4.3).
 *
 * Design review needs pictures of screens that normally require a paired
 * desktop. This module supplies a fixed, clearly fake dataset so the UI can be
 * rendered and photographed on its own.
 *
 * It is compiled in only when `EXPO_PUBLIC_UI_PREVIEW=1` is set at build time:
 * Expo inlines `process.env.EXPO_PUBLIC_*`, so a normal build folds the branch
 * away and ships no demo content or fake credentials.
 */

import type { Approval, CachedSession, NotificationItem } from './models'
import type { DirEntry } from './files'
import type { Automation } from './automations'
import type { MemoryEntry } from './memory'
import type { BranchTree } from '@openbuddy/protocol/branches'
import type { RewindPoint } from '@openbuddy/protocol/dto'
import type { CheckpointRecord } from './branches'
import type { Capabilities } from './surface'
import type { Transcript } from './transcript'

export function isPreview(): boolean {
  return process.env.EXPO_PUBLIC_UI_PREVIEW === '1'
}

export type PreviewState = {
  sessions: CachedSession[]
  transcripts: Record<string, Transcript>
  notifications: NotificationItem[]
  approvals: Approval[]
  /** Sessions shown as still waiting for the model. */
  awaiting: string[]
  /** The fake file tree the phone browses. */
  files: { path: string; entries: DirEntry[]; preview?: { path: string; text: string } }
  /** The scheduled tasks the fake computer has. */
  automations: Automation[]
  /** The memory notes the fake computer would inject. */
  memories: MemoryEntry[]
  /** The session tree with sibling versions. */
  branchTree: BranchTree
  /** The prompts the phone may rewind to. */
  rewindPoints: RewindPoint[]
  /** The file snapshots around tool writes. */
  checkpoints: CheckpointRecord[]
  /** The surface the fake desktop advertises, so capability gating shows as open. */
  capabilities: Capabilities
  /** The session panel's read-only view of one session. */
  panel?: {
    experts: { id: string; name: string; description?: string }[]
    thinkingLevel?: string
    artifacts: { path: string; kind?: string }[]
    usage?: { used: number; total: number }
  }
}

/** Relative to the run, so a review build never shows stale timestamps. */
const now = Date.now()

export function previewState(): PreviewState {
  const sessions: CachedSession[] = [
    {
      id: 'sess-refactor',
      title: '重构网关隧道',
      updatedAt: now - 60_000,
      pinned: true,
      archived: false,
      preview: '把 forwardHttp 的 SSE 直通逻辑单独抽出来，补一条 100 并发的压测。',
      unread: 1,
    },
    {
      id: 'sess-mobile',
      title: '手机端配对流程',
      updatedAt: now - 40 * 60_000,
      pinned: false,
      archived: false,
      preview: '扫码后 device token 存钥匙串，重连按 seq 补齐。',
      unread: 0,
    },
    {
      id: 'sess-release',
      title: '发版检查单',
      updatedAt: now - 5 * 3_600_000,
      pinned: false,
      archived: false,
      preview: '三端产物、迁移脚本、回滚预案都过一遍。',
      unread: 0,
    },
    {
      id: 'sess-pending',
      title: '等待模型响应',
      updatedAt: now - 5_000,
      pinned: false,
      archived: false,
      preview: '正在压测 100 条并发流…',
      unread: 0,
    },
    {
      id: 'sess-docs',
      title: '补写 README',
      updatedAt: now - 26 * 3_600_000,
      pinned: false,
      archived: false,
      preview: '把启动方式、环境变量和边界约束写清楚。',
      unread: 0,
    },
  ]

  const transcripts: Record<string, Transcript> = {
    'sess-refactor': {
      rows: [
        { kind: 'text', id: 'u1', role: 'user', text: '网关的 SSE 直通现在有没有缓冲？' },
        {
          kind: 'thinking',
          id: 'th1',
          live: false,
          text: '先确认代理层有没有做缓冲。\n看 forwardHttp 的 accept-encoding 处理。\n应该没有，identity 是直通的。',
        },
        {
          kind: 'text',
          id: 'a1',
          role: 'assistant',
          text: '没有缓冲。代理层把 `accept-encoding` 固定成 **identity**，上游写一帧就转发一帧：\n\n- TTFB = 桌面出第一个 token + 一跳 RTT\n- 中间不做任何聚合\n\n```ts\nheaders[\'accept-encoding\'] = \'identity\'\n```',
        },
        { kind: 'tool', id: 't1', name: 'grep', hint: "forwardHttp packages/gateway/src", status: 'ok', output: 'proxy.ts:102  export async function forwardHttp(' },
        { kind: 'text', id: 'u2', role: 'user', text: '那把这块单独抽出来，加一条并发测试。' },
        {
          kind: 'text',
          id: 'a2',
          role: 'assistant',
          text: '好。抽成 relay/sse.ts，保留原来的 identity 头；测试用 100 条并发流读同一份缓冲，断言没有交叉写入。',
          streaming: true,
        },
      ],
      lastAssistantText: '好。抽成 relay/sse.ts，保留原来的 identity 头；测试用 100 条并发流读同一份缓冲，断言没有交叉写入。',
    },
    // A turn that has only been sent: the waiting row is the whole screen.
    'sess-pending': {
      rows: [
        { kind: 'text', id: 'u1', role: 'user', text: '跑一遍 100 并发的 SSE 压测，看看有没有交叉写入。' },
      ],
      lastAssistantText: '',
    },
    'sess-mobile': {
      rows: [
        { kind: 'text', id: 'u1', role: 'user', text: '手机重连之后会不会漏掉事件？' },
        {
          kind: 'text',
          id: 'a1',
          role: 'assistant',
          text: '不会。桥上有 2048 条环形缓冲，每条事件带单调 seq；重连带 since 补发，缺口过大才回 resync 让客户端拉快照。',
        },
      ],
      lastAssistantText: '不会。桥上有 2048 条环形缓冲，每条事件带单调 seq；重连带 since 补发，缺口过大才回 resync 让客户端拉快照。',
    },
  }

  const notifications: NotificationItem[] = [
    { id: 'n1', kind: 'approval', title: '需要你批准：写入 3 个文件', body: '会话「重构网关隧道」请求修改 proxy.ts、relay/sse.ts、sse.test.ts。', sessionId: 'sess-refactor', read: false, at: now - 30_000 },
    { id: 'n2', kind: 'question', title: '在等你回答一个问题', body: '压测用 100 还是 500 并发？', sessionId: 'sess-refactor', read: false, at: now - 3 * 60_000 },
    { id: 'n3', kind: 'done', title: '会话已完成', body: '「手机端配对流程」这一轮跑完了。', sessionId: 'sess-mobile', read: true, at: now - 45 * 60_000 },
    { id: 'n4', kind: 'scheduled', title: '定时任务完成', body: '每日发版检查单已生成。', sessionId: 'sess-release', read: true, at: now - 6 * 3_600_000 },
  ]

  const approvals: Approval[] = [
    {
      requestId: 'req-preview',
      kind: 'permission',
      sessionId: 'sess-refactor',
      title: '允许修改这 3 个文件？',
      detail: 'packages/gateway/src/proxy.ts\npackages/gateway/src/relay/sse.ts\npackages/gateway/test/sse.test.ts',
      receivedAt: now,
    },
  ]

  const panel = {
    experts: [
      { id: 'e-arch', name: '架构师', description: '擅长系统设计与接口拆解' },
      { id: 'e-doc', name: '文档工程师', description: '把结论写成可执行的文档' },
      { id: 'e-test', name: '测试搭子', description: '专盯边界条件与并发' },
    ],
    thinkingLevel: 'medium',
    artifacts: [
      { path: 'docs/plan/20261115-mobile.md', kind: '文档' },
      { path: 'packages/pi-bridge/src/server.ts', kind: '代码' },
    ],
    usage: { used: 38_400, total: 200_000 },
  }

  const capabilities: Capabilities = {
    platform: 'mobile-host',
    commands: [
      'agent_list_sessions', 'agent_send', 'agent_load_session', 'agent_new_session',
      'agent_resolve_permission', 'agent_get_model_state', 'agent_set_thinking_level',
      'agent_set_session_expert', 'agent_regenerate', 'agent_cancel',
      'agents_list', 'artifacts_list', 'agent_session_info', 'session_search',
      'automations_snapshot', 'automations_run', 'automations_set_status',
      'notification_list', 'notification_mark_all_read', 'memory_list',
    ],
    events: ['agent://event', 'agent://permission', 'agent://update'],
  }

  const files = {
    path: '/Users/louloulin/stock/OpenBuddy',
    entries: [
      { name: 'apps', path: '/Users/louloulin/stock/OpenBuddy/apps', kind: 'directory' as const, size: 0 },
      { name: 'docs', path: '/Users/louloulin/stock/OpenBuddy/docs', kind: 'directory' as const, size: 0 },
      { name: 'packages', path: '/Users/louloulin/stock/OpenBuddy/packages', kind: 'directory' as const, size: 0 },
      { name: 'README.md', path: '/Users/louloulin/stock/OpenBuddy/README.md', kind: 'file' as const, size: 8_420 },
      { name: 'pnpm-lock.yaml', path: '/Users/louloulin/stock/OpenBuddy/pnpm-lock.yaml', kind: 'file' as const, size: 412_880 },
      { name: 'tsconfig.json', path: '/Users/louloulin/stock/OpenBuddy/tsconfig.json', kind: 'file' as const, size: 3_140 },
    ],
    preview: {
      path: '/Users/louloulin/stock/OpenBuddy/README.md',
      text: [
        '# OpenBuddy',
        '',
        'OpenBuddy 是一个由 Pi 驱动的桌面工作台。',
        '',
        '## 手机接入',
        '',
        '桌面端启动后会在本地开一个桥接端口，手机通过网关连过来：',
        '',
        '- `POST /cmd/:command` —— 命令',
        '- `GET  /events?since=` —— 事件流',
        '',
        '密钥只留在桌面。',
      ].join('\n'),
    },
  }

  const automations: Automation[] = [
    {
      id: 'auto-morning',
      name: '每日晨报',
      prompt: '整理今天的日程、昨天没完成的任务和新的通知',
      status: 'ACTIVE',
      nextRunAt: new Date(now + 3 * 3600_000).toISOString(),
      lastRunAt: new Date(now - 21 * 3600_000).toISOString(),
    },
    {
      id: 'auto-review',
      name: '每周代码巡检',
      prompt: '跑一遍测试、看看有没有失败用例，并给出修复建议',
      status: 'ACTIVE',
      nextRunAt: new Date(now + 2 * 86_400_000).toISOString(),
    },
    {
      id: 'auto-paused',
      name: '旧版提醒',
      prompt: '每天提醒一次旧的提醒事项',
      status: 'PAUSED',
    },
  ]

  const memories: MemoryEntry[] = [
    {
      scope: 'global',
      path: 'MEMORY.md',
      size: 186,
      content: [
        '# 长期偏好',
        '',
        '- 回答用中文，先给结论再给理由。',
        '- 代码改动要配一条能真实跑起来的验证。',
        '- 不确定的地方直说，不要猜。',
      ].join('\n'),
    },
    {
      scope: 'global',
      path: 'people/team.md',
      size: 132,
      content: [
        '# 团队',
        '',
        '- 安卓由小林负责，iOS 是我。',
        '- 发版窗口在周四下午。',
      ].join('\n'),
    },
    {
      scope: 'global',
      path: 'projects/openbuddy.md',
      size: 210,
      content: [
        '# OpenBuddy',
        '',
        '- 桌面端是 Electron + Pi 引擎，手机端是 Expo。',
        '- 手机不持有模型密钥，所有工具调用都在电脑上执行。',
      ].join('\n'),
    },
    {
      scope: 'workspace',
      path: 'decisions/gateway-sse.md',
      size: 148,
      content: [
        '# 网关流式结论',
        '',
        '代理层固定 accept-encoding: identity，SSE 一帧到一帧转发，不做聚合。',
      ].join('\n'),
    },
  ]

  const branchTree: BranchTree = {
    sessionId: 'sess-refactor',
    leafId: 'leaf-3',
    turns: [
      {
        entryId: 'u-refactor-1',
        timestamp: now - 600_000,
        index: 1,
        total: 3,
        siblings: [
          { entryId: 'v1', leafId: 'leaf-1', timestamp: now - 700_000, preview: '网关的 SSE 直通现在有没有缓冲？', files: [] },
          { entryId: 'v2', leafId: 'leaf-2', timestamp: now - 650_000, preview: '网关的 SSE 直通现在有没有缓冲？顺便看看 gzip 处理。', files: [] },
          { entryId: 'v3', leafId: 'leaf-3', timestamp: now - 600_000, preview: '网关的 SSE 直通现在有没有缓冲？给出代码位置。', files: ['packages/gateway/src/proxy.ts'] },
        ],
      },
      {
        entryId: 'u-refactor-2',
        timestamp: now - 300_000,
        index: 0,
        total: 2,
        siblings: [
          { entryId: 'w1', leafId: 'leaf-4', timestamp: now - 320_000, preview: '那把这块单独抽出来，加一条并发测试。', files: [] },
          { entryId: 'w2', leafId: 'leaf-5', timestamp: now - 300_000, preview: '那把这块单独抽出来，加一条 100 并发的压测。', files: ['packages/gateway/test/sse.test.ts'] },
        ],
      },
    ],
  }

  const rewindPoints: RewindPoint[] = [
    { entryId: 'u-refactor-2', index: 0, preview: '那把这块单独抽出来，加一条并发测试。' },
    { entryId: 'u-refactor-1', index: 1, preview: '网关的 SSE 直通现在有没有缓冲？' },
  ]

  const checkpoints: CheckpointRecord[] = [
    {
      id: 'ck-3',
      toolCallId: 'tool-9',
      path: 'packages/gateway/src/proxy.ts',
      before: 'b'.repeat(64),
      after: 'a'.repeat(64),
      at: now - 240_000,
      source: 'tool',
    },
    {
      id: 'ck-2',
      path: 'packages/gateway/src/relay/sse.ts',
      before: null,
      after: 'c'.repeat(64),
      at: now - 180_000,
      source: 'apply',
    },
    {
      id: 'ck-1',
      path: 'packages/gateway/test/sse.test.ts',
      before: 'd'.repeat(64),
      after: 'e'.repeat(64),
      at: now - 60_000,
      source: 'user',
    },
  ]

  return {
    sessions, transcripts, notifications, approvals, awaiting: ['sess-pending'],
    capabilities, panel, files, automations, memories, branchTree, rewindPoints, checkpoints,
  }
}
