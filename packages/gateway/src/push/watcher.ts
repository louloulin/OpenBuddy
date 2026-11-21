/**
 * Turns the desktop server's live-session poll into push events.
 *
 * The gateway does not read transcripts and does not decide what matters: it
 * watches the same `live-status` answer the phone's session list uses, and
 * reports only the transitions a user would want to be interrupted by. That
 * keeps the notification decision in one pure function that can be tested
 * without a server, a socket, or a timer.
 *
 * A session leaves `live-status` when it stops working, so "finished" is
 * observed as a disappearance rather than a state change. That is also why a
 * session waiting on the user and then dropped produces no event: the user
 * already answered it, or the session ended — neither is news.
 */

import { LEGACY_ROUTE, type AgentHub } from '../relay/hub.js'
import type { PushKind } from './types.js'

export type LiveActivityState = 'running' | 'waiting'

export type LiveSession = {
  id: string
  activityState: LiveActivityState
  /** What the session is waiting on, when it says. */
  pendingToolName?: string
  /** The waiting approval's request id, so a push button can answer it. */
  pendingRequestId?: string
  /** Set when this session was started by a scheduled task. */
  scheduledTaskId?: string
}

export type SessionEvent = {
  kind: PushKind
  sessionId: string
  toolName?: string
  requestId?: string
  scheduledTaskId?: string
}

export const LIVE_STATUS_PATH = '/api/sessions/live-status'

/** Reads the `{ sessions: [...] }` envelope, ignoring anything malformed. */
export function parseLiveStatus(payload: unknown): LiveSession[] {
  const sessions = (payload as { sessions?: unknown } | null)?.sessions
  if (!Array.isArray(sessions)) return []
  const live: LiveSession[] = []
  for (const entry of sessions) {
    const id = (entry as { id?: unknown } | null)?.id
    const state = (entry as { activityState?: unknown } | null)?.activityState
    if (typeof id !== 'string' || !id) continue
    if (state !== 'running' && state !== 'waiting') continue
    const toolName = (entry as { pendingToolName?: unknown } | null)?.pendingToolName
    const requestId = (entry as { pendingRequestId?: unknown } | null)?.pendingRequestId
    const scheduledTaskId = (entry as { scheduledTaskId?: unknown } | null)?.scheduledTaskId
    live.push({
      id,
      activityState: state,
      ...(state === 'waiting' && typeof toolName === 'string' && toolName
        ? { pendingToolName: toolName }
        : {}),
      ...(state === 'waiting' && typeof requestId === 'string' && requestId
        ? { pendingRequestId: requestId }
        : {}),
      ...(typeof scheduledTaskId === 'string' && scheduledTaskId ? { scheduledTaskId } : {}),
    })
  }
  return live
}

/**
 * The asking tool may arrive namespaced (`mcp__x__AskUserQuestion`), so the
 * match is a case-insensitive substring rather than an exact name.
 */
const ASK_USER_QUESTION = /askuserquestion/i

/**
 * Events implied by moving from one live-status answer to the next.
 *
 * `absent → waiting` counts because a session can ask for approval before the
 * first poll that would have seen it running; `waiting → absent` does not,
 * because the only ways out of waiting are the user answering or the session
 * ending.
 */
export function diffLiveStatus(
  previous: ReadonlyMap<string, LiveActivityState>,
  next: readonly LiveSession[],
  previousScheduled?: ReadonlySet<string>,
): SessionEvent[] {
  const events: SessionEvent[] = []
  const present = new Set<string>()

  for (const session of next) {
    present.add(session.id)
    if (session.activityState !== 'waiting') continue
    if (previous.get(session.id) === 'waiting') continue
    const asking = ASK_USER_QUESTION.test(session.pendingToolName ?? '')
    events.push({
      kind: asking ? 'question' : 'approval',
      sessionId: session.id,
      ...(session.pendingToolName ? { toolName: session.pendingToolName } : {}),
      ...(session.pendingRequestId ? { requestId: session.pendingRequestId } : {}),
      ...(session.scheduledTaskId ? { scheduledTaskId: session.scheduledTaskId } : {}),
    })
  }

  for (const [id, state] of previous) {
    if (present.has(id)) continue
    if (state !== 'running') continue
    events.push({
      kind: previousScheduled?.has(id) ? 'scheduled' : 'done',
      sessionId: id,
    })
  }

  return events
}

export type LiveStatusSource = {
  hub: AgentHub
  upstreamUrl: string
  upstreamToken?: string
  /**
   * Which desktop to read through. An account desktop is read through its own
   * agent and nowhere else — falling back to the gateway's upstream would
   * report another machine's sessions to this user's phones.
   */
  route?: string
}

/**
 * Reads live-status through the agent tunnel when one is connected, and
 * directly otherwise — the same choice the HTTP proxy makes, so a gateway on
 * the desktop's LAN keeps working with no agent at all.
 */
export function createLiveStatusReader(source: LiveStatusSource): () => Promise<LiveSession[]> {
  return async () => {
    const headers: Record<string, string> = { accept: 'application/json', 'accept-encoding': 'identity' }
    if (source.upstreamToken) headers.authorization = `Bearer ${source.upstreamToken}`

    const route = source.route
    if (route) {
      if (!source.hub.isOnline(route)) throw new Error('desktop offline')
      const response = await source.hub.requestHttp(route, { method: 'GET', path: LIVE_STATUS_PATH, headers })
      if (!response.ok) throw new Error(`live-status returned ${response.status}`)
      return parseLiveStatus(await response.json())
    }

    if (source.hub.legacyConnected) {
      const response = await source.hub.requestHttp(LEGACY_ROUTE, { method: 'GET', path: LIVE_STATUS_PATH, headers })
      if (!response.ok) throw new Error(`live-status returned ${response.status}`)
      return parseLiveStatus(await response.json())
    }

    const response = await fetch(`${source.upstreamUrl}${LIVE_STATUS_PATH}`, { headers })
    if (!response.ok) throw new Error(`live-status returned ${response.status}`)
    return parseLiveStatus(await response.json())
  }
}

export type SessionWatcherOptions = {
  /** Current live sessions; throwing marks the poll as failed. */
  read: () => Promise<LiveSession[]>
  onEvents: (events: SessionEvent[]) => void | Promise<void>
  intervalMs?: number
  onError?: (error: unknown) => void
  /**
   * Skips the read entirely when nobody could receive the result. A skipped
   * poll does not advance state, so a session that starts waiting before any
   * device registers is still reported once one does.
   */
  shouldPoll?: () => boolean
}

export type SessionWatcher = {
  /** Starts polling; the first poll only seeds state and emits nothing. */
  start: () => void
  stop: () => void
  /** Runs one poll; exposed so tests do not depend on the timer. */
  poll: () => Promise<SessionEvent[]>
}

export const DEFAULT_WATCH_INTERVAL_MS = 5_000

/**
 * Polls on a self-scheduling timer rather than `setInterval`: a slow upstream
 * must not stack overlapping polls, and a failed poll must not reset the
 * knowledge of what was already reported.
 */
export function createSessionWatcher(options: SessionWatcherOptions): SessionWatcher {
  const intervalMs = options.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS
  const onError = options.onError ?? (() => {})

  const state = new Map<string, LiveActivityState>()
  let scheduled = new Set<string>()
  let seeded = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const poll = async (): Promise<SessionEvent[]> => {
    if (options.shouldPoll && !options.shouldPoll()) return []
    const next = await options.read()
    const events = seeded ? diffLiveStatus(state, next, scheduled) : []

    state.clear()
    const nextScheduled = new Set<string>()
    for (const session of next) {
      state.set(session.id, session.activityState)
      if (session.scheduledTaskId) nextScheduled.add(session.id)
    }
    scheduled = nextScheduled
    seeded = true

    if (events.length > 0) await options.onEvents(events)
    return events
  }

  const schedule = () => {
    if (!running) return
    timer = setTimeout(() => {
      void tick()
    }, intervalMs)
  }

  const tick = async () => {
    if (!running) return
    try {
      await poll()
    } catch (error) {
      // A failed read keeps the previous state, so a recovered poll still
      // reports the transitions that happened while the server was away.
      onError(error)
    } finally {
      schedule()
    }
  }

  return {
    start: () => {
      if (running) return
      running = true
      void tick()
    },
    stop: () => {
      running = false
      if (timer) clearTimeout(timer)
      timer = null
    },
    poll,
  }
}
