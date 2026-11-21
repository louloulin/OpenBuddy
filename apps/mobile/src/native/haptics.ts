/**
 * Haptics (20261117-mobile.md F1).
 *
 * Send / stop / approval get a short tap; a long-press gets a heavier one. The
 * browser has no taptic engine and older devices may throw, so every call is
 * best-effort — never a reason for an action to fail.
 */

import { Platform } from 'react-native'
import * as Haptics from 'expo-haptics'

export type HapticKind = 'send' | 'stop' | 'approve' | 'longPress'

export async function haptic(kind: HapticKind): Promise<void> {
  if (Platform.OS === 'web') return
  try {
    if (kind === 'approve') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } else if (kind === 'stop') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    } else {
      await Haptics.impactAsync(
        kind === 'longPress' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
      )
    }
  } catch {
    // No taptic engine, or the OS refused: the action still happens.
  }
}
