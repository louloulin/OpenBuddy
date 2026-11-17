/**
 * Phone-side view models (20261115-mobile.md §4.2).
 *
 * These live in `core` rather than in the store so that both the store and the
 * design-review fixture can name them without importing each other (which would
 * be a cycle).
 */

import type { CachedSession } from '../db/cache'

/** A permission / question / trust request waiting on the user. */
export type Approval = {
  requestId: string
  kind: 'permission' | 'question' | 'trust'
  sessionId?: string
  title: string
  detail?: string
  /** Permission options as the desktop sent them (optionId/kind/title). */
  permissionOptions?: { optionId: string; kind: string; title: string }[]
  /** Question options, for the select kind. */
  options?: string[]
  questionKind?: 'select' | 'confirm' | 'input' | 'editor'
  placeholder?: string
  initialValue?: string
  secret?: boolean
  expiresAt?: number
  /** Folder-trust requests carry the directory they are about. */
  cwd?: string
  receivedAt: number
}

/** One running desktop task (`tasks_list`). */
export type RunningTask = {
  id: string
  kind?: string
  description?: string
  status?: string
  sessionId?: string
  title?: string
  startedAt?: number
  pending?: number
}

/** One row of the notification centre. */
export type NotificationItem = {
  id: string
  kind: 'approval' | 'question' | 'done' | 'scheduled'
  title: string
  body: string
  sessionId?: string
  read: boolean
  at: number
}

export type { CachedSession }
