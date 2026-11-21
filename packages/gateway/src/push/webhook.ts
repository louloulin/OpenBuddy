/**
 * Webhook push: POST the notification as JSON to a URL the operator controls.
 *
 * A self-hosted gateway has no Firebase project, and a deployment that already
 * runs a notification fan-out (ntfy, a home-grown relay, an IM bridge) should
 * not have to grow one. The registration token is simply the destination URL,
 * so a device registers its own endpoint and the gateway stays agnostic.
 */

import type { PushMessage, PushOutcome, PushProvider } from './types.js'

export type WebhookProviderOptions = {
  /** Optional shared secret sent as `Authorization: Bearer …`. */
  token?: string
  /** Refuse destinations outside these hosts. Empty means any https host. */
  allowedHosts?: string[]
  /** Permit plain http, for a relay on the local network. */
  allowCleartext?: boolean
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * True when the hostname is an IP literal that names the gateway's own
 * neighbourhood: loopback, RFC1918, link-local (which on a cloud host is the
 * metadata service), carrier-grade NAT, or their IPv6 equivalents.
 *
 * A push URL is operator-configured but device-supplied, so an https URL that
 * names 169.254.169.254 would otherwise turn the dispatcher into a scratch
 * pad for reading things only the host can see.
 */
function ipv4LiteralIsPrivate(a: number, b: number): boolean {
  return (
    a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
  )
}

export function isPrivateIpLiteral(hostname: string): boolean {
  // URL.hostname keeps the brackets on an IPv6 literal; the ranges do not.
  const bare = hostname.replace(/^\[|\]$/g, '')
  // IPv4-mapped IPv6 carries the same ranges under a different spelling.
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare)
  if (dotted) {
    const [a, b] = dotted[1].split('.').map(Number)
    return ipv4LiteralIsPrivate(a, b)
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare)) {
    const [a, b] = bare.split('.').map(Number)
    return ipv4LiteralIsPrivate(a, b)
  }
  const lower = bare.toLowerCase()
  // Everything below is IPv6 shape; a reg-name like `fc00.example.com` has
  // no colon and is none of the gateway's business.
  if (!lower.includes(':')) return false
  if (lower === '::' || lower === '::1') return true
  if (/^f[cd]/.test(lower)) return true // fc00::/7 unique local
  if (/^fe[89ab]/.test(lower)) return true // fe80::/10 link-local
  // Canonical mapped form after URL normalization: ::ffff:a00:9, whose tail
  // is the IPv4 address in two hex groups.
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower)
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16)
    return ipv4LiteralIsPrivate(hi >> 8, hi & 0xff)
  }
  return false
}

export function isAllowedWebhookUrl(url: string, options: { allowedHosts?: string[]; allowCleartext?: boolean } = {}): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const cleartext = parsed.protocol === 'http:'
  if (cleartext && !options.allowCleartext) return false
  if (!cleartext && parsed.protocol !== 'https:') return false
  // Private addresses are the local-network escape hatch's to grant, not the
  // default: an operator who opted into cleartext opted into a LAN relay.
  if (isPrivateIpLiteral(parsed.hostname) && !options.allowCleartext) return false
  const allowed = options.allowedHosts ?? []
  if (allowed.length === 0) return true
  return allowed.some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
}

export function createWebhookProvider(options: WebhookProviderOptions = {}): PushProvider {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 10_000

  return {
    name: 'webhook',
    async send(message: PushMessage): Promise<PushOutcome> {
      if (!isAllowedWebhookUrl(message.token, options)) {
        // A registration whose destination is now disallowed cannot be fixed by
        // retrying; treat it as permanently dead so it is pruned.
        return { ok: false, permanent: true, error: 'webhook destination is not allowed' }
      }

      try {
        const response = await doFetch(message.token, {
          method: 'POST',
          // Redirects are not followed: the destination was checked, a 30x to
          // somewhere else was not, and following one would let a permitted
          // endpoint forward the notification anywhere at all.
          redirect: 'manual',
          headers: {
            'content-type': 'application/json',
            ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          },
          body: JSON.stringify({
            kind: message.kind,
            title: message.title,
            body: message.body,
            sessionId: message.sessionId,
            ...(message.requestId ? { requestId: message.requestId } : {}),
            collapseKey: message.collapseKey,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })

        if (response.ok) return { ok: true }
        // 404/410 mean the endpoint is gone; 5xx and 429 are worth another try.
        const permanent = response.status === 404 || response.status === 410
        return { ok: false, permanent, error: `webhook ${response.status}` }
      } catch (error) {
        return { ok: false, permanent: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}
