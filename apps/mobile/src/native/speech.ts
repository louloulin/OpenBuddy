/**
 * The audio side of read-aloud (20261115-mobile.md §1.4).
 *
 * `expo-speech` maps to the platform TTS engine (and to `speechSynthesis` on
 * web), so both the auto-read setting and the per-message action share this
 * one call. A missing voice engine is not fatal: silently doing nothing is
 * better than an error banner over a conversation.
 */

import * as Speech from 'expo-speech'

import { speakableText } from '../core/speech'

/**
 * Module-level rate so every caller (auto-read, per-message, draft) speaks at
 * the same speed. The store loads the persisted preference on boot and pushes
 * it here; no call site has to thread it through.
 */
let currentRate = 1

export function setSpeechRate(rate: number): void {
  if (Number.isFinite(rate) && rate > 0) currentRate = rate
}

export function currentSpeechRate(): number {
  return currentRate
}

export function speak(text: string): void {
  const clean = speakableText(text)
  if (!clean) return
  try {
    // One voice at a time: reading a new reply should not queue behind an old
    // one the user has already moved past.
    void Speech.stop()
    Speech.speak(clean, { language: 'zh-CN', rate: currentRate })
  } catch {
    // No engine, no audio: the transcript is still the answer.
  }
}

export function stopSpeaking(): void {
  try {
    void Speech.stop()
  } catch {
    // Nothing to stop.
  }
}
