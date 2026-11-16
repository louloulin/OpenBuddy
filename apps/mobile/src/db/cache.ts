/**
 * Cold-start cache (20261115-mobile.md §4.6).
 *
 * The first screen has to paint before the network does anything, so the last
 * known session list and the last transcript per session live in SQLite. The
 * schema is append-only: rows are replaced by id, never diffed.
 */

import * as SQLite from 'expo-sqlite'

import type { TranscriptRow } from '../core/transcript'

export type CachedSession = {
  id: string
  title: string
  updatedAt: number
  pinned: boolean
  archived: boolean
  preview: string
  unread: number
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const handle = await SQLite.openDatabaseAsync('openbuddy.db')
      await handle.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          pinned INTEGER NOT NULL DEFAULT 0,
          archived INTEGER NOT NULL DEFAULT 0,
          preview TEXT NOT NULL DEFAULT '',
          unread INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS transcripts (
          session_id TEXT PRIMARY KEY NOT NULL,
          rows TEXT NOT NULL,
          saved_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS outbox (
          id TEXT PRIMARY KEY NOT NULL,
          session_id TEXT NOT NULL,
          text TEXT NOT NULL,
          attachments TEXT NOT NULL,
          queued_at INTEGER NOT NULL
        );
      `)
      return handle
    })()
  }
  return dbPromise
}

export async function cacheSessions(sessions: CachedSession[]): Promise<void> {
  const handle = await db()
  await handle.withTransactionAsync(async () => {
    for (const session of sessions) {
      await handle.runAsync(
        `INSERT INTO sessions (id, title, updated_at, pinned, archived, preview, unread)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, updated_at = excluded.updated_at,
           pinned = excluded.pinned, archived = excluded.archived,
           preview = excluded.preview, unread = excluded.unread`,
        [session.id, session.title, session.updatedAt, session.pinned ? 1 : 0, session.archived ? 1 : 0, session.preview, session.unread],
      )
    }
  })
}

export async function readCachedSessions(): Promise<CachedSession[]> {
  const handle = await db()
  const rows = await handle.getAllAsync<{
    id: string
    title: string
    updated_at: number
    pinned: number
    archived: number
    preview: string
    unread: number
  }>(`SELECT * FROM sessions ORDER BY pinned DESC, updated_at DESC`)
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    preview: row.preview,
    unread: row.unread,
  }))
}

export async function cacheTranscript(sessionId: string, rows: TranscriptRow[]): Promise<void> {
  const handle = await db()
  await handle.runAsync(
    `INSERT INTO transcripts (session_id, rows, saved_at) VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET rows = excluded.rows, saved_at = excluded.saved_at`,
    [sessionId, JSON.stringify(rows), Date.now()],
  )
}

export async function readCachedTranscript(sessionId: string): Promise<TranscriptRow[]> {
  const handle = await db()
  const row = await handle.getFirstAsync<{ rows: string }>(
    `SELECT rows FROM transcripts WHERE session_id = ?`,
    [sessionId],
  )
  if (!row) return []
  try {
    return JSON.parse(row.rows) as TranscriptRow[]
  } catch {
    return []
  }
}

export type QueuedMessage = {
  id: string
  sessionId: string
  text: string
  attachments: { path: string }[]
  queuedAt: number
}

export async function queueMessage(item: QueuedMessage): Promise<void> {
  const handle = await db()
  await handle.runAsync(
    `INSERT OR REPLACE INTO outbox (id, session_id, text, attachments, queued_at) VALUES (?, ?, ?, ?, ?)`,
    [item.id, item.sessionId, item.text, JSON.stringify(item.attachments), item.queuedAt],
  )
}

export async function readQueue(): Promise<QueuedMessage[]> {
  const handle = await db()
  const rows = await handle.getAllAsync<{ id: string; session_id: string; text: string; attachments: string; queued_at: number }>(
    `SELECT * FROM outbox ORDER BY queued_at ASC`,
  )
  return rows.map(row => ({
    id: row.id,
    sessionId: row.session_id,
    text: row.text,
    attachments: JSON.parse(row.attachments) as { path: string }[],
    queuedAt: row.queued_at,
  }))
}

export async function dequeueMessage(id: string): Promise<void> {
  const handle = await db()
  await handle.runAsync(`DELETE FROM outbox WHERE id = ?`, [id])
}

/** Wipes cached content on unpair so the next device starts clean. */
export async function clearCache(): Promise<void> {
  const handle = await db()
  await handle.execAsync(`DELETE FROM sessions; DELETE FROM transcripts; DELETE FROM outbox;`)
}
