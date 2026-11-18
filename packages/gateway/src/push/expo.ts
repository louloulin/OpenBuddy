/**
 * Expo push (Expo Push Service).
 *
 * An Expo app receives a token from `getExpoPushTokenAsync`; Expo's service
 * fans it out to FCM/APNs. That spares a self-hosted gateway from holding an
 * APNs certificate and from knowing whether the phone is iOS or Android.
 *
 * No credential is required (an optional access token raises the quota), so —
 * like the webhook provider — this one is always available.
 */

import type { PushMessage, PushOutcome, PushProvider } from './types.js'

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send'
const EXPO_TOKEN = /^(Exponent|Expo)PushToken\[[^\]]+\]$/

export type ExpoProviderOptions = {
  /** Optional Expo access token, sent as a bearer credential. */
  accessToken?: string
  /** Override for tests and for a self-hosted relay. */
  sendUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Android notification channel the app registers. */
  channelId?: string
}

type ExpoTicket = {
  status?: string
  message?: string
  details?: { error?: string }
}

/** Expo reports a token the app has uninstalled as permanent. */
function isPermanentError(ticket: ExpoTicket): boolean {
  if (ticket.details?.error === 'DeviceNotRegistered' || ticket.details?.error === 'InvalidCredentials') return true
  const message = ticket.message?.toLowerCase() ?? ''
  return message.includes('not a valid expo push token') || message.includes('invalid credentials')
}

export function createExpoProvider(options: ExpoProviderOptions = {}): PushProvider {
  const sendUrl = options.sendUrl ?? EXPO_SEND_URL
  const timeoutMs = options.timeoutMs ?? 10_000
  const doFetch = options.fetchImpl ?? fetch

  return {
    name: 'expo',
    async send(message: PushMessage): Promise<PushOutcome> {
      // A registration that is not an Expo token can never work; say so now
      // instead of spending a request to learn it.
      if (!EXPO_TOKEN.test(message.token)) {
        return { ok: false, permanent: true, error: 'expo: not an Expo push token' }
      }

      const payload: Record<string, unknown> = {
        to: message.token,
        title: message.title,
        body: message.body,
        sound: 'default',
        // A pending approval can be answered from the notification itself: the
        // phone registers the `approval` category with Allow / Deny buttons
        // (20261117-mobile E4). Everything else keeps the plain tap.
        ...(message.kind === 'approval' && message.requestId ? { categoryId: 'approval' } : {}),
        data: {
          kind: message.kind,
          sessionId: message.sessionId,
          ...(message.requestId ? { requestId: message.requestId } : {}),
        },
        ...(message.collapseKey ? { collapseId: message.collapseKey } : {}),
        ...(options.channelId ? { channelId: options.channelId } : {}),
      }

      let response: Response
      try {
        response = await doFetch(sendUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        return {
          ok: false,
          permanent: false,
          error: `expo: ${error instanceof Error ? error.message : String(error)}`,
        }
      }

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        const detail = await response.text().catch(() => '')
        return { ok: false, permanent: true, error: `expo ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` }
      }
      if (!response.ok) {
        return { ok: false, permanent: false, error: `expo ${response.status}` }
      }

      const body = (await response.json().catch(() => null)) as { data?: ExpoTicket | ExpoTicket[] } | null
      const ticket = Array.isArray(body?.data) ? body?.data[0] : body?.data
      if (!ticket) return { ok: true }
      if (ticket.status === 'error') {
        return {
          ok: false,
          permanent: isPermanentError(ticket),
          error: `expo: ${ticket.details?.error ?? ticket.message ?? 'error'}`,
        }
      }
      return { ok: true }
    },
  }
}
