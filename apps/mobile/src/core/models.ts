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
  options?: string[]
  receivedAt: number
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
