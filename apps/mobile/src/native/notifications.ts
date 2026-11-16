/**
 * Push registration and deep links (20261115-mobile.md §5.8).
 *
 * The gateway already routes `approval`/`question`/`done`/`scheduled` through
 * its push providers; the phone's only job is to hand over a token and turn a
 * tap into a route. Both halves live here so the root layout stays a wiring
 * file.
 */

import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'

export type PushRegistration = { token: string; platform: 'ios' | 'android' }

/** Asks once; returns null when the user declined or this is a simulator. */
export async function registerForPush(): Promise<PushRegistration | null> {
  if (!Device.isDevice) return null

  const existing = await Notifications.getPermissionsAsync()
  const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync()
  if (!permission.granted) return null

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('approvals', {
      name: '等待你处理',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 120, 180],
    })
  }

  // Project id comes from EAS; without it Expo cannot mint a token, which is a
  // build configuration problem rather than a runtime one.
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID
  if (!projectId) return null

  const token = await Notifications.getExpoPushTokenAsync({ projectId })
  return {
    token: token.data,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  }
}

/** The session/approval a notification opens, or null for a plain notice. */
export function routeForNotification(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null
  const kind = typeof data.kind === 'string' ? data.kind : ''
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : ''
  const requestId = typeof data.requestId === 'string' ? data.requestId : ''
  if ((kind === 'approval' || kind === 'question') && requestId) {
    return `/approval/${encodeURIComponent(requestId)}`
  }
  if (sessionId) return `/chat/${encodeURIComponent(sessionId)}`
  return null
}
