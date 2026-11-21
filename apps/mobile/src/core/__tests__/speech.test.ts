import { describe, expect, it } from 'vitest'

import {
  nextSpeechRate, parseSpeechRate, rateForKey, serializeSpeechRate, speechRateLabel,
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

describe('speech rate', () => {
  it('falls back to normal for unknown or missing values', () => {
    expect(parseSpeechRate('slow')).toBe('slow')
    expect(parseSpeechRate('fast')).toBe('fast')
    expect(parseSpeechRate('normal')).toBe('normal')
    expect(parseSpeechRate('warp')).toBe('normal')
    expect(parseSpeechRate(null)).toBe('normal')
    expect(serializeSpeechRate('fast')).toBe('fast')
  })

  it('maps each preset to a monotonic TTS rate', () => {
    expect(rateForKey('slow')).toBeLessThan(1)
    expect(rateForKey('normal')).toBe(1)
    expect(rateForKey('fast')).toBeGreaterThan(1)
  })

  it('cycles through the presets', () => {
    expect(nextSpeechRate('slow')).toBe('normal')
    expect(nextSpeechRate('normal')).toBe('fast')
    expect(nextSpeechRate('fast')).toBe('slow')
  })

  it('labels the current rate', () => {
    expect(speechRateLabel('slow')).toBe('慢')
    expect(speechRateLabel('normal')).toBe('标准')
    expect(speechRateLabel('fast')).toBe('快')
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
