/**
 * Reply read-aloud (20261115-mobile.md §1.4 gap list: 语音播报).
 *
 * Doubao reads replies out loud; the desktop does not. On the phone this is a
 * phone-side job like dictation: the text is already in the transcript, and
 * speaking it needs no model. The rules live here so the setting and the
 * Markdown-to-speech cleanup are testable without an audio engine.
 */

export const SPEAK_KEY = 'openbuddy.autoSpeak'

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
