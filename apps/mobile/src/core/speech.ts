/**
 * Reply read-aloud (20261115-mobile.md §1.4 gap list: 语音播报).
 *
 * Doubao reads replies out loud; the desktop does not. On the phone this is a
 * phone-side job like dictation: the text is already in the transcript, and
 * speaking it needs no model. The rules live here so the setting and the
 * Markdown-to-speech cleanup are testable without an audio engine.
 */

export const SPEAK_KEY = 'openbuddy.autoSpeak'

/** Read-aloud speed preference (§5 Tab 5「音色语速」). */
export const SPEECH_RATE_KEY = 'openbuddy.speechRate'

export type SpeechRateKey = 'slow' | 'normal' | 'fast'

/** Three presets beat a raw slider: each maps to a rate the TTS engine honours. */
export const SPEECH_RATES: readonly { key: SpeechRateKey; label: string; rate: number }[] = [
  { key: 'slow', label: '慢', rate: 0.85 },
  { key: 'normal', label: '标准', rate: 1 },
  { key: 'fast', label: '快', rate: 1.25 },
]

export function parseSpeechRate(raw: string | null | undefined): SpeechRateKey {
  return raw === 'slow' || raw === 'fast' ? raw : 'normal'
}

export function serializeSpeechRate(key: SpeechRateKey): string {
  return key
}

export function rateForKey(key: SpeechRateKey): number {
  return SPEECH_RATES.find(item => item.key === key)?.rate ?? 1
}

export function speechRateLabel(key: SpeechRateKey): string {
  return SPEECH_RATES.find(item => item.key === key)?.label ?? '标准'
}

/** Tap-to-cycle: 慢 → 标准 → 快 → 慢, so one row changes the setting. */
export function nextSpeechRate(key: SpeechRateKey): SpeechRateKey {
  const index = SPEECH_RATES.findIndex(item => item.key === key)
  return SPEECH_RATES[(index + 1) % SPEECH_RATES.length]?.key ?? 'normal'
}

/** Long answers are cut: nobody wants a five-minute monologue after a glance. */
export const SPEAK_MAX_CHARS = 600

export function parseSpeakSetting(raw: string | null | undefined): boolean {
  return raw === '1'
}

export function serializeSpeakSetting(enabled: boolean): string {
  return enabled ? '1' : '0'
}

/**
 * Markdown flattened into something worth hearing.
 *
 * Code blocks become a short spoken placeholder — reading punctuation out
 * loud is worse than saying there is code — and links keep their label. The
 * result is single-spaced and capped so TTS cannot run away.
 */
export function speakableText(markdown: string, max = SPEAK_MAX_CHARS): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, '（代码略）')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Only the conversation on screen is read; everything else becomes unread. */
export function shouldSpeak(
  enabled: boolean,
  sessionId: string | undefined,
  activeSessionId: string | null,
): boolean {
  return enabled && Boolean(sessionId) && sessionId === activeSessionId
}
