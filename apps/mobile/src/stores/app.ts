/**
 * One store for the whole app (20261115-mobile.md §4.1, §5.1).
 *
 * The screens read state and call actions; nothing else touches the transport.
 * Events are folded through `core/transcript.ts`, then written to the SQLite
 * cache so the next cold start paints without waiting for the network.
 */

import { Platform } from 'react-native'
import { create } from 'zustand'
import * as LocalAuthentication from 'expo-local-authentication'

import type { SessionUpdate } from '@openbuddy/protocol/dto'
import type { Transport, TransportState } from '@openbuddy/client/transport'

import {
  cacheSessions,
  cacheTranscript,
  dequeueMessage,
  forgetCachedSession,
  queueMessage,
  readCachedSessions,
  readCachedTranscript,
  readQueue,
  type CachedSession,
} from '../db/cache'
import { applyUpdate, emptyTranscript, transcriptPreview, type Transcript } from '../core/transcript'
import { canSendNow } from '../core/connection'
import { isPreview, previewState } from '../core/preview'
import type { Capabilities } from '../core/surface'
import {
  checkNewSession, workspaceChoices, type InitAnswer, type WorkspaceChoice, type WorkspaceInfo,
} from '../core/new-session'
import { cleanSessionTitle } from '../core/session-actions'
import { isThinkingLevel, nextThinkingLevel, thinkingLevelPayload, type ThinkingLevel } from '../core/session-panel'
import { exportFilename, isTruncatedRead, jsonlEntryCount, MAX_EXPORT_BYTES } from '../core/export'
import type { BatchOutcome } from '../core/batch'
import { toSessionList } from '../core/session-list'
import { toProjects, type ProjectRef } from '../core/projects'
import { toNotifications } from '../core/notification-list'
import { bumpUnread, clearUnread, shouldMarkUnread } from '../core/unread'
import {
  LOCK_KEY, lockUnavailableReason, parseLockSetting, serializeLockSetting, shouldRelock,
  type LockAvailability,
} from '../core/app-lock'
import { getItem, setItem } from '../transport/storage'
import {
  parseSpeakSetting, serializeSpeakSetting, shouldSpeak, SPEAK_KEY,
} from '../core/speech'
import { speak } from '../native/speech'
import {
  dispositionFor, withoutQueueItem, type QueueRow, type TurnQueue,
} from '../core/turn-input'
import type { Approval, NotificationItem, RunningTask } from '../core/models'
import {
  parsePermissionMode, permissionDetail, permissionOptionId, questionApproval, trustApproval,
  type PermissionMode, type QuestionRequest,
} from '../core/approvals'
import type { PairPayload } from '../core/pairing'
import {
  claimPair,
  clearPairing,
  closeActiveTransport,
  loadActivePairingId,
  loadPairings,
  openTransport,
  pairingFromRecord,
  reconnectTransport,
  saveActivePairingId,
  savePairing,
  savePairingRecords,
  uploadImage,
  type Pairing,
} from '../transport'
import {
  findPairing, removePairing, resolveActiveId, upsertPairing, type PairingRecord,
} from '../core/pairings'


type AppState = {
  booted: boolean
  pairing: Pairing | null
  /** Every computer this phone has paired with (E3 multi-desktop). */
  pairings: PairingRecord[]
  activePairingId: string | null
  transport: Transport | null
  connection: TransportState
  capabilities: Capabilities | null
  sessions: CachedSession[]
  /** The session on screen; settles for any other one become unread marks. */
  activeSessionId: string | null
  transcripts: Record<string, Transcript>
  approvals: Approval[]
  notifications: NotificationItem[]
  /** True once `notification_list` answered (the tab avoids a false empty state). */
  notificationsLoaded: boolean
  /** Running desktop tasks for the task drawer. */
  tasks: RunningTask[]
  permissionMode: PermissionMode | null
  /** Thinking level per session, as last read from the desktop. */
  thinkingLevels: Record<string, ThinkingLevel>
  /** Sessions that were sent to but have not answered yet. */
  awaiting: string[]
  /** Desktop turn queues per session (steering / follow-up). */
  queues: Record<string, TurnQueue>
  error: string | null
  /** Face ID / fingerprint gate (§4.2 P1). */
  appLock: boolean
  locked: boolean
  backgroundedAt: number | null
  /** Read assistant replies of the open conversation out loud. */
  autoSpeak: boolean

  bootstrap: () => Promise<void>
  pair: (payload: PairPayload, deviceName: string) => Promise<void>
  unpair: () => Promise<void>
  /** Reconnects to another paired desktop (E3). */
  switchPairing: (id: string) => Promise<boolean>
  /** Forgets one pairing; switching to the next when it was the active one. */
  forgetPairing: (id: string) => Promise<void>
  openSession: (sessionId: string) => Promise<void>
  setActiveSession: (sessionId: string | null) => void
  markSessionRead: (sessionId: string) => Promise<void>
  refreshSessions: () => Promise<void>
  /** One-shot composer drafts (handoff prefills a new session). */
  drafts: Record<string, string>
  setDraft: (sessionId: string, text: string) => void
  /** Workspaces the desktop offers for a new session (plus its current cwd). */
  workspaces: WorkspaceChoice[]
  /** Desktop projects used to fold the session list (C5). */
  projects: ProjectRef[]
  /** The desktop's current working directory, as last reported. */
  currentCwd: string | null
  refreshWorkspaces: () => Promise<void>
  /** Creates a session on the desktop and returns its id, for the caller to open. */
  createSession: (cwd?: string) => Promise<string | null>
  forkSession: (sessionId: string) => Promise<string | null>
  handoffSession: (sessionId: string, goal: string) => Promise<{ sessionId: string; prompt: string } | null>
  compactSession: (sessionId: string, instructions?: string) => Promise<void>
  /** Pulls the JSONL the desktop exported, for the share sheet. */
  exportSession: (sessionId: string) => Promise<{ filename: string; content: string; entries: number }>
  send: (sessionId: string, text: string, attachments?: { path: string }[]) => Promise<void>
  /** Interrupts the running turn with new instructions. */
  steer: (sessionId: string, text: string) => Promise<void>
  refreshQueue: (sessionId: string) => Promise<void>
  removeQueued: (sessionId: string, row: QueueRow) => Promise<void>
  clearQueue: (sessionId: string) => Promise<void>
  sendImage: (sessionId: string, bytes: ArrayBuffer, mime: string, text?: string) => Promise<void>
  sendImages: (sessionId: string, images: { bytes: ArrayBuffer; mime: string }[], text?: string) => Promise<void>
  resolveApproval: (requestId: string, approved: boolean, reason?: string) => Promise<void>
  resolveQuestion: (requestId: string, sessionId: string, value?: string | boolean, cancelled?: boolean) => Promise<void>
  resolveTrust: (cwd: string, trusted: boolean) => Promise<void>
  refreshTasks: () => Promise<void>
  /** Loads the notification backlog the desktop recorded. */
  refreshNotifications: () => Promise<void>
  killTask: (taskId: string) => Promise<void>
  refreshPermissionMode: () => Promise<void>
  /** Reads the session's thinking level for the composer chip. */
  refreshThinkingLevel: (sessionId: string) => Promise<void>
  /** Cycles the level and tells the desktop; returns the new level. */
  cycleThinkingLevel: (sessionId: string) => Promise<ThinkingLevel | null>
  revoked: () => Promise<void>
  resume: () => void
  regenerate: (sessionId: string) => Promise<void>
  setSessionPinned: (sessionId: string, pinned: boolean) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  setSessionArchived: (sessionId: string, archived: boolean) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  /** Multi-select: one desktop call per session, failures kept per item. */
  archiveSessions: (sessionIds: string[], archived: boolean) => Promise<BatchOutcome>
  deleteSessions: (sessionIds: string[]) => Promise<BatchOutcome>
  markNotificationsRead: () => Promise<void>
  dismissError: () => void
  lockAvailability: () => Promise<LockAvailability>
  setAppLock: (enabled: boolean) => Promise<{ ok: boolean; reason?: string }>
  unlockApp: () => Promise<boolean>
  noteBackground: () => void
  relockIfNeeded: () => void
  setAutoSpeak: (enabled: boolean) => Promise<void>
}

const ASSISTANT_EVENT = 'agent://event'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useApp = create<AppState>((set, get) => ({
  booted: false,
  pairing: null,
  pairings: [],
  activePairingId: null,
  transport: null,
  connection: 'closed',
  capabilities: null,
  sessions: [],
  workspaces: [],
  projects: [],
  currentCwd: null,
  drafts: {},
  activeSessionId: null,
  transcripts: {},
  approvals: [],
  notifications: [],
  notificationsLoaded: false,
  tasks: [],
  permissionMode: null,
  thinkingLevels: {},
  awaiting: [],
  queues: {},
  error: null,
  appLock: false,
  locked: false,
  backgroundedAt: null,
  autoSpeak: false,

  /** Cached paint first, then the connection catches up. */
  async bootstrap() {
    const cached = await readCachedSessions().catch(() => [])
    set({ sessions: cached })

    const known = await loadPairings().catch(() => ({ list: [] as PairingRecord[], activeId: undefined }))
    const activeRecord = findPairing(known.list, known.activeId)
    const pairing = activeRecord ? pairingFromRecord(activeRecord) : null
    const appLock = parseLockSetting(await getItem(LOCK_KEY).catch(() => null))
    const autoSpeak = parseSpeakSetting(await getItem(SPEAK_KEY).catch(() => null))
    // The lock-screen shot is a separate review build so the other screens are
    // not blocked behind a gate no simulator can pass.
    const previewLock = isPreview() && process.env.EXPO_PUBLIC_UI_PREVIEW_LOCK === '1'

    // Design review build: render the real screens from a fixed dataset and
    // skip the network entirely. Compiled away unless the flag was set.
    if (isPreview()) {
      const demo = previewState()
      set({
        booted: true,
        pairing: { gatewayUrl: 'https://gw.openbuddy.example', deviceToken: 'preview', deviceName: '我的手机' },
        pairings: [{
          id: 'preview#desktop', label: '书房 Mac', gatewayUrl: 'https://gw.openbuddy.example',
          deviceToken: 'preview', deviceName: '我的手机', lastUsedAt: Date.now(),
        }],
        activePairingId: 'preview#desktop',
        connection: 'open',
        permissionMode: null,
        thinkingLevels: demo.panel?.thinkingLevel && isThinkingLevel(demo.panel.thinkingLevel)
          ? { [demo.sessions[0]?.id ?? 'sess-refactor']: demo.panel.thinkingLevel }
          : {},
        capabilities: demo.capabilities,
        sessions: demo.sessions,
        projects: demo.projects,
        currentCwd: demo.sessions[0]?.cwd ?? null,
        transcripts: demo.transcripts,
        notifications: demo.notifications,
        approvals: demo.approvals,
        awaiting: demo.awaiting,
        appLock: appLock || previewLock,
        locked: appLock || previewLock,
        autoSpeak,
      })
      return
    }

    set({
      pairing, booted: true, appLock, locked: appLock, autoSpeak,
      pairings: known.list, activePairingId: known.activeId ?? null,
    })
    if (!pairing) return

    const transport = await openTransport(pairing, {
      onUnauthorized: () => { void get().revoked() },
    })
    set({ transport, connection: transport.state() })
    transport.onState(state => set({ connection: state }))

    // Subscribe before the first invoke so no turn is missed in the gap.
    await attachListeners(transport, set, get)

    await get().refreshSessions()
    await loadCapabilities(get, set)
    void get().refreshPermissionMode()
    void get().refreshNotifications()
    await flushQueue(get)
  },

  async pair(payload, deviceName) {
    try {
      const pairing = await claimPair(payload, deviceName)
      await savePairing(pairing)
      const known = await loadPairings().catch(() => ({ list: [] as PairingRecord[], activeId: undefined }))
      set({
        pairing,
        pairings: known.list,
        activePairingId: known.activeId ?? null,
        error: null,
      })
      const transport = await openTransport(pairing)
      set({ transport, connection: transport.state() })
      transport.onState(state => set({ connection: state }))
      await attachListeners(transport, set, get)
      await get().refreshSessions()
      await loadCapabilities(get, set)
      void get().refreshPermissionMode()
      void get().refreshNotifications()
    } catch (error) {
      set({ error: errorText(error) })
      throw error
    }
  },

  /** The desktop revoked this device (or the gateway forgot it): pair again. */
  async revoked() {
    closeActiveTransport()
    // The desktop refused this credential: forget that pairing only, keeping
    // any other computers the phone still trusts.
    const activeId = get().activePairingId
    const remaining = activeId ? removePairing(get().pairings, activeId) : get().pairings
    await savePairingRecords(remaining)
    const nextId = resolveActiveId(remaining)
    await saveActivePairingId(nextId)
    await clearPairing().catch(() => {})
    set({
      transport: null,
      pairing: null,
      pairings: remaining,
      activePairingId: nextId ?? null,
      connection: 'closed',
      capabilities: null,
      error: '这台电脑已经解除了这台手机，请重新扫码配对。',
    })
  },

  /** Called when the app comes back to the foreground: the tunnel is gone. */
  resume() {
    reconnectTransport()
  },

  async unpair() {
    const activeId = get().activePairingId
    if (activeId) {
      await get().forgetPairing(activeId)
      return
    }
    closeActiveTransport()
    set({ transport: null, pairing: null, connection: 'closed', capabilities: null, sessions: [], transcripts: {}, approvals: [] })
  },

  /**
   * E3: one transport, one active pairing. Switching tears the old stream down
   * and rebuilds state from the new desktop instead of trying to merge them.
   */
  async switchPairing(id) {
    const record = findPairing(get().pairings, id)
    if (!record) return false
    const next = upsertPairing(get().pairings, { ...record, lastUsedAt: Date.now() })
    await savePairingRecords(next)
    await saveActivePairingId(record.id)
    const pairing = pairingFromRecord(record)
    closeActiveTransport()
    set({
      pairing,
      pairings: next,
      activePairingId: record.id,
      transport: null,
      connection: 'connecting',
      capabilities: null,
      sessions: [],
      transcripts: {},
      approvals: [],
      notifications: [],
      notificationsLoaded: false,
      awaiting: [],
      queues: {},
      tasks: [],
      thinkingLevels: {},
      projects: [],
      currentCwd: null,
      drafts: {},
      workspaces: [],
      error: null,
    })
    try {
      const transport = await openTransport(pairing, {
        onUnauthorized: () => { void get().revoked() },
      })
      set({ transport, connection: transport.state() })
      transport.onState(state => set({ connection: state }))
      await attachListeners(transport, set, get)
      await get().refreshSessions()
      await loadCapabilities(get, set)
      void get().refreshPermissionMode()
      void get().refreshNotifications()
      return true
    } catch (error) {
      set({ error: errorText(error), connection: 'closed' })
      return false
    }
  },

  async forgetPairing(id) {
    const remaining = removePairing(get().pairings, id)
    await savePairingRecords(remaining)
    const wasActive = get().activePairingId === id
    if (!wasActive) {
      set({ pairings: remaining })
      return
    }
    const nextId = resolveActiveId(remaining)
    closeActiveTransport()
    if (!nextId) {
      await saveActivePairingId(undefined)
      await clearPairing().catch(() => {})
      set({
        pairing: null, pairings: [], activePairingId: null, transport: null,
        connection: 'closed', capabilities: null, sessions: [], transcripts: {},
        approvals: [], notifications: [], awaiting: [], queues: {}, tasks: [],
        thinkingLevels: {}, projects: [], currentCwd: null,
      })
      return
    }
    set({ pairings: remaining, activePairingId: nextId })
    await get().switchPairing(nextId)
  },

  async openSession(sessionId) {
    // Reading a conversation clears its badge, even before history arrives.
    await get().markSessionRead(sessionId)
    void get().refreshQueue(sessionId)
    // Cached transcript paints immediately.
    if (!get().transcripts[sessionId]) {
      const rows = await readCachedTranscript(sessionId).catch(() => [])
      if (rows.length) {
        set(state => ({ transcripts: { ...state.transcripts, [sessionId]: { rows, lastAssistantText: '' } } }))
      }
    }
    const transport = get().transport
    if (!transport) return
    try {
      // The reply carries history; events carry everything after it.
      const history = await transport.invoke<{ updates?: SessionUpdate[] }>('agent_load_session', { sessionId })
      if (history?.updates?.length) {
        let transcript = emptyTranscript()
        for (const update of history.updates) transcript = applyUpdate(transcript, update, sessionId)
        set(state => ({ transcripts: { ...state.transcripts, [sessionId]: transcript } }))
        await cacheTranscript(sessionId, transcript.rows).catch(() => {})
      }
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  /** The chat screen owns this: entering marks read, leaving stops new marks. */
  setActiveSession(sessionId) {
    set({ activeSessionId: sessionId })
    if (sessionId) void get().markSessionRead(sessionId)
  },

  async markSessionRead(sessionId) {
    let changed = false
    const sessions = get().sessions.map(session => {
      if (session.id !== sessionId) return session
      const next = clearUnread(session)
      if (next !== session) changed = true
      return next
    })
    if (!changed) return
    set({ sessions })
    await cacheSessions(sessions).catch(() => {})
  },

  async refreshWorkspaces() {
    const transport = get().transport
    if (!transport) return
    try {
      const [init, list] = await Promise.all([
        transport.invoke<InitAnswer>('agent_init', {}).catch(() => null),
        transport.invoke<WorkspaceInfo[]>('agent_list_workspaces', {}).catch(() => []),
      ])
      const current = typeof init?.cwd === 'string' ? init.cwd : null
      set({ workspaces: workspaceChoices(current, Array.isArray(list) ? list : []) })
    } catch {
      // The picker falls back to "current directory only".
    }
  },

  async createSession(cwd) {
    const transport = get().transport
    if (!transport) return null
    try {
      // The directory and the model belong to the computer: ask where it works
      // and let the desktop pick its default model.
      const init = await transport.invoke<InitAnswer>('agent_init', {})
      const check = checkNewSession(cwd ? { ...init, cwd } : init)
      if (!check.ok) {
        set({ error: check.reason })
        return null
      }
      const sessionId = await transport.invoke<string>('agent_new_session', { cwd: check.cwd })
      if (typeof sessionId !== 'string' || !sessionId) throw new Error('桌面没有返回会话 id')
      await get().refreshSessions()
      set(state => ({
        sessions: state.sessions.some(session => session.id === sessionId)
          ? state.sessions
          : [{
            id: sessionId,
            title: '新会话',
            updatedAt: Date.now(),
            pinned: false,
            archived: false,
            preview: '',
            unread: 0,
          }, ...state.sessions],
        error: null,
      }))
      return sessionId
    } catch (failure) {
      set({ error: errorText(failure) })
      return null
    }
  },

  async forkSession(sessionId) {
    const transport = get().transport
    if (!transport) return null
    try {
      const forked = await transport.invoke<string>('agent_fork_session', { sessionId })
      if (typeof forked !== 'string' || !forked) throw new Error('桌面没有返回分叉会话 id')
      await get().refreshSessions()
      return forked
    } catch (error) {
      set({ error: errorText(error) })
      return null
    }
  },

  /** Hands the thread to a fresh session; the draft stays in the caller's hands. */
  async handoffSession(sessionId, goal) {
    const transport = get().transport
    if (!transport) return null
    try {
      const result = await transport.invoke<{ sessionId?: unknown; prompt?: unknown }>('agent_handoff', { sessionId, goal })
      if (typeof result?.sessionId !== 'string' || !result.sessionId) throw new Error('桌面没有返回交接会话')
      await get().refreshSessions()
      return { sessionId: result.sessionId, prompt: typeof result.prompt === 'string' ? result.prompt : '' }
    } catch (error) {
      set({ error: errorText(error) })
      return null
    }
  },

  async compactSession(sessionId, instructions) {
    const transport = get().transport
    if (!transport) return
    try {
      await transport.invoke('agent_compact', {
        sessionId,
        ...(instructions?.trim() ? { instructions: instructions.trim() } : {}),
      })
      await get().refreshSessions()
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  /**
   * The desktop writes the file (it owns the transcript); the phone reads it
   * back as text. A read that hit the host's 16MB cap is refused rather than
   * shared as a silently broken export.
   */
  async exportSession(sessionId) {
    const transport = get().transport
    if (!transport) throw new Error('电脑未连接')
    const path = await transport.invoke<string>('agent_export_jsonl', { sessionId })
    if (typeof path !== 'string' || !path) throw new Error('桌面没有返回导出路径')
    const content = await transport.invoke<string>('read_text_file', { path, maxBytes: MAX_EXPORT_BYTES })
    if (isTruncatedRead(content)) throw new Error('会话超过 16MB，请在电脑上导出。')
    const title = get().sessions.find(session => session.id === sessionId)?.title ?? ''
    return { filename: exportFilename(title, sessionId), content, entries: jsonlEntryCount(content) }
  },

  setDraft(sessionId, text) {
    set(state => {
      const drafts = { ...state.drafts }
      if (text) drafts[sessionId] = text
      else delete drafts[sessionId]
      return { drafts }
    })
  },

  async refreshSessions() {
    const transport = get().transport
    if (!transport) return
    try {
      // `agent_list_sessions` is per workspace. Ask the desktop for its current
      // directory and the other workspaces, then merge the pages so the phone
      // sees the same sessions the sidebar does.
      const init = await transport.invoke<InitAnswer>('agent_init', {}).catch(() => null)
      const currentCwd = typeof init?.cwd === 'string' ? init.cwd : null
      const spaces = await transport.invoke<WorkspaceInfo[]>('agent_list_workspaces', {}).catch(() => [])
      const cwds = [...new Set([
        currentCwd,
        ...(Array.isArray(spaces) ? spaces.map(space => space.cwd) : []),
      ].filter((value): value is string => typeof value === 'string' && !!value))].slice(0, 12)

      let raw: unknown = []
      if (cwds.length) {
        const pages = await Promise.all(cwds.map(cwd =>
          transport.invoke<unknown>('agent_list_sessions', { cwd, includeArchived: true }).catch(() => []),
        ))
        raw = pages.flat()
      } else {
        // An older desktop (or a test host) answers without a workspace.
        raw = await transport.invoke<unknown>('agent_list_sessions', {}).catch(() => [])
      }

      const known = new Map(get().sessions.map(session => [session.id, session]))
      const sessions: CachedSession[] = toSessionList(raw).map(item => {
        const previous = known.get(item.id)
        const transcript = get().transcripts[item.id]
        return {
          ...item,
          cwd: item.cwd ?? previous?.cwd,
          preview: transcript ? transcriptPreview(transcript) : previous?.preview ?? '',
          unread: previous?.unread ?? 0,
        }
      })

      const projects = await transport.invoke<unknown>('projects_snapshot', {}).catch(() => null)
      set(state => ({
        sessions,
        currentCwd,
        projects: projects === null ? state.projects : toProjects(projects),
        error: null,
      }))
      await cacheSessions(sessions).catch(() => {})
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  async send(sessionId, text, attachments = []) {
    const body = text.trim()
    if (!body && attachments.length === 0) return
    const { transport, connection } = get()
    if (!transport) return

    if (!canSendNow(connection)) {
      const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, sessionId, text: body, attachments, queuedAt: Date.now() }
      await queueMessage(item).catch(() => {})
      const local: SessionUpdate = { type: 'message_end', sessionId, message: { role: 'user', content: body } }
      ingestUpdate(set, get, sessionId, local)
      return
    }

    // A running turn rejects `agent_send`; queue it the way the desktop
    // composer does. Steer is a separate, explicit action.
    if (dispositionFor(get().awaiting.includes(sessionId)) === 'follow_up') {
      try {
        await transport.invoke('agent_follow_up', {
          sessionId,
          text: body,
          ...(attachments.length ? { attachments } : {}),
        })
        await get().refreshQueue(sessionId)
        return
      } catch {
        // The turn may have settled between the check and the invoke; fall
        // through to a normal send instead of losing the message.
      }
    }

    const local: SessionUpdate = { type: 'message_end', sessionId, message: { role: 'user', content: body } }
    ingestUpdate(set, get, sessionId, local)
    // The desktop shows its waiting row the moment a message is sent; the
    // phone must too, or the gap before the first token looks like a dead app.
    set(state => ({ awaiting: state.awaiting.includes(sessionId) ? state.awaiting : [...state.awaiting, sessionId] }))
    try {
      await transport.invoke('agent_send', { sessionId, text: body, attachments })
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  /** Interrupt the running turn (desktop `agent_steer`). */
  async steer(sessionId, text) {
    const transport = get().transport
    const body = text.trim()
    if (!transport || !body) return
    try {
      await transport.invoke('agent_steer', { sessionId, text: body })
      await get().refreshQueue(sessionId)
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  async refreshQueue(sessionId) {
    const transport = get().transport
    if (!transport) return
    try {
      const queue = await transport.invoke<TurnQueue | null>('agent_get_queue', { sessionId })
      set(state => ({
        queues: {
          ...state.queues,
          [sessionId]: {
            steering: Array.isArray(queue?.steering) ? queue.steering : [],
            followUp: Array.isArray(queue?.followUp) ? queue.followUp : [],
          },
        },
      }))
    } catch {
      // Queue display is best-effort; sending still works without it.
    }
  },

  async removeQueued(sessionId, row) {
    const transport = get().transport
    const queue = get().queues[sessionId]
    if (!transport || !queue) return
    const next = withoutQueueItem(queue, row.kind, row.index)
    try {
      const result = await transport.invoke<TurnQueue>('agent_set_queue', {
        sessionId,
        steering: next.steering,
        followUp: next.followUp,
      })
      set(state => ({
        queues: {
          ...state.queues,
          [sessionId]: {
            steering: Array.isArray(result?.steering) ? result.steering : next.steering,
            followUp: Array.isArray(result?.followUp) ? result.followUp : next.followUp,
          },
        },
      }))
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  async clearQueue(sessionId) {
    const transport = get().transport
    if (!transport) return
    try {
      await transport.invoke('agent_clear_queue', { sessionId })
      set(state => ({ queues: { ...state.queues, [sessionId]: { steering: [], followUp: [] } } }))
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  async sendImage(sessionId, bytes, mime, text = '') {
    const pairing = get().pairing
    if (!pairing) return
    try {
      const path = await uploadImage(pairing, bytes, mime)
      await get().send(sessionId, text, [{ path }])
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  /** Several pictures in one turn; each becomes one attachment. */
  async sendImages(sessionId, images, text = '') {
    const pairing = get().pairing
    if (!pairing) return
    try {
      const paths: { path: string }[] = []
      for (const image of images) {
        paths.push({ path: await uploadImage(pairing, image.bytes, image.mime) })
      }
      await get().send(sessionId, text, paths)
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  async resolveApproval(requestId, approved, reason) {
    const transport = get().transport
    if (!transport) return
    const approval = get().approvals.find(item => item.requestId === requestId)
    try {
      await transport.invoke('agent_resolve_permission', {
        requestId,
        optionId: permissionOptionId(approval ?? {}, approved),
        cancelled: false,
        ...(reason?.trim() ? { reason: reason.trim().slice(0, 500) } : {}),
      })
      set(state => ({ approvals: state.approvals.filter(item => item.requestId !== requestId) }))
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  /** Extension UI question (`agent://ui-request`); one card covers all kinds. */
  async resolveQuestion(requestId, sessionId, value, cancelled = false) {
    const transport = get().transport
    if (!transport) return
    try {
      await transport.invoke('agent_resolve_ui', {
        requestId,
        sessionId,
        ...(cancelled ? { cancelled: true } : { value }),
      })
      set(state => ({ approvals: state.approvals.filter(item => item.requestId !== requestId) }))
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  async resolveTrust(cwd, trusted) {
    const transport = get().transport
    if (!transport) return
    try {
      await transport.invoke('folder_trust_respond', { cwd, trusted })
      set(state => ({ approvals: state.approvals.filter(item => item.requestId !== `trust:${cwd}`) }))
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  async refreshTasks() {
    const transport = get().transport
    if (!transport) return
    try {
      const list = await transport.invoke<RunningTask[]>('tasks_list', {})
      set({ tasks: Array.isArray(list) ? list : [] })
    } catch {
      // Task drawer is best-effort; a failed poll keeps the previous list.
    }
  },

  async refreshNotifications() {
    const transport = get().transport
    if (!transport) {
      set({ notificationsLoaded: true })
      return
    }
    try {
      const list = await transport.invoke<unknown>('notification_list', {})
      set({ notifications: toNotifications(list), notificationsLoaded: true })
    } catch {
      // An older desktop may not serve it; keep whatever push delivered.
      set({ notificationsLoaded: true })
    }
  },

  async killTask(taskId) {
    const transport = get().transport
    if (!transport) return
    try {
      await transport.invoke('task_kill', { taskId })
      await get().refreshTasks()
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  async refreshPermissionMode() {
    const transport = get().transport
    if (!transport) return
    try {
      const raw = await transport.invoke<unknown>('permission_mode_get', {})
      set({ permissionMode: parsePermissionMode(raw) })
    } catch {
      // Desktop not advertising it: leave the row hidden.
    }
  },

  async refreshThinkingLevel(sessionId) {
    if (isPreview()) return
    const transport = get().transport
    if (!transport) return
    try {
      const state = await transport.invoke<{ thinkingLevel?: unknown }>('agent_get_model_state', { sessionId })
      const level = state?.thinkingLevel
      if (isThinkingLevel(level)) {
        set(previous => ({ thinkingLevels: { ...previous.thinkingLevels, [sessionId]: level } }))
      }
    } catch {
      // Desktop without the command: the chip stays hidden.
    }
  },

  async cycleThinkingLevel(sessionId) {
    const current = get().thinkingLevels[sessionId]
    const next = nextThinkingLevel(current)
    const payload = thinkingLevelPayload(next)
    const transport = get().transport
    if (!payload) return null
    if (!transport) {
      set(previous => ({ thinkingLevels: { ...previous.thinkingLevels, [sessionId]: next } }))
      return next
    }
    try {
      await transport.invoke('agent_set_thinking_level', { sessionId, ...payload })
      set(previous => ({ thinkingLevels: { ...previous.thinkingLevels, [sessionId]: next } }))
      return next
    } catch (error) {
      set({ error: errorText(error) })
      return null
    }
  },

  /** Asks the desktop to run the turn again — the desktop keeps the history. */
  async regenerate(sessionId) {
    const transport = get().transport
    if (!transport) return
    try {
      await transport.invoke('agent_regenerate', { sessionId })
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  /** Session management mirrors the desktop sidebar's menu (§4.2 P0). */
  async setSessionPinned(sessionId, pinned) {
    const transport = get().transport
    if (!transport) return
    try {
      await transport.invoke('agent_set_session_pinned', { sessionId, pinned })
      await patchSession(get, set, sessionId, { pinned })
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  async renameSession(sessionId, title) {
    const transport = get().transport
    const clean = cleanSessionTitle(title)
    if (!transport || !clean) return
    try {
      await transport.invoke('agent_rename_session', { sessionId, title: clean })
      await patchSession(get, set, sessionId, { title: clean })
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  async setSessionArchived(sessionId, archived) {
    const transport = get().transport
    if (!transport) return
    try {
      await transport.invoke('agent_set_session_archived', { sessionId, archived })
      await patchSession(get, set, sessionId, { archived })
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  /** Forgets the session locally only after the desktop confirms the delete. */
  async deleteSession(sessionId) {
    const transport = get().transport
    if (!transport) return
    try {
      await transport.invoke('agent_delete_session', { sessionId })
      const sessions = get().sessions.filter(session => session.id !== sessionId)
      set(state => {
        const transcripts = { ...state.transcripts }
        delete transcripts[sessionId]
        return {
          sessions,
          transcripts,
          awaiting: state.awaiting.filter(id => id !== sessionId),
        }
      })
      await Promise.all([
        cacheSessions(sessions).catch(() => {}),
        forgetCachedSession(sessionId).catch(() => {}),
      ])
    } catch (error) {
      set({ error: errorText(error) })
    }
  },

  /** Batch archive: sequential so one refusal cannot strand the rest. */
  async archiveSessions(sessionIds, archived) {
    const transport = get().transport
    const outcome: BatchOutcome = { ok: [], failed: [] }
    if (!transport) {
      return { ok: [], failed: sessionIds.map(id => ({ id, reason: '电脑未连接' })) }
    }
    for (const sessionId of sessionIds) {
      try {
        await transport.invoke('agent_set_session_archived', { sessionId, archived })
        await patchSession(get, set, sessionId, { archived })
        outcome.ok.push(sessionId)
      } catch (error) {
        outcome.failed.push({ id: sessionId, reason: errorText(error) })
      }
    }
    return outcome
  },

  /** Batch delete: local cache is forgotten only for the ids the desktop accepted. */
  async deleteSessions(sessionIds) {
    const transport = get().transport
    const outcome: BatchOutcome = { ok: [], failed: [] }
    if (!transport) {
      return { ok: [], failed: sessionIds.map(id => ({ id, reason: '电脑未连接' })) }
    }
    for (const sessionId of sessionIds) {
      try {
        await transport.invoke('agent_delete_session', { sessionId })
        forgetSessionLocal(set, sessionId)
        outcome.ok.push(sessionId)
      } catch (error) {
        outcome.failed.push({ id: sessionId, reason: errorText(error) })
      }
    }
    if (outcome.ok.length) {
      await Promise.all([
        cacheSessions(get().sessions).catch(() => {}),
        ...outcome.ok.map(id => forgetCachedSession(id).catch(() => {})),
      ])
    }
    return outcome
  },

  async markNotificationsRead() {
    const transport = get().transport
    set(state => ({ notifications: state.notifications.map(item => ({ ...item, read: true })) }))
    await transport?.invoke('notification_mark_all_read', {}).catch(() => {})
  },

  async lockAvailability() {
    if (Platform.OS === 'web') return 'unsupported'
    try {
      if (!(await LocalAuthentication.hasHardwareAsync())) return 'no-hardware'
      if (!(await LocalAuthentication.isEnrolledAsync())) return 'not-enrolled'
      return 'ready'
    } catch {
      return 'unsupported'
    }
  },

  /** Enabling needs hardware; disabling needs a successful scan first. */
  async setAppLock(enabled) {
    if (enabled) {
      const availability = await get().lockAvailability()
      if (availability !== 'ready') {
        return { ok: false, reason: lockUnavailableReason(availability) ?? undefined }
      }
    } else {
      const unlocked = await get().unlockApp()
      if (!unlocked) return { ok: false, reason: '没有通过验证，应用锁保持开启。' }
    }
    await setItem(LOCK_KEY, serializeLockSetting(enabled)).catch(() => {})
    set({ appLock: enabled, ...(enabled ? {} : { locked: false }) })
    return { ok: true }
  },

  async unlockApp() {
    if (!get().appLock) {
      set({ locked: false })
      return true
    }
    if (Platform.OS === 'web') return false
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: '解锁 OpenBuddy',
        cancelLabel: '取消',
      })
      if (!result.success) return false
    } catch {
      return false
    }
    set({ locked: false, backgroundedAt: null })
    return true
  },

  noteBackground() {
    if (get().appLock) set({ backgroundedAt: Date.now() })
  },

  relockIfNeeded() {
    if (shouldRelock(get().appLock, get().backgroundedAt, Date.now())) {
      set({ locked: true, backgroundedAt: null })
    }
  },

  async setAutoSpeak(enabled) {
    await setItem(SPEAK_KEY, serializeSpeakSetting(enabled)).catch(() => {})
    set({ autoSpeak: enabled })
  },

  dismissError() {
    set({ error: null })
  },
}))

/** The mobile surface, straight from the host (never a local deny list). */
async function loadCapabilities(
  get: () => AppState,
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
): Promise<void> {
  const pairing = get().pairing
  if (!pairing) return
  try {
    const response = await fetch(`${pairing.gatewayUrl}/api/capabilities`, {
      headers: { authorization: `Bearer ${pairing.deviceToken}` },
    })
    if (!response.ok) return
    const body = (await response.json()) as Capabilities
    if (Array.isArray(body.commands)) set({ capabilities: body })
  } catch {
    // A capabilities probe failure is not worth an error banner: the session
    // list already reports the connection state.
  }
}

/** Applies one confirmed metadata change to the list and the cold-start cache. */
async function patchSession(
  get: () => AppState,
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  sessionId: string,
  patch: Partial<Pick<CachedSession, 'title' | 'pinned' | 'archived'>>,
): Promise<void> {
  const sessions = get().sessions.map(session => session.id === sessionId ? { ...session, ...patch } : session)
  set({ sessions })
  await cacheSessions(sessions).catch(() => {})
}

/** Drops a confirmed-deleted session from memory (the cache write is batched). */
function forgetSessionLocal(
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  sessionId: string,
): void {
  set(state => {
    const transcripts = { ...state.transcripts }
    delete transcripts[sessionId]
    return {
      sessions: state.sessions.filter(session => session.id !== sessionId),
      transcripts,
      awaiting: state.awaiting.filter(id => id !== sessionId),
    }
  })
}

type SetState = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void

function upsertApproval(set: SetState, item: Approval): void {
  set(state => ({
    approvals: [...state.approvals.filter(entry => entry.requestId !== item.requestId), item],
  }))
}

function removeApproval(set: SetState, requestId: string): void {
  set(state => ({ approvals: state.approvals.filter(item => item.requestId !== requestId) }))
}

/**
 * One subscription set for every transport, used by bootstrap and by re-pairing
 * (re-pairing previously forgot the permission listener, so approvals went
 * silent until the next launch).
 */
async function attachListeners(transport: Transport, set: SetState, get: () => AppState): Promise<void> {
  await transport.listen(ASSISTANT_EVENT, payload => {
    const envelope = payload as { sessionId?: string; event?: SessionUpdate }
    if (envelope.event) ingestUpdate(set, get, envelope.sessionId, envelope.event)
  })

  await transport.listen('agent://permission', payload => {
    const request = payload as {
      requestId?: string
      sessionId?: string
      title?: string
      rawInput?: unknown
      options?: { optionId?: unknown; kind?: unknown; title?: unknown }[]
    }
    if (!request.requestId) return
    upsertApproval(set, {
      requestId: request.requestId,
      kind: 'permission',
      sessionId: request.sessionId,
      title: request.title ?? '需要你的批准',
      detail: permissionDetail(request.rawInput),
      permissionOptions: Array.isArray(request.options)
        ? request.options
          .filter(option => typeof option?.optionId === 'string')
          .map(option => ({
            optionId: String(option.optionId),
            kind: typeof option.kind === 'string' ? option.kind : 'allow',
            title: typeof option.title === 'string' ? option.title : String(option.optionId),
          }))
        : undefined,
      receivedAt: Date.now(),
    })
  })
  await transport.listen('agent://permission-dismiss', payload => {
    const id = (payload as { requestId?: string }).requestId
    if (id) removeApproval(set, id)
  })

  await transport.listen('agent://ui-request', payload => {
    const request = payload as QuestionRequest
    if (!request?.requestId || !request.sessionId) return
    upsertApproval(set, questionApproval(request))
  })
  await transport.listen('agent://ui-dismiss', payload => {
    const id = (payload as { requestId?: string }).requestId
    if (id) removeApproval(set, id)
  })

  await transport.listen('agent://folder-trust', payload => {
    const cwd = (payload as { cwd?: unknown }).cwd
    if (typeof cwd === 'string' && cwd) upsertApproval(set, trustApproval(cwd))
  })

  await transport.listen('agent://permission-mode', payload => {
    const mode = parsePermissionMode((payload as { mode?: unknown }).mode)
    if (mode) set({ permissionMode: mode })
  })
}

/** Folds one event into the session transcript and persists it. */
function ingestUpdate(
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
  sessionId: string | undefined,
  update: SessionUpdate,
): void {
  const key = sessionId ?? update.sessionId ?? update.__sessionId
  if (!key) return
  if (update.type === 'agent_settled') {
    const markUnread = shouldMarkUnread(key, get().activeSessionId)
    set(state => {
      const awaiting = state.awaiting.includes(key)
        ? state.awaiting.filter(id => id !== key)
        : state.awaiting
      if (!markUnread) return awaiting === state.awaiting ? {} : { awaiting }
      return {
        awaiting,
        sessions: state.sessions.map(session => session.id === key ? bumpUnread(session) : session),
      }
    })
    if (markUnread) void cacheSessions(get().sessions).catch(() => {})
    // Read-aloud follows the screen, not the notification stream: a reply in
    // another conversation becomes an unread mark instead of audio.
    if (shouldSpeak(get().autoSpeak, key, get().activeSessionId)) {
      const text = get().transcripts[key]?.lastAssistantText
      if (text) speak(text)
    }
    // A settled turn drains one queued item; sync the chip row.
    void get().refreshQueue(key)
  }
  const current = get().transcripts[key] ?? emptyTranscript()
  const next = applyUpdate(current, update, key)
    if (next === current) return

  const preview = transcriptPreview(next)
  set(state => ({
    transcripts: { ...state.transcripts, [key]: next },
    sessions: state.sessions.map(session => session.id === key
      ? { ...session, preview, updatedAt: Date.now() }
      : session),
  }))
  void cacheTranscript(key, next.rows).catch(() => {})
}

/** Sends anything queued while the desktop was unreachable. */
async function flushQueue(get: () => AppState): Promise<void> {
  const transport = get().transport
  if (!transport) return
  const queue = await readQueue().catch(() => [])
  for (const item of queue) {
    try {
      await transport.invoke('agent_send', { sessionId: item.sessionId, text: item.text, attachments: item.attachments })
      await dequeueMessage(item.id).catch(() => {})
    } catch {
      break
    }
  }
}
