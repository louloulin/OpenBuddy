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
import type { Transcript } from './transcript'

export function isPreview(): boolean {
  return process.env.EXPO_PUBLIC_UI_PREVIEW === '1'
}

export type PreviewState = {
  sessions: CachedSession[]
  transcripts: Record<string, Transcript>
  notifications: NotificationItem[]
  approvals: Approval[]
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
          kind: 'text',
          id: 'a1',
          role: 'assistant',
          text: '没有缓冲。代理层把 accept-encoding 固定成 identity，上游写一帧就转发一帧，TTFB 等于桌面出第一个 token 的时间加一跳 RTT。',
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

  return { sessions, transcripts, notifications, approvals }
}
