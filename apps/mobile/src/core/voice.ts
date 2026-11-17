/**
 * Voice input (20261115-mobile.md §1.4 gap list, §5.7).
 *
 * Qwen's "实时记录" and Kimi's dictation both turn speech into the message
 * itself. The desktop owns the model, but dictation is a phone-side job: the
 * microphone belongs to the phone and the transcript belongs in the composer
 * where it can be corrected before it becomes a turn.
 *
 * The recognition module needs a development build (Expo Go ships without it),
 * so the composer keeps working without it — this module only owns the rules
 * that decide what happens to a transcript.
 */

export type VoiceOutcome =
  /** The transcript is ready to be placed in the composer. */
  | { kind: 'text'; text: string }
  /** Nothing was recognised; the draft stays as it is. */
  | { kind: 'empty' }
  /** The phone cannot do dictation (no dev build, no permission). */
  | { kind: 'unavailable'; reason: string }

/** Normalises a raw transcript into something worth putting in the composer. */
export function transcriptOutcome(raw: string | undefined | null): VoiceOutcome {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return { kind: 'empty' }
  return { kind: 'text', text }
}

/**
 * Merges a transcript into the draft.
 *
 * A new dictation replaces the draft when the composer was empty, and is
 * appended after a space when there was already something there — a person
 * who typed a prefix and then dictated the rest expects one message, not two.
 */
export function mergeTranscript(draft: string, transcript: string): string {
  const base = draft.trim()
  const spoken = transcript.trim()
  if (!spoken) return draft
  if (!base) return spoken
  return `${base} ${spoken}`
}

/** The Chinese message the composer shows when dictation is unavailable. */
export function unavailableMessage(reason: 'no_module' | 'no_permission' | 'error'): string {
  switch (reason) {
    case 'no_module':
      return '语音输入需要开发版构建（Expo Go 不含语音识别模块）。'
    case 'no_permission':
      return '需要麦克风权限才能语音输入，可在系统设置里开启。'
    default:
      return '语音识别没有成功，请再试一次。'
  }
}
