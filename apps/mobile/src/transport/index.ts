/**
 * The phone's connection to one desktop (20261115-mobile.md §4.2, §5.3).
 *
 * Pairing result → SecureStore → one GatewayTransport for the app's lifetime.
 * The base URL keeps the `/api` prefix because the gateway forwards the phone's
 * path verbatim to the desktop bridge, which serves `/api/*`.
 */

import { Platform } from 'react-native'

import { GatewayTransport } from '@openbuddy/client/gateway-transport'
import type { Transport } from '@openbuddy/client/transport'

import type { PairPayload } from '../core/pairing'
import { deleteItem, getItem, setItem } from './storage'

const KEY_GATEWAY = 'openbuddy.gatewayUrl'
const KEY_TOKEN = 'openbuddy.deviceToken'
const KEY_DEVICE = 'openbuddy.deviceId'
const KEY_NAME = 'openbuddy.deviceName'

export type Pairing = {
  gatewayUrl: string
  deviceToken: string
  deviceId?: string
  deviceName?: string
}

/** `expo/fetch` streams response bodies on native; the global fetch may not. */
async function streamFetch(): Promise<typeof fetch> {
  // On web the global fetch already streams, and `expo/fetch` re-exports a
  // window-bound method: calling it as a module member throws "Illegal
  // invocation". So only reach for it on native.
  if (Platform.OS === 'web') {
    return ((input: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(input, init)) as typeof fetch
  }
  try {
    const mod = await import('expo/fetch')
    return ((input: RequestInfo | URL, init?: RequestInit) =>
      (mod.fetch as unknown as typeof fetch)(input, init)) as typeof fetch
  } catch {
    return fetch
  }
}

export async function savePairing(pairing: Pairing): Promise<void> {
  await setItem(KEY_GATEWAY, pairing.gatewayUrl)
  await setItem(KEY_TOKEN, pairing.deviceToken)
  if (pairing.deviceId) await setItem(KEY_DEVICE, pairing.deviceId)
  if (pairing.deviceName) await setItem(KEY_NAME, pairing.deviceName)
}

export async function loadPairing(): Promise<Pairing | null> {
  const [gatewayUrl, deviceToken, deviceId, deviceName] = await Promise.all([
    getItem(KEY_GATEWAY),
    getItem(KEY_TOKEN),
    getItem(KEY_DEVICE),
    getItem(KEY_NAME),
  ])
  if (!gatewayUrl || !deviceToken) return null
  return {
    gatewayUrl,
    deviceToken,
    deviceId: deviceId ?? undefined,
    deviceName: deviceName ?? undefined,
  }
}

export async function clearPairing(): Promise<void> {
  await Promise.all([
    deleteItem(KEY_GATEWAY),
    deleteItem(KEY_TOKEN),
    deleteItem(KEY_DEVICE),
    deleteItem(KEY_NAME),
  ])
}

/** Claims the one-time code and returns the device credential to store. */
export async function claimPair(payload: PairPayload, deviceName: string): Promise<Pairing> {
  const response = await fetch(`${payload.gatewayUrl}/pair/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: payload.code, deviceName, platform: 'mobile' }),
  })
  const body = (await response.json().catch(() => ({}))) as {
    deviceToken?: string
    deviceId?: string
    scopes?: string[]
    error?: string
  }
  if (!response.ok || !body.deviceToken) {
    throw new Error(body.error ?? `配对失败（HTTP ${response.status}）`)
  }
  return {
    gatewayUrl: payload.gatewayUrl,
    deviceToken: body.deviceToken,
    deviceId: body.deviceId,
    deviceName,
  }
}

let active: { transport: GatewayTransport; gatewayUrl: string; token: string } | null = null

/** Builds the app-wide transport; safe to call twice (the old one is closed). */
export async function openTransport(pairing: Pairing): Promise<Transport> {
  active?.transport.close()
  const transport = new GatewayTransport({
    baseUrl: `${pairing.gatewayUrl}/api`,
    token: pairing.deviceToken,
    fetchImpl: await streamFetch(),
  })
  active = { transport, gatewayUrl: pairing.gatewayUrl, token: pairing.deviceToken }
  return transport
}

export function currentTransport(): Transport | null {
  return active?.transport ?? null
}

/** Stops the stream (unpair, or before replacing it with a new pairing). */
export function closeActiveTransport(): void {
  active?.transport.close()
  active = null
}

export function activePairing(): { gatewayUrl: string; token: string } | null {
  return active ? { gatewayUrl: active.gatewayUrl, token: active.token } : null
}

/** Uploads a compressed picture and returns the desktop path to send. */
export async function uploadImage(pairing: Pairing, bytes: ArrayBuffer, mime: string): Promise<string> {
  const response = await fetch(`${pairing.gatewayUrl}/api/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${pairing.deviceToken}`, 'content-type': mime },
    body: bytes,
  })
  const body = (await response.json().catch(() => ({}))) as { path?: string; error?: string }
  if (!response.ok || !body.path) throw new Error(body.error ?? `上传失败（HTTP ${response.status}）`)
  return body.path
}
