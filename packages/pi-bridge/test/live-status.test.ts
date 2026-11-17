import { describe, expect, test } from 'bun:test'

import { createLiveStatusTracker } from '../src/live-status.js'

const activity = (sessionId: string, type = 'message_delta') => ({ sessionId, event: { type } })

describe('live status tracker', () => {
  test('turn activity marks a session running, settled removes it', () => {
    const tracker = createLiveStatusTracker()
    tracker.observe('agent://event', activity('s1', 'agent_start'))
    expect(tracker.snapshot().sessions).toEqual([{ id: 's1', activityState: 'running' }])

    tracker.observe('agent://event', activity('s1', 'agent_settled'))
    expect(tracker.snapshot().sessions).toEqual([])
  })

  test('a permission request marks the session waiting with its request id', () => {
    const tracker = createLiveStatusTracker()
    tracker.observe('agent://event', activity('s1'))
    tracker.observe('agent://permission', { requestId: 'req-1', sessionId: 's1', toolKind: 'agent_bash' })

    expect(tracker.snapshot().sessions).toEqual([
      { id: 's1', activityState: 'waiting', pendingRequestId: 'req-1', pendingToolName: 'agent_bash' },
    ])
  })

  test('activity while waiting does not clear the waiting answer', () => {
    const tracker = createLiveStatusTracker()
    tracker.observe('agent://permission', { requestId: 'req-1', sessionId: 's1', toolKind: 'read_text_file' })
    tracker.observe('agent://event', activity('s1', 'message_delta'))
    expect(tracker.snapshot().sessions[0]).toMatchObject({ activityState: 'waiting', pendingRequestId: 'req-1' })
  })

  test('dismissing a permission returns the session to running', () => {
    const tracker = createLiveStatusTracker()
    tracker.observe('agent://permission', { requestId: 'req-1', sessionId: 's1', toolKind: 'agent_bash' })
    tracker.observe('agent://permission-dismiss', { requestId: 'req-1', sessionId: 's1' })
    expect(tracker.snapshot().sessions).toEqual([{ id: 's1', activityState: 'running' }])
  })

  test('a dismissed permission on a settled session does not resurrect it', () => {
    const tracker = createLiveStatusTracker()
    tracker.observe('agent://permission', { requestId: 'req-1', sessionId: 's1', toolKind: 'agent_bash' })
    tracker.observe('agent://event', activity('s1', 'agent_settled'))
    tracker.observe('agent://permission-dismiss', { requestId: 'req-1', sessionId: 's1' })
    expect(tracker.snapshot().sessions).toEqual([])
  })

  test('a silent running session expires, a waiting one does not', () => {
    let clock = 1_000
    const tracker = createLiveStatusTracker({ now: () => clock, runningTtlMs: 5_000 })
    tracker.observe('agent://event', activity('running-session'))
    tracker.observe('agent://permission', { requestId: 'req-1', sessionId: 'waiting-session', toolKind: 'agent_bash' })

    clock += 10_000
    expect(tracker.snapshot().sessions).toEqual([
      { id: 'waiting-session', activityState: 'waiting', pendingRequestId: 'req-1', pendingToolName: 'agent_bash' },
    ])

    // A fresh event keeps a running session alive again.
    clock += 1_000
    tracker.observe('agent://event', activity('running-session', 'message_start'))
    expect(tracker.snapshot().sessions.map(session => session.id).sort()).toEqual(['running-session', 'waiting-session'])
  })

  test('malformed payloads are ignored', () => {
    const tracker = createLiveStatusTracker()
    tracker.observe('agent://permission', null)
    tracker.observe('agent://permission', { sessionId: 's1' })
    tracker.observe('agent://event', { sessionId: 's1' })
    tracker.observe('agent://event', 'nope')
    tracker.observe('agent://event', { event: { type: 'message_delta' } })
    expect(tracker.size()).toBe(0)
  })

  test('scheduled task ids are carried through', () => {
    const tracker = createLiveStatusTracker()
    tracker.observe('agent://event', { sessionId: 's1', event: { type: 'agent_start', scheduledTaskId: 'auto-1' } })
    expect(tracker.snapshot().sessions[0]).toMatchObject({ scheduledTaskId: 'auto-1' })
  })
})
