import { describe, expect, it } from 'vitest'

import {
  dispositionFor, queueLabel, queueRows, withoutQueueItem, type TurnQueue,
} from '../turn-input'

const queue: TurnQueue = { steering: ['改方向'], followUp: ['补充一', '补充二'] }

describe('dispositionFor', () => {
  it('sends immediately when idle', () => {
    expect(dispositionFor(false)).toBe('send')
    expect(dispositionFor(false, true)).toBe('send')
  })

  it('queues a follow-up when busy by default', () => {
    expect(dispositionFor(true)).toBe('follow_up')
  })

  it('steers only when explicitly requested', () => {
    expect(dispositionFor(true, true)).toBe('steer')
  })
})

describe('queueRows', () => {
  it('lists steering before follow-ups and keeps indices', () => {
    expect(queueRows(queue)).toEqual([
      { kind: 'steering', index: 0, text: '改方向' },
      { kind: 'followUp', index: 0, text: '补充一' },
      { kind: 'followUp', index: 1, text: '补充二' },
    ])
  })

  it('has no rows for a missing queue', () => {
    expect(queueRows(undefined)).toEqual([])
  })
})

describe('withoutQueueItem', () => {
  it('removes only the addressed item', () => {
    expect(withoutQueueItem(queue, 'followUp', 0)).toEqual({
      steering: ['改方向'], followUp: ['补充二'],
    })
    expect(withoutQueueItem(queue, 'steering', 0)).toEqual({
      steering: [], followUp: ['补充一', '补充二'],
    })
  })

  it('tolerates an empty queue', () => {
    expect(withoutQueueItem(undefined, 'followUp', 3)).toEqual({ steering: [], followUp: [] })
  })
})

describe('queueLabel', () => {
  it('distinguishes the two queues', () => {
    expect(queueLabel('steering')).toBe('插话')
    expect(queueLabel('followUp')).toBe('排队')
  })
})
