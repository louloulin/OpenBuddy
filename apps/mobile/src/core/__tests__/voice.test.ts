import { describe, expect, it } from 'vitest'

import { mergeTranscript, transcriptOutcome, unavailableMessage } from '../voice'

describe('transcriptOutcome', () => {
  it('normalises whitespace into one line', () => {
    expect(transcriptOutcome('  今天   继续  ')).toEqual({ kind: 'text', text: '今天 继续' })
  })

  it('reports an empty transcript', () => {
    expect(transcriptOutcome('   ')).toEqual({ kind: 'empty' })
    expect(transcriptOutcome(undefined)).toEqual({ kind: 'empty' })
  })
})

describe('mergeTranscript', () => {
  it('fills an empty draft', () => {
    expect(mergeTranscript('', '继续')).toBe('继续')
    expect(mergeTranscript('  ', '继续')).toBe('继续')
  })

  it('appends after a typed prefix', () => {
    expect(mergeTranscript('帮我', '查一下网关')).toBe('帮我 查一下网关')
  })

  it('keeps the draft when nothing was recognised', () => {
    expect(mergeTranscript('帮我', '')).toBe('帮我')
  })
})

describe('unavailableMessage', () => {
  it('explains each case', () => {
    expect(unavailableMessage('no_module')).toContain('开发版构建')
    expect(unavailableMessage('no_permission')).toContain('麦克风权限')
    expect(unavailableMessage('error')).toContain('再试一次')
  })
})
