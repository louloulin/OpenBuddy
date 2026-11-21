/**
 * Tunnel state copy for the Me screen (20261117-mobile.md §2.5 重连).
 *
 * Auto-reconnect runs in the background, but when it keeps failing the user has
 * no way to nudge it from a dead screen. The Me row doubles as a manual retry,
 * so the label and the "is there anything to retry" test live here — pure and
 * unit-testable, away from the transport.
 */

import type { TransportState } from '@openbuddy/client/transport'

export function connectionLabel(state: TransportState): string {
  return state === 'open' ? '已连接' : state === 'connecting' ? '连接中' : '已断开'
}

/** Only a dropped tunnel has something to retry; tapping an open one is a no-op. */
export function canRetryConnection(state: TransportState): boolean {
  return state !== 'open'
}

export function connectionRowValue(state: TransportState): string {
  return canRetryConnection(state) ? `${connectionLabel(state)} · 点按重连` : connectionLabel(state)
}
