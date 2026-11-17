import { describe, expect, it } from 'vitest'

import {
  parseSpeakSetting, serializeSpeakSetting, shouldSpeak, speakableText, SPEAK_MAX_CHARS,
} from '../speech'

describe('speak setting', () => {
  it('reads and writes the stored flag', () => {
    expect(parseSpeakSetting('1')).toBe(true)
    expect(parseSpeakSetting('0')).toBe(false)
    expect(parseSpeakSetting(null)).toBe(false)
    expect(serializeSpeakSetting(true)).toBe('1')
    expect(serializeSpeakSetting(false)).toBe('0')
  })
})

describe('speakableText', () => {
  it('keeps prose and strip markdown marks', () => {
    expect(speakableText('# 结论\n\n**没有缓冲**，`accept-encoding` 是 identity。'))
      .toBe('结论 没有缓冲，accept-encoding 是 identity。')
  })

  it('replaces code blocks instead of reading them', () => {
    const text = speakableText('看这段：\n\n```ts\nheaders.x = 1\n```\n\n就这样。')
    expect(text).toBe('看这段： （代码略） 就这样。')
  })

  it('keeps the label of a link and drops images', () => {
    expect(speakableText('见 [文档](https://x.test) 和 ![图](a.png)')).toBe('见 文档 和')
  })

  it('collapses list markers and whitespace', () => {
    expect(speakableText('- 一\n- 二\n\n1. 三')).toBe('一 二 三')
  })

  it('caps a long answer', () => {
    const out = speakableText('好'.repeat(1000))
    expect(out.length).toBe(SPEAK_MAX_CHARS + 1)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('shouldSpeak', () => {
  it('speaks only the conversation on screen', () => {
    expect(shouldSpeak(true, 's1', 's1')).toBe(true)
    expect(shouldSpeak(true, 's1', 's2')).toBe(false)
    expect(shouldSpeak(true, 's1', null)).toBe(false)
    expect(shouldSpeak(false, 's1', 's1')).toBe(false)
  })
})
