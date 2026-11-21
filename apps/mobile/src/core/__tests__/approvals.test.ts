import { describe, expect, it } from 'vitest'

import {
  parsePermissionMode, permissionApproval, permissionDetail, permissionModeLabel, permissionOptionId,
  questionApproval, reconcileApprovals, sessionsWithPendingApprovals, shouldDismissAfterAnswer, trustApproval, trustRequestId,
} from '../approvals'
import type { Approval } from '../models'

describe('permissionOptionId', () => {
  const options = [
    { optionId: 'allow-once', kind: 'allow', title: '允许一次' },
    { optionId: 'deny', kind: 'deny', title: '拒绝' },
  ]

  it('picks the option by kind', () => {
    expect(permissionOptionId({ permissionOptions: options }, true)).toBe('allow-once')
    expect(permissionOptionId({ permissionOptions: options }, false)).toBe('deny')
  })

  it('falls back to the kind name when the desktop sent no options', () => {
    expect(permissionOptionId({}, true)).toBe('allow')
    expect(permissionOptionId({}, false)).toBe('deny')
  })
})

describe('permissionDetail', () => {
  it('prefers the human fields and truncates the rest', () => {
    expect(permissionDetail({ command: 'rm -rf build', cwd: '/w' })).toBe('rm -rf build')
    expect(permissionDetail({ paths: ['a.ts', 'b.ts'] })).toBe('a.ts\nb.ts')
    expect(permissionDetail('x'.repeat(400))?.endsWith('…')).toBe(true)
    expect(permissionDetail(undefined)).toBeUndefined()
  })
})

describe('permissionApproval', () => {
  // §2.4 path 3: a card recovered from `permission_pending` must be identical to
  // the one the live `agent://permission` event would have produced, otherwise
  // the answer would target a requestId the desktop never issued.
  it('maps the wire request into a card, keeping the requestId', () => {
    expect(permissionApproval({
      requestId: 'req-1', sessionId: 's1', title: 'bash',
      rawInput: { command: 'rm -rf build' },
      options: [
        { optionId: 'allow', kind: 'allow_once', title: '允许本次' },
        { optionId: 'deny', kind: 'reject_once', title: '拒绝' },
      ],
    }, 9)).toMatchObject({
      requestId: 'req-1', kind: 'permission', sessionId: 's1',
      detail: 'rm -rf build', receivedAt: 9,
      permissionOptions: [
        { optionId: 'allow', kind: 'allow_once', title: '允许本次' },
        { optionId: 'deny', kind: 'reject_once', title: '拒绝' },
      ],
    })
  })

  it('ignores requests without an id and drops malformed options', () => {
    expect(permissionApproval({})).toBeNull()
    expect(permissionApproval({ requestId: 'r', options: [{ kind: 'allow' }] })?.permissionOptions).toEqual([])
    expect(permissionApproval({ requestId: 'r' })?.title).toBe('需要你的批准')
  })
})

describe('questionApproval', () => {
  it('carries everything the card needs', () => {
    expect(questionApproval({
      requestId: 'r1', sessionId: 's1', kind: 'select', title: '选择方式',
      options: ['One', 'Two'], message: '二选一',
    }, 5)).toMatchObject({
      requestId: 'r1', sessionId: 's1', kind: 'question', questionKind: 'select',
      options: ['One', 'Two'], detail: '二选一', receivedAt: 5,
    })
  })
})

describe('trustApproval', () => {
  it('is stable per folder and explains the consequence', () => {
    expect(trustRequestId('/w')).toBe('trust:/w')
    expect(trustApproval('/w', 7)).toMatchObject({ requestId: 'trust:/w', kind: 'trust', cwd: '/w', receivedAt: 7 })
    expect(trustApproval('/w').detail).toContain('/w')
  })

  // The event carries only a cwd; without a session the card followed the user
  // into every other conversation (and blocked their finished-turn state).
  it('attaches the session when the event knows one', () => {
    expect(trustApproval('/w', 7, 's1')).toMatchObject({ sessionId: 's1' })
    expect(trustApproval('/w', 7)).not.toHaveProperty('sessionId')
  })
})

describe('shouldDismissAfterAnswer', () => {
  // Both answers end a trust card: recorded-but-still-visible cards were the
  // reason follow-up chips never appeared again.
  it('always dismisses a trust card', () => {
    expect(shouldDismissAfterAnswer('trust', { type: 'trust', trusted: true })).toBe(true)
    expect(shouldDismissAfterAnswer('trust', { type: 'trust', trusted: false })).toBe(true)
  })

  it('dismisses permission and question cards once answered', () => {
    expect(shouldDismissAfterAnswer('permission', { type: 'permission' })).toBe(true)
    expect(shouldDismissAfterAnswer('question', { type: 'question' })).toBe(true)
  })
})

describe('sessionsWithPendingApprovals', () => {
  // A card recovered for a conversation the user is not reading must still be
  // discoverable from the list, otherwise "recovered" means "invisible".
  it('collects distinct session ids and ignores session-less cards', () => {
    const ids = sessionsWithPendingApprovals([
      { sessionId: 's1' }, { sessionId: 's1' }, { sessionId: 's2' }, {},
    ])
    expect([...ids].sort()).toEqual(['s1', 's2'])
    expect(sessionsWithPendingApprovals([]).size).toBe(0)
  })
})

describe('reconcileApprovals', () => {
  const OLD = 1_000
  const NOW = 10_000
  const card = (patch: Partial<Approval> & Pick<Approval, 'kind' | 'requestId'>): Approval => ({
    sessionId: 's1', title: 't', receivedAt: OLD, ...patch,
  })

  it('drops stale cards the desktop is no longer waiting on', () => {
    const approvals = [
      card({ kind: 'permission', requestId: 'p1' }),
      card({ kind: 'question', requestId: 'q1' }),
      card({ kind: 'trust', requestId: 'trust:/w', cwd: '/w' }),
    ]
    expect(reconcileApprovals(approvals, {
      permission: new Set(), question: new Set(), trustCwds: new Set(),
    }, NOW)).toEqual([])
  })

  it('keeps cards still pending and keeps everything when a source is unknown', () => {
    const approvals = [card({ kind: 'permission', requestId: 'p1' })]
    expect(reconcileApprovals(approvals, { permission: new Set(['p1']) }, NOW)).toHaveLength(1)
    expect(reconcileApprovals(approvals, { permission: null }, NOW)).toHaveLength(1)
    expect(reconcileApprovals(approvals, {}, NOW)).toHaveLength(1)
  })

  it('protects a just-arrived card inside the grace window', () => {
    const fresh = { ...card({ kind: 'permission', requestId: 'p1' }), receivedAt: NOW - 100 }
    expect(reconcileApprovals([fresh], { permission: new Set() }, NOW)).toHaveLength(1)
    expect(reconcileApprovals([fresh], { permission: new Set() }, NOW, 0)).toHaveLength(0)
  })

  it('matches trust cards by cwd, not requestId', () => {
    const trust = card({ kind: 'trust', requestId: 'trust:/w', cwd: '/w' })
    expect(reconcileApprovals([trust], { trustCwds: new Set(['/w']) }, NOW)).toHaveLength(1)
    expect(reconcileApprovals([trust], { trustCwds: new Set(['/other']) }, NOW)).toHaveLength(0)
  })

  it('returns the same reference when nothing is dropped', () => {
    const approvals = [card({ kind: 'permission', requestId: 'p1' })]
    expect(reconcileApprovals(approvals, { permission: new Set(['p1']) }, NOW)).toBe(approvals)
  })
})

describe('permission mode', () => {
  it('accepts only the three known modes', () => {
    expect(parsePermissionMode('ask')).toBe('ask')
    expect(parsePermissionMode('auto')).toBe('auto')
    expect(parsePermissionMode('always-approve')).toBe('always-approve')
    expect(parsePermissionMode('nope')).toBeNull()
    expect(parsePermissionMode(undefined)).toBeNull()
  })

  it('labels each mode for the settings row', () => {
    expect(permissionModeLabel('ask')).toContain('询问')
    expect(permissionModeLabel('auto')).toContain('自动')
    expect(permissionModeLabel('always-approve')).toContain('完全')
    expect(permissionModeLabel(null)).toContain('未提供')
  })
})

describe('failed answers keep the card', () => {
  // §2.4: 「回答失败保留卡片并提示，不自动重试」. The store re-throws so the
  // caller can tell success from failure; swallowing made every caller believe
  // the desktop had accepted the answer and drop the card.
  it('only a resolved answer dismisses', () => {
    expect(shouldDismissAfterAnswer('permission', { type: 'permission' })).toBe(true)
    expect(shouldDismissAfterAnswer('question', { type: 'question' })).toBe(true)
  })

  it('keeps the trust request id stable so a retry targets the same card', () => {
    expect(trustRequestId('/w')).toBe('trust:/w')
  })
})
