/**
 * App lock (20261115-mobile.md §4.2 P1 "安全锁").
 *
 * The phone holds the device token, so a phone left on a table is a paired
 * device. Face ID / fingerprint gates the foreground; the policy lives here so
 * the grace period and the stored flag are testable without native modules.
 *
 * The lock is not a replacement for device encryption: it stops a curious
 * passer-by, and the token stays in Keychain/Keystore either way.
 */

/** Where the enabled flag lives in SecureStore (web: localStorage). */
export const LOCK_KEY = 'openbuddy.appLock'

/** A quick switch (notification centre, camera) must not demand a face scan. */
export const LOCK_GRACE_MS = 20_000

export type LockAvailability = 'ready' | 'no-hardware' | 'not-enrolled' | 'unsupported'

export function parseLockSetting(raw: string | null | undefined): boolean {
  return raw === '1'
}

export function serializeLockSetting(enabled: boolean): string {
  return enabled ? '1' : '0'
}

/** Lock when the app was away longer than the grace window. */
export function shouldRelock(
  enabled: boolean,
  backgroundedAt: number | null,
  now: number,
  graceMs = LOCK_GRACE_MS,
): boolean {
  if (!enabled || backgroundedAt === null) return false
  return now - backgroundedAt >= graceMs
}

/** One sentence the settings row can show when the lock cannot be enabled. */
export function lockUnavailableReason(state: LockAvailability): string | null {
  switch (state) {
    case 'ready':
      return null
    case 'no-hardware':
      return '这台设备没有面容或指纹，暂时不能开启应用锁。'
    case 'not-enrolled':
      return '先在系统设置里录入面容或指纹，再回来开启应用锁。'
    case 'unsupported':
      return '当前环境不支持生物识别（网页预览仅用于设计检查）。'
  }
}
