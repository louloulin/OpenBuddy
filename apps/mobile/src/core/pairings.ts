/**
 * Several desktops on one phone (20261117-mobile.md E3).
 *
 * Pairings are local credentials — one gateway URL + device token each — so
 * switching computers needs no gateway change. The list is keyed by a stable
 * id derived from the URL and token; the UI shows the active one and switches
 * in place, reusing the single transport.
 */

export type PairingRecord = {
  id: string
  /** What the user sees: device name, or the gateway host. */
  label: string
  gatewayUrl: string
  deviceToken: string
  deviceId?: string
  deviceName?: string
  /** Epoch ms, for ordering the list most-recently-used first. */
  lastUsedAt: number
}

export function hostOf(gatewayUrl: string): string {
  try {
    return new URL(gatewayUrl).host
  } catch {
    return gatewayUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  }
}

/** Stable across launches; token changes mean a new pairing anyway. */
export function pairingRecordId(gatewayUrl: string, deviceToken: string): string {
  return `${gatewayUrl}#${deviceToken.slice(0, 12)}`
}

export function makePairingRecord(
  input: {
    gatewayUrl: string
    deviceToken: string
    deviceId?: string
    deviceName?: string
    label?: string
  },
  now: number,
): PairingRecord {
  return {
    id: pairingRecordId(input.gatewayUrl, input.deviceToken),
    label: input.label?.trim() || input.deviceName?.trim() || hostOf(input.gatewayUrl),
    gatewayUrl: input.gatewayUrl,
    deviceToken: input.deviceToken,
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    ...(input.deviceName ? { deviceName: input.deviceName } : {}),
    lastUsedAt: now,
  }
}

/** Upsert by id, keeping the most recently used first. */
export function upsertPairing(list: readonly PairingRecord[], record: PairingRecord): PairingRecord[] {
  const next = list.filter(item => item.id !== record.id)
  next.push(record)
  return next.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

export function removePairing(list: readonly PairingRecord[], id: string): PairingRecord[] {
  return list.filter(item => item.id !== id)
}

export function findPairing(list: readonly PairingRecord[], id: string | undefined): PairingRecord | undefined {
  if (!id) return undefined
  return list.find(item => item.id === id)
}

/**
 * The id that should be active: the requested one if it still exists, else the
 * most recent pairing, else undefined (nothing paired).
 */
export function resolveActiveId(list: readonly PairingRecord[], requested?: string): string | undefined {
  if (requested && list.some(item => item.id === requested)) return requested
  return list[0]?.id
}
