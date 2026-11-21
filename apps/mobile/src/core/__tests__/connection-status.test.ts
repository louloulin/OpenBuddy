import { describe, expect, it } from 'vitest'

import { canRetryConnection, connectionLabel, connectionRowValue } from '../connection-status'

describe('connection status', () => {
  it('labels each tunnel state', () => {
    expect(connectionLabel('open')).toBe('已连接')
    expect(connectionLabel('connecting')).toBe('连接中')
    expect(connectionLabel('closed')).toBe('已断开')
  })

  it('only offers retry when the tunnel is not open', () => {
    expect(canRetryConnection('open')).toBe(false)
    expect(canRetryConnection('connecting')).toBe(true)
    expect(canRetryConnection('closed')).toBe(true)
  })

  it('appends the retry hint only when there is something to retry', () => {
    expect(connectionRowValue('open')).toBe('已连接')
    expect(connectionRowValue('connecting')).toBe('连接中 · 点按重连')
    expect(connectionRowValue('closed')).toBe('已断开 · 点按重连')
  })
})
