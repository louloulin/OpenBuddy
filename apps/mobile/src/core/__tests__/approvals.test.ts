import { describe, expect, it } from 'vitest'

import {
  parsePermissionMode, permissionDetail, permissionModeLabel, permissionOptionId, questionApproval,
  shouldDismissAfterAnswer, trustApproval, trustRequestId,
} from '../approvals'

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
