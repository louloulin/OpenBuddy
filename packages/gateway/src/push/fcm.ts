/**
 * Firebase Cloud Messaging (HTTP v1).
 *
 * Self-hosted gateways authenticate with a service account rather than a
 * legacy server key: Google signs the request with an OAuth assertion built
 * from the account's private key, and the access token is reused until it is
 * nearly expired instead of being fetched per notification.
 *
 * The token and send endpoints are injectable so the whole exchange — assertion
 * signing included — can be exercised against a local server.
 */

import type { PushMessage, PushOutcome, PushProvider } from './types.js'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FCM_SEND_URL = 'https://fcm.googleapis.com/v1/projects'
const MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

/** Refresh this long before the token actually expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000

export type FcmServiceAccount = {
  projectId: string
  clientEmail: string
  /** PKCS#8 PEM, exactly as the downloaded service-account JSON carries it. */
  privateKeyPem: string
}

export type FcmProviderOptions = {
  serviceAccount: FcmServiceAccount
  /** Override for tests and for region-specific endpoints. */
  tokenUrl?: string
  sendUrl?: string
  fetchImpl?: typeof fetch
  now?: () => number
  /**
   * The Android notification channel the app creates. Must match the channel
   * its plugin registers, or the notification is dropped silently.
   */
  channelId?: string
  /** Deadline for one Google round trip. */
  sendTimeoutMs?: number
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  if (!body) throw new Error('fcm: service account private key is empty')
  const binary = Buffer.from(body, 'base64')
  return binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) as ArrayBuffer
}

function base64Url(value: string | ArrayBuffer): string {
  const buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
  return buffer.toString('base64url')
}

async function signAssertion(account: FcmServiceAccount, now: number, tokenUrl: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(account.privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64Url(JSON.stringify({
    iss: account.clientEmail,
    scope: MESSAGING_SCOPE,
    aud: tokenUrl,
    iat: Math.floor(now / 1000),
    // Google rejects assertions valid for more than an hour.
    exp: Math.floor(now / 1000) + 3600,
  }))
  const unsigned = `${header}.${claims}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, Buffer.from(unsigned, 'utf8'))
  return `${unsigned}.${base64Url(signature)}`
}

type TokenResponse = { access_token?: unknown; expires_in?: unknown }

/** Reads the error code FCM reports, across the shapes it uses for it. */
export function fcmErrorCode(status: number, payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const error = (payload as { error?: unknown }).error
  if (!error || typeof error !== 'object') return null
  const record = error as { status?: unknown; message?: unknown; details?: unknown }
  if (typeof record.status === 'string') return record.status
  if (Array.isArray(record.details)) {
    for (const detail of record.details) {
      const code = (detail as { errorCode?: unknown })?.errorCode
      if (typeof code === 'string') return code
    }
  }
  if (typeof record.message === 'string') return `${status}:${record.message}`
  return null
}

/**
 * UNREGISTERED means the app was uninstalled or the token was rotated;
 * INVALID_ARGUMENT on a send usually means the same for a malformed token.
 * Anything else is worth retrying, including 401 (the token will be refetched).
 */
export function isPermanentFcmFailure(status: number, code: string | null): boolean {
  if (status === 404) return true
  if (code === 'UNREGISTERED' || code === 'NOT_FOUND') return true
  return status === 400 && code === 'INVALID_ARGUMENT'
}

export function createFcmProvider(options: FcmProviderOptions): PushProvider {
  const { serviceAccount } = options
  const tokenUrl = options.tokenUrl ?? GOOGLE_TOKEN_URL
  const sendUrl = options.sendUrl ?? `${FCM_SEND_URL}/${encodeURIComponent(serviceAccount.projectId)}/messages:send`
  const doFetch = options.fetchImpl ?? fetch
  const now = options.now ?? (() => Date.now())
  const channelId = options.channelId ?? 'lumos'
  // Completions are ambient, not urgent: they go to the quiet info channel so
  // the user can silence them in Android's per-channel settings without ever
  // losing an approval.
  const channelForKind = (kind: PushMessage['kind']) => (kind === 'done' ? `${channelId}-info` : channelId)
  /** A hung Google connection must not hold /push/notify or the watcher hostage. */
  const sendTimeoutMs = options.sendTimeoutMs ?? 10_000

  let cached: { value: string; expiresAt: number } | null = null

  const accessToken = async (): Promise<string> => {
    const current = now()
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > current) return cached.value

    const assertion = await signAssertion(serviceAccount, current, tokenUrl)
    const response = await doFetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(sendTimeoutMs),
    })
    if (!response.ok) {
      throw new Error(`fcm: token endpoint returned ${response.status}`)
    }
    const body = await response.json().catch(() => null) as TokenResponse | null
    const token = typeof body?.access_token === 'string' ? body.access_token : null
    if (!token) throw new Error('fcm: token endpoint returned no access_token')
    const expiresIn = typeof body?.expires_in === 'number' ? body.expires_in : 3600
    cached = { value: token, expiresAt: current + expiresIn * 1000 }
    return token
  }

  return {
    name: 'fcm',
    async send(message: PushMessage): Promise<PushOutcome> {
      let token: string
      try {
        token = await accessToken()
      } catch (error) {
        // No credential means nothing was delivered, but the device is fine.
        return { ok: false, permanent: false, error: error instanceof Error ? error.message : String(error) }
      }

      // An actionable approval ships data-only: the system tray renders a
      // notification block itself in the background, which would pre-empt the
      // app's own notification with Allow / Deny buttons — and a tray tap can
      // only open the app, never answer. Everything else keeps the tray
      // behavior (the stock plugin contract the phone already relies on).
      const actionableApproval = message.kind === 'approval' && typeof message.requestId === 'string'

      const payload = {
        message: {
          token: message.token,
          ...(actionableApproval ? {} : { notification: { title: message.title, body: message.body } }),
          // FCM data values must all be strings; the app reads them on tap.
          data: {
            kind: message.kind,
            sessionId: message.sessionId,
            ...(message.requestId ? { requestId: message.requestId } : {}),
            // A data-only message has no notification block to carry the copy;
            // the phone's messaging service renders these straight from data.
            ...(actionableApproval ? { title: message.title, body: message.body } : {}),
          },
          android: {
            priority: 'high',
            ...(message.collapseKey ? { collapse_key: message.collapseKey } : {}),
            ...(actionableApproval ? {} : {
              notification: {
                channel_id: channelForKind(message.kind),
                ...(message.collapseKey ? { tag: message.collapseKey } : {}),
              },
            }),
          },
        },
      }

      let response: Response
      try {
        response = await doFetch(sendUrl, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(sendTimeoutMs),
        })
      } catch (error) {
        return { ok: false, permanent: false, error: error instanceof Error ? error.message : String(error) }
      }

      if (response.ok) return { ok: true }

      const body = await response.json().catch(() => null)
      const code = fcmErrorCode(response.status, body)
      return {
        ok: false,
        permanent: isPermanentFcmFailure(response.status, code),
        error: `fcm ${response.status}${code ? ` ${code}` : ''}`,
      }
    },
  }
}
