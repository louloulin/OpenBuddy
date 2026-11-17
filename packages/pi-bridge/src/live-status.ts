/**
 * Live session status for the gateway's push watcher
 * (20261115-mobile.md §5.8, loop closure).
 *
 * The gateway does not read transcripts: it polls `GET /api/sessions/live-status`
 * on the desktop and turns *transitions* into push events (a session starts
 * waiting, a running session disappears). The desktop's own events are enough
 * to answer that question, so this tracker observes the same stream the phone
 * subscribes to and keeps only what the poll needs.
 *
 * Rules:
 *   - any turn activity (`message_*`, `toolcall_*`, `agent_start`, queue) → running
 *   - `agent://permission` for a session → waiting (with the request id)
 *   - dismissing or resolving that permission → running again, or gone
 *   - `agent_settled` / a turn error → gone (the watcher reads "gone" as done)
 *   - a running session silent for `runningTtlMs` → gone, so a crashed desktop
 *     cannot leave a phone told "still working" forever
 *
 * Pure except for `now()`, so the transitions are testable without a timer.
 */

export type LiveActivityState = 'running' | 'waiting'

export type LiveSession = {
  id: string
  activityState: LiveActivityState
  pendingToolName?: string
  pendingRequestId?: string
  scheduledTaskId?: string
}

type Tracked = LiveSession & { lastSeen: number }

const RUNNING_TTL_MS = 10 * 60_000

/** Update types that mean "the desktop is working on this session". */
const ACTIVITY_TYPES = new Set([
  'agent_start',
  'message_start',
  'message_delta',
  'message_update',
  'message_end',
  'toolcall_start',
  'toolcall_delta',
  'toolcall_end',
  'tool_result',
  'queue_update',
  'compaction_start',
  'compaction_end',
])

const END_TYPES = new Set(['agent_settled', 'prompt_complete', 'agent_error'])

export type LiveStatusTracker = {
  observe: (event: string, payload: unknown) => void
  /** `{ sessions: [...] }`, the shape the gateway parses. */
  snapshot: () => { sessions: LiveSession[] }
  clear: () => void
  /** Sessions currently tracked, for tests. */
  size: () => number
}

export function createLiveStatusTracker(options: { now?: () => number; runningTtlMs?: number } = {}): LiveStatusTracker {
  const now = options.now ?? (() => Date.now())
  const ttl = options.runningTtlMs ?? RUNNING_TTL_MS
  const sessions = new Map<string, Tracked>()

  const touch = (id: string, next: Omit<LiveSession, 'id'>): void => {
    sessions.set(id, { id, ...next, lastSeen: now() })
  }

  const observe = (event: string, payload: unknown): void => {
    const at = now()

    if (event === 'agent://permission') {
      const record = payload as { requestId?: unknown; sessionId?: unknown; toolKind?: unknown; title?: unknown; scheduledTaskId?: unknown } | null
      const requestId = typeof record?.requestId === 'string' ? record.requestId : ''
      const sessionId = typeof record?.sessionId === 'string' ? record.sessionId : ''
      if (!requestId || !sessionId) return
      const toolName = typeof record?.toolKind === 'string' ? record.toolKind : typeof record?.title === 'string' ? record.title : undefined
      touch(sessionId, {
        activityState: 'waiting',
        pendingRequestId: requestId,
        ...(toolName ? { pendingToolName: toolName } : {}),
        ...(typeof record?.scheduledTaskId === 'string' ? { scheduledTaskId: record.scheduledTaskId } : {}),
      })
      return
    }

    if (event === 'agent://permission-dismiss') {
      const record = payload as { requestId?: unknown; sessionId?: unknown } | null
      const sessionId = typeof record?.sessionId === 'string' ? record.sessionId : ''
      if (!sessionId) return
      const current = sessions.get(sessionId)
      if (!current || current.activityState !== 'waiting') return
      // The turn continues after an approval; only a settled turn removes it,
      // which arrives separately.
      touch(sessionId, {
        activityState: 'running',
        ...(current.scheduledTaskId ? { scheduledTaskId: current.scheduledTaskId } : {}),
      })
      return
    }

    if (event !== 'agent://event') return
    const envelope = payload as { sessionId?: unknown; event?: { type?: unknown; scheduledTaskId?: unknown } } | null
    const sessionId = typeof envelope?.sessionId === 'string' ? envelope.sessionId : ''
    const type = typeof envelope?.event?.type === 'string' ? envelope.event.type : ''
    if (!sessionId || !type) return

    if (END_TYPES.has(type)) {
      sessions.delete(sessionId)
      return
    }
    if (!ACTIVITY_TYPES.has(type)) return

    const current = sessions.get(sessionId)
    const scheduledTaskId = typeof envelope?.event?.scheduledTaskId === 'string'
      ? envelope.event.scheduledTaskId
      : current?.scheduledTaskId
    if (current?.activityState === 'waiting') {
      // Activity while a permission is pending does not mean the user answered
      // it; keep the waiting answer until the dismiss arrives.
      current.lastSeen = at
      if (scheduledTaskId) current.scheduledTaskId = scheduledTaskId
      return
    }
    touch(sessionId, {
      activityState: 'running',
      ...(scheduledTaskId ? { scheduledTaskId } : {}),
    })
  }

  const snapshot = (): { sessions: LiveSession[] } => {
    const cutoff = now() - ttl
    const out: LiveSession[] = []
    for (const [id, tracked] of sessions) {
      if (tracked.activityState === 'running' && tracked.lastSeen < cutoff) {
        sessions.delete(id)
        continue
      }
      out.push({
        id,
        activityState: tracked.activityState,
        ...(tracked.pendingToolName ? { pendingToolName: tracked.pendingToolName } : {}),
        ...(tracked.pendingRequestId ? { pendingRequestId: tracked.pendingRequestId } : {}),
        ...(tracked.scheduledTaskId ? { scheduledTaskId: tracked.scheduledTaskId } : {}),
      })
    }
    return { sessions: out }
  }

  return {
    observe,
    snapshot,
    clear: () => sessions.clear(),
    size: () => sessions.size,
  }
}
