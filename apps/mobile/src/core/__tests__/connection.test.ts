import { describe, expect, it } from 'vitest'

import { bannerFor, canSendNow, flushOutbox, type OutboxItem } from '../connection'

function item(id: string): OutboxItem {
  return { id, sessionId: 's1', text: id, attachments: [], queuedAt: Number(id) }
}

describe('bannerFor', () => {
  it('asks for pairing before anything else', () => {
    expect(bannerFor('open', false)).toMatchObject({ tone: 'info' })
    expect(bannerFor('closed', false)?.text).toContain('扫码配对')
  })

  it('reports each connection state', () => {
    expect(bannerFor('open', true)).toBeNull()
    expect(bannerFor('connecting', true)).toMatchObject({ tone: 'info' })
    expect(bannerFor('closed', true)).toMatchObject({ tone: 'warn' })
  })
})

describe('canSendNow', () => {
  it('allows sending only on an open connection', () => {
    expect(canSendNow('open')).toBe(true)
    expect(canSendNow('connecting')).toBe(false)
    expect(canSendNow('closed')).toBe(false)
  })
})

describe('flushOutbox', () => {
  it('sends everything in order when nothing fails', async () => {
    const seen: string[] = []
    const result = await flushOutbox([item('1'), item('2')], async entry => { seen.push(entry.id) })
    expect(seen).toEqual(['1', '2'])
    expect(result).toEqual({ sent: 2, remaining: [] })
  })

  it('stops at the first failure and keeps the rest queued', async () => {
    const seen: string[] = []
    const result = await flushOutbox([item('1'), item('2'), item('3')], async entry => {
      seen.push(entry.id)
      if (entry.id === '2') throw new Error('offline again')
    })
    expect(seen).toEqual(['1', '2'])
    expect(result.sent).toBe(1)
    expect(result.remaining.map(entry => entry.id)).toEqual(['2', '3'])
    expect(result.error).toBe('offline again')
  })
})
