/**
 * One store for the whole app (20261115-mobile.md §4.1, §5.1).
 *
 * The screens read state and call actions; nothing else touches the transport.
 * Events are folded through `core/transcript.ts`, then written to the SQLite
 * cache so the next cold start paints without waiting for the network.
 */

import { create } from 'zustand'

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
import { checkNewSession, type InitAnswer } from '../core/new-session'
import { cleanSessionTitle } from '../core/session-actions'
import { bumpUnread, clearUnread, shouldMarkUnread } from '../core/unread'
import type { Approval, NotificationItem } from '../core/models'
import type { PairPayload } from '../core/pairing'
import {
  claimPair,
  clearPairing,
  closeActiveTransport,
  loadPairing,
  openTransport,
  reconnectTransport,
  savePairing,
  uploadImage,
  type Pairing,
} from '../transport'


type AppState = {
  booted: boolean
  pairing: Pairing | null
  transport: Transport | null
  connection: TransportState
  capabilities: Capabilities | null
  sessions: CachedSession[]
  /** The session on screen; settles for any other one become unread marks. */
  activeSessionId: string | null
  transcripts: Record<string, Transcript>
  approvals: Approval[]
  notifications: NotificationItem[]
  /** Sessions that were sent to but have not answered yet. */
  awaiting: string[]
  error: string | null

  bootstrap: () => Promise<void>
  pair: (payload: PairPayload, deviceName: string) => Promise<void>
  unpair: () => Promise<void>
  openSession: (sessionId: string) => Promise<void>
  setActiveSession: (sessionId: string | null) => void
  markSessionRead: (sessionId: string) => Promise<void>
  refreshSessions: () => Promise<void>
  /** Creates a session on the desktop and returns its id, for the caller to open. */
  createSession: () => Promise<string | null>
  send: (sessionId: string, text: string, attachments?: { path: string }[]) => Promise<void>
  sendImage: (sessionId: string, bytes: ArrayBuffer, mime: string, text?: string) => Promise<void>
  sendImages: (sessionId: string, images: { bytes: ArrayBuffer; mime: string }[], text?: string) => Promise<void>
  resolveApproval: (requestId: string, approved: boolean, reason?: string) => Promise<void>
  revoked: () => Promise<void>
  resume: () => void
  regenerate: (sessionId: string) => Promise<void>
  setSessionPinned: (sessionId: string, pinned: boolean) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  setSessionArchived: (sessionId: string, archived: boolean) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  markNotificationsRead: () => Promise<void>
  dismissError: () => void
}

const ASSISTANT_EVENT = 'agent://event'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useApp = create<AppState>((set, get) => ({
  booted: false,
  pairing: null,
  transport: null,
  connection: 'closed',
  capabilities: null,
  sessions: [],
  activeSessionId: null,
  transcripts: {},
  approvals: [],
  notifications: [],
  awaiting: [],
  error: null,

  /** Cached paint first, then the connection catches up. */
  async bootstrap() {
    const cached = await readCachedSessions().catch(() => [])
    set({ sessions: cached })

    const pairing = await loadPairing().catch(() => null)

    // Design review build: render the real screens from a fixed dataset and
    // skip the network entirely. Compiled away unless the flag was set.
    if (isPreview()) {
      const demo = previewState()
      set({
        booted: true,
        pairing: { gatewayUrl: 'https://gw.openbuddy.example', deviceToken: 'preview', deviceName: '我的手机' },
        connection: 'open',
        capabilities: demo.capabilities,
        sessions: demo.sessions,
        transcripts: demo.transcripts,
        notifications: demo.notifications,
        approvals: demo.approvals,
        awaiting: demo.awaiting,
      })
      return
    }

    set({ pairing, booted: true })
    if (!pairing) return

    const transport = await openTransport(pairing, {
      onUnauthorized: () => { void get().revoked() },
    })
    set({ transport, connection: transport.state() })
    transport.onState(state => set({ connection: state }))

    // Subscribe before the first invoke so no turn is missed in the gap.
    await transport.listen(ASSISTANT_EVENT, payload => {
      const envelope = payload as { sessionId?: string; event?: SessionUpdate }
      if (!envelope.event) return
      ingestUpdate(set, get, envelope.sessionId, envelope.event)
    })
    await transport.listen('agent://permission', payload => {
      const request = payload as Partial<Approval> & { requestId?: string }
      if (!request.requestId) return
      const item: Approval = {
        requestId: request.requestId,
        kind: 'permission',
        sessionId: request.sessionId,
        title: request.title ?? '需要你的批准',
        detail: request.detail,
        options: request.options,
        receivedAt: Date.now(),
      }
      set(state => ({ approvals: [...state.approvals.filter(a => a.requestId !== item.requestId), item] }))
    })

    await get().refreshSessions()
    await loadCapabilities(get, set)
    await flushQueue(get)
  },

  async pair(payload, deviceName) {
    try {
      const pairing = await claimPair(payload, deviceName)
      await savePairing(pairing)
      set({ pairing, error: null })
      const transport = await openTransport(pairing)
      set({ transport, connection: transport.state() })
      transport.onState(state => set({ connection: state }))
      await transport.listen(ASSISTANT_EVENT, event => {
        const envelope = event as { sessionId?: string; event?: SessionUpdate }
        if (envelope.event) ingestUpdate(set, get, envelope.sessionId, envelope.event)
      })
      await get().refreshSessions()
      await loadCapabilities(get, set)
    } catch (error) {
      set({ error: errorText(error) })
      throw error
    }
  },

  /** The desktop revoked this device (or the gateway forgot it): pair again. */
  async revoked() {
    closeActiveTransport()
    await clearPairing().catch(() => {})
    set({
      transport: null,
      pairing: null,
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
    closeActiveTransport()
    set({ transport: null, pairing: null, connection: 'closed', capabilities: null, sessions: [], transcripts: {}, approvals: [] })
  },

  async openSession(sessionId) {
    // Reading a conversation clears its badge, even before history arrives.
    await get().markSessionRead(sessionId)
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

  async createSession() {
    const transport = get().transport
    if (!transport) return null
    try {
      // The directory and the model belong to the computer: ask where it works
      // and let the desktop pick its default model.
      const init = await transport.invoke<InitAnswer>('agent_init', {})
      const check = checkNewSession(init)
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

  async refreshSessions() {
    const transport = get().transport
    if (!transport) return
    try {
      const list = await transport.invoke<Array<{ id: string; title?: string; updatedAt?: number; pinned?: boolean; archived?: boolean }>>(
        'agent_list_sessions', {},
      )
      const sessions: CachedSession[] = (Array.isArray(list) ? list : []).map(item => {
        const known = get().sessions.find(session => session.id === item.id)
        const transcript = get().transcripts[item.id]
        return {
          id: item.id,
          title: item.title ?? '未命名会话',
          updatedAt: item.updatedAt ?? known?.updatedAt ?? Date.now(),
          pinned: item.pinned ?? known?.pinned ?? false,
          archived: item.archived ?? known?.archived ?? false,
          preview: transcript ? transcriptPreview(transcript) : known?.preview ?? '',
          unread: known?.unread ?? 0,
        }
      })
      set({ sessions, error: null })
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
    try {
      await transport.invoke('agent_resolve_permission', {
        requestId,
        decision: approved ? 'allow' : 'deny',
        ...(reason ? { reason } : {}),
      })
      set(state => ({ approvals: state.approvals.filter(item => item.requestId !== requestId) }))
    } catch (error) {
      set({ error: errorText(error) })
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

  async markNotificationsRead() {
    const transport = get().transport
    set(state => ({ notifications: state.notifications.map(item => ({ ...item, read: true })) }))
    await transport?.invoke('notification_mark_all_read', {}).catch(() => {})
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
