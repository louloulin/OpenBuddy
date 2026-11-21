/**
 * The desktop's own client for the gateway's admin API
 * (20261115-mobile.md §4.4 "桌面设置页「手机接入」").
 *
 * The renderer must never hold the gateway's admin token, so pairing from the
 * desktop window goes: renderer → IPC command → this module (main process) →
 * gateway. Only three operations are exposed, all of them about *this*
 * computer's phones:
 *
 *   - mint a one-time pairing code (and its QR payload),
 *   - list the phones paired to this desktop,
 *   - revoke one.
 *
 * Fetch-only on purpose: the e2e harness runs it under Node, without Electron.
 */

export type MobilePairing = {
  code: string
  expiresAt: string
  scopes: string[]
  desktopId?: string
}

export type MobileDevice = {
  id: string
  name: string
  platform: string
  /** ISO timestamps, as the gateway's admin API reports them. */
  createdAt?: string
  lastSeenAt?: string | null
  revokedAt?: string | null
  desktopId?: string
}

export type MobileGatewayOptions = {
  /** Gateway origin, e.g. https://gw.example.com (no trailing slash needed). */
  gatewayUrl: string
  /** Operator credential; never leaves the main process. */
  adminToken: string
  /** The desktop this window belongs to, so codes are bound to it. */
  desktopId?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export type MobileGateway = {
  /** Where this client points, for the settings panel. */
  status(): { configured: true; gatewayUrl: string; desktopId?: string }
  pairStart(scopes?: string[]): Promise<MobilePairing>
  listDevices(): Promise<MobileDevice[]>
  revokeDevice(id: string): Promise<void>
}

const DEFAULT_SCOPES = ['sessions:read', 'sessions:write', 'approve']

export class MobileGatewayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'MobileGatewayError'
  }
}

function deviceRows(raw: unknown): MobileDevice[] {
  const list = (raw as { devices?: unknown } | null)?.devices
  if (!Array.isArray(list)) return []
  const rows: MobileDevice[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id) continue
    rows.push({
      id: record.id,
      name: typeof record.name === 'string' && record.name ? record.name : '未命名设备',
      platform: typeof record.platform === 'string' ? record.platform : 'unknown',
      ...(typeof record.createdAt === 'string' ? { createdAt: record.createdAt } : {}),
      lastSeenAt: typeof record.lastSeenAt === 'string' ? record.lastSeenAt : null,
      revokedAt: typeof record.revokedAt === 'string' ? record.revokedAt : null,
      ...(typeof record.desktopId === 'string' ? { desktopId: record.desktopId } : {}),
    })
  }
  return rows
}

export function createMobileGateway(options: MobileGatewayOptions): MobileGateway {
  const base = options.gatewayUrl.replace(/\/+$/, '')
  const doFetch: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? 15_000

  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${options.adminToken}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await response.json().catch(() => ({}))) as T & { error?: string }
    if (!response.ok) {
      throw new MobileGatewayError(body?.error ?? `gateway ${response.status}`, response.status)
    }
    return body
  }

  return {
    status() {
      return {
        configured: true,
        gatewayUrl: base,
        ...(options.desktopId ? { desktopId: options.desktopId } : {}),
      }
    },

    async pairStart(scopes = DEFAULT_SCOPES) {
      const body = await call<MobilePairing>('/pair/start', {
        method: 'POST',
        body: JSON.stringify({
          scopes,
          ...(options.desktopId ? { desktopId: options.desktopId } : {}),
        }),
      })
      // The gateway returns the code exactly once; nothing here caches it.
      return {
        code: String(body.code),
        expiresAt: String(body.expiresAt),
        scopes: Array.isArray(body.scopes) ? body.scopes : scopes,
        ...(body.desktopId ? { desktopId: body.desktopId } : {}),
      }
    },

    async listDevices() {
      return deviceRows(await call<unknown>('/admin/devices'))
    },

    async revokeDevice(id: string) {
      if (!id) throw new MobileGatewayError('device id is required', 400)
      await call(`/admin/devices/${encodeURIComponent(id)}/revoke`, { method: 'POST' })
    },
  }
}
