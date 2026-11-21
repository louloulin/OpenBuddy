/**
 * Pairing payloads (20261115-mobile.md §4.6).
 *
 * The desktop renders one QR code; the phone scans it and ends up with the
 * gateway origin plus the one-time code. Everything here is pure so the parse
 * rules are testable without a camera or a network.
 */

export type PairPayload = {
  /** Absolute gateway origin, no trailing slash. */
  gatewayUrl: string
  /** One-time eight-digit claim code. */
  code: string
}

const CODE = /^\d{8}$/

/** A claim code is exactly eight digits. Trimmed so pasted codes behave. */
export function isPairCode(value: unknown): value is string {
  return typeof value === 'string' && CODE.test(value.trim())
}

/**
 * Normalises a user-typed gateway address.
 *
 * People type `192.168.1.4:8787` or `https://host/`, so: assume https unless a
 * scheme is given, drop a trailing slash, and keep a base path when the gateway
 * is mounted under one (`https://host/openbuddy`). Query and fragment are
 * dropped: they never belong to the address the phone saves.
 */
export function normalizeGatewayUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname) return null
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host}${path}`
}

/** The QR carries `<gateway>/pair`; the stored address is the gateway itself. */
function gatewayFromPayload(value: string): string | null {
  const normalized = normalizeGatewayUrl(value)
  return normalized ? normalized.replace(/\/pair$/, '') : null
}

/** Double-encodes nothing: reads the QR text the desktop renders. */
export function buildPairQr(payload: PairPayload): string {
  const url = `${normalizeGatewayUrl(payload.gatewayUrl) ?? payload.gatewayUrl}/pair`
  return `openbuddy://pair?gateway=${encodeURIComponent(url)}&code=${encodeURIComponent(payload.code)}`
}

/**
 * Reads the QR text into a payload. Accepts the `openbuddy://pair` deep link,
 * a plain `{ gateway, code }` JSON body, or a URL with `gateway`/`code` query
 * parameters, because the desktop side may hand any of those to the QR
 * encoder while this parser stays in one place.
 */
export function parsePairQr(text: string): PairPayload | null {
  const raw = text.trim()
  if (!raw) return null

  if (raw.startsWith('{')) {
    try {
      const body = JSON.parse(raw) as { gatewayUrl?: unknown; gateway?: unknown; code?: unknown }
      const gateway = typeof body.gatewayUrl === 'string' ? body.gatewayUrl
        : typeof body.gateway === 'string' ? body.gateway : null
      if (!gateway || !isPairCode(body.code)) return null
      const gatewayUrl = gatewayFromPayload(gateway)
      return gatewayUrl ? { gatewayUrl, code: String(body.code).trim() } : null
    } catch {
      return null
    }
  }

  // `openbuddy://pair?…` is not an http(s) URL, so parse the query by hand.
  const queryStart = raw.indexOf('?')
  if (queryStart === -1) return null
  const params = new URLSearchParams(raw.slice(queryStart + 1))
  const gateway = params.get('gateway') ?? params.get('gatewayUrl')
  const code = params.get('code')
  if (!gateway || !isPairCode(code)) return null
  const gatewayUrl = gatewayFromPayload(gateway)
  return gatewayUrl ? { gatewayUrl, code: code.trim() } : null
}

/**
 * The gateway speaks HTTP, not Chinese. Its `/pair/claim` errors are stable
 * English strings (`invalid or expired code`, `too many attempts`, …) and the
 * phone used to render them verbatim in the middle of an otherwise Chinese pair
 * screen. Map the ones a user can actually cause; anything unknown becomes a
 * neutral message with the status code, never an English sentence.
 */
export function pairErrorMessage(raw: unknown, status?: number): string {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!text) return `配对失败（HTTP ${status ?? '?'}）`
  if (text.includes('invalid or expired code')) return '配对码不对或已过期，请在电脑上重新生成。'
  if (text.includes('too many attempts')) return '尝试次数过多，等一分钟再试。'
  if (text.includes('invalid pairing request')) return '配对信息不完整，请重新扫码。'
  if (text.includes('device limit')) return '这台电脑的配对设备已达上限，请先在桌面撤销一台。'
  if (text.includes('request body too large')) return '配对请求过大，请重新扫码。'
  if (/^[\x00-\x7f]*$/.test(text)) return `配对失败（HTTP ${status ?? '?'}）`
  // Already localized by someone upstream: keep it.
  return typeof raw === 'string' ? raw : `配对失败（HTTP ${status ?? '?'}）`
}
