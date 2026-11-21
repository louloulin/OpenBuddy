/**
 * One session watcher per computer that has somewhere to deliver.
 *
 * A single global watcher made sense while the gateway served one desktop: it
 * polled that desktop and told every registered phone. With accounts, the same
 * design would poll one computer (or the gateway's own upstream) and deliver
 * the answer to everyone — wrong data for every user but the first.
 *
 * So a watcher exists per desktop, is created when that desktop comes online
 * with at least one live push registration, and is removed when either goes
 * away. The legacy desktop-less path keeps its original single watcher.
 */

import type { AgentHub } from '../relay/hub.js'
import type { Store } from '../store.js'
import {
  createLiveStatusReader,
  createSessionWatcher,
  type SessionEvent,
  type SessionWatcher,
} from './watcher.js'

export type PushWatchersOptions = {
  store: Store
  hub: AgentHub
  /** Used only by the legacy watcher; account desktops never fall back to it. */
  upstreamUrl: string
  upstreamToken?: string
  intervalMs?: number
  /** Whether a gateway-wide (desktop-less) poll should also run. */
  legacyEnabled: boolean
  onEvents: (desktopId: string | null, events: SessionEvent[]) => void | Promise<void>
  onError: (desktopId: string | null, error: unknown) => void
}

export type PushWatchers = {
  /** Creates watchers for desktops that now qualify, and drops the rest. */
  sync(): void
  stop(): void
  /** Watcher count, for `/health`. */
  size(): number
  /** Which desktops are being watched, for `/health` and tests. */
  watched(): string[]
}

export function createPushWatchers(options: PushWatchersOptions): PushWatchers {
  const active = new Map<string, SessionWatcher>()
  let legacy: SessionWatcher | null = null

  const create = (desktopId: string | null): SessionWatcher => {
    // An account desktop is read through its own agent; a null desktop is the
    // legacy path, which may use the gateway's configured upstream.
    const reader = createLiveStatusReader({
      hub: options.hub,
      upstreamUrl: options.upstreamUrl,
      ...(options.upstreamToken ? { upstreamToken: options.upstreamToken } : {}),
      ...(desktopId ? { route: desktopId } : {}),
    })
    return createSessionWatcher({
      read: reader,
      intervalMs: options.intervalMs,
      shouldPoll: () => {
        if (desktopId) {
          // Nothing to deliver to, or the computer went away: skip the read so
          // a sleeping desktop is not probed every few seconds forever.
          return options.hub.isOnline(desktopId)
            && options.store.listPushRegistrations({ desktopId }).length > 0
        }
        return options.store.countPushRegistrations().active > 0
      },
      onEvents: (events) => options.onEvents(desktopId, events),
      onError: (error) => options.onError(desktopId, error),
    })
  }

  const sync = () => {
    // A watcher is only worth a timer while its computer can answer. An
    // offline desktop is picked up by the next sync once its agent dials in.
    const wanted = new Set(
      options.store
        .desktopsWithPushRegistrations()
        .filter((desktopId) => options.hub.isOnline(desktopId)),
    )

    for (const [desktopId, watcher] of active) {
      if (wanted.has(desktopId)) continue
      watcher.stop()
      active.delete(desktopId)
    }

    for (const desktopId of wanted) {
      if (active.has(desktopId)) continue
      const watcher = create(desktopId)
      active.set(desktopId, watcher)
      watcher.start()
    }

    if (options.legacyEnabled) {
      if (!legacy) {
        legacy = create(null)
        legacy.start()
      }
    } else if (legacy) {
      legacy.stop()
      legacy = null
    }
  }

  return {
    sync,
    stop() {
      for (const watcher of active.values()) watcher.stop()
      active.clear()
      legacy?.stop()
      legacy = null
    },
    size: () => active.size + (legacy ? 1 : 0),
    watched: () => [...active.keys()],
  }
}
