import { describe, expect, it } from 'vitest'

import { APPROVE_ACTION, APPROVAL_CATEGORY, DENY_ACTION, decisionForResponse } from '../push-actions'

describe('notification approval actions', () => {
  it('maps allow/deny presses onto a decision', () => {
    expect(decisionForResponse(APPROVE_ACTION, { requestId: 'req-1' })).toEqual({ requestId: 'req-1', approved: true })
    expect(decisionForResponse(DENY_ACTION, { requestId: 'req-1' })).toEqual({ requestId: 'req-1', approved: false })
  })

  it('ignores a plain tap and payloads without a request', () => {
    expect(decisionForResponse('expo.modules.notifications.actions.DEFAULT', { requestId: 'req-1' })).toBeNull()
    expect(decisionForResponse(APPROVE_ACTION, {})).toBeNull()
    expect(decisionForResponse(APPROVE_ACTION, null)).toBeNull()
  })

  it('keeps identifiers stable for the iOS category registration', () => {
    expect(APPROVAL_CATEGORY).toBe('approval')
  })
})
