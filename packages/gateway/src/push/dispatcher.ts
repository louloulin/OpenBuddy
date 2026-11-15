/**
 * Fan-out from one decision to every registered device.
 *
 * The dispatcher owns the part that is easy to get wrong: a token that Google
 * says is dead must stop being retried, while a token that merely failed to
 * reach the network must survive. It also keeps the per-send failure from
 * taking down the batch — one bad registration must not silence the phone that
 * would have received the notification.
 */

import type { Store } from '../store.js'
import {
  DEFAULT_PUSH_KIND_TITLES,
  type PushKind,
  type PushMessage,
  type PushProvider,
  type PushProviderName,
  type PushRegistration,
} from './types.js'

export type PushNotification = {
  kind: PushKind
  /** The notification's subject; the phone deep-links here on tap. */
  sessionId: string
  /** Overrides the per-kind default, for a publisher that knows the session. */
  title?: string
  body?: string
  /** Deliver to a single device; used by the admin test endpoint. */
  deviceId?: string
  /**
   * Deliver to exactly one registration, for the console's per-row test.
   *
   * Narrower than `deviceId`: a phone may hold several registrations (FCM and
   * a webhook), and testing one of them must not quietly exercise the other.
   */
  registrationId?: string
  /**
   * Restrict delivery to one computer's phones.
   *
   * An event belongs to the sessions of one desktop. Fanning it out to every
   * registration on the gateway would tell one user that another user's session
   * needs attention, and hand their phone a session it cannot open.
   */
  desktopId?: string
  /** Restrict delivery to one account, when only the account is known. */
  userId?: string
  /**
   * The pending approval this notification answers, when one exists. Carried
   * in the push data so the phone's Allow/Deny buttons can POST a decision
   * without opening the app; absent means tap-through only.
   */
  requestId?: string
}

export type PushDeliveryReport = {
  /** Registrations the notification was addressed to. */
  considered: number
  delivered: number
  /** Transient failures; these rows are retried on the next event. */
  retryable: number
  /** Permanent failures; these rows were marked dead and will not be retried. */
  dead: number
  /** Registrations whose provider is not configured on this gateway. */
  skipped: number
}

export type PushDispatcher = {
  /**
   * Registers a destination, or returns null when the token already belongs to
   * another account — see `Store.upsertPushRegistration`.
   */
  register(registration: {
    deviceId: string
    provider: PushProviderName
    token: string
    platform: string
  }): PushRegistration | null
  unregister(id: string): boolean
  unregisterDevice(deviceId: string): number
  notify(notification: PushNotification): Promise<PushDeliveryReport>
  /** Cancels scheduled retries; a closed gateway must not keep timers alive. */
  dispose?(): void
  /** Providers this gateway can actually deliver through. */
  readonly availableProviders: PushProviderName[]
}

export type PushRetryOptions = {
  /** Total attempts per registration, including the first send. Default 3. */
  attempts?: number
  /** First retry delay; later retries double it. Default 2000ms. */
  baseDelayMs?: number
  /** Cap on the exponential delay. Default 30000ms. */
  maxDelayMs?: number
  /** Timer seam for tests; defaults to an unref'd `setTimeout`. */
  schedule?: (fn: () => void, delayMs: number) => unknown
}

export type PushDispatcherOptions = {
  store: Store
  providers: Partial<Record<PushProviderName, PushProvider>>
  log?: (message: string) => void
  retry?: PushRetryOptions
}

export function createPushDispatcher(options: PushDispatcherOptions): PushDispatcher {
  const { store, providers } = options
  const log = options.log ?? (() => {})

  // Retries are opt-in at construction: a gateway wires them in production, while
  // a caller that only wants the first pass keeps deterministic delivery without
  // background timers.
  const attempts = options.retry === undefined ? 1 : Math.max(1, Math.floor(options.retry.attempts ?? 3))
  const baseDelayMs = Math.max(0, options.retry?.baseDelayMs ?? 2_000)
  const maxDelayMs = Math.max(baseDelayMs, options.retry?.maxDelayMs ?? 30_000)
  const customSchedule = options.retry?.schedule
  const schedule = customSchedule ?? ((fn: () => void, delayMs: number) => {
    const timer = setTimeout(fn, delayMs)
    // A pending retry must not be the reason the process stays alive.
    if (typeof (timer as { unref?: unknown }).unref === 'function') {
      (timer as { unref: () => void }).unref()
    }
    return timer
  })

  const pendingRetries = new Set<{ handle: unknown }>()
  let disposed = false

  const retryDelay = (retryOrdinal: number): number =>
    Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, retryOrdinal - 1))

  const markDead = (registration: PushRegistration, error: string): void => {
    store.markPushRegistrationDead(registration.id, error)
    store.audit('push_registration_dead', registration.deviceId, registration.id, {
      provider: registration.provider,
      error,
    })
  }

  /**
   * A transient failure is retried with the exact message that failed; a
   * permanent one retires the registration immediately. Retries report
   * nothing: the caller's delivery report describes this event's first pass.
   */
  const retrySend = async (
    registration: PushRegistration,
    message: PushMessage,
    retryOrdinal: number,
  ): Promise<void> => {
    if (disposed) return
    const provider = providers[registration.provider]
    if (!provider) return

    let outcome: Awaited<ReturnType<PushProvider['send']>>
    try {
      outcome = await provider.send(message)
    } catch (error) {
      if (disposed) return
      log(`[push] ${registration.provider} retry threw: ${error instanceof Error ? error.message : String(error)}`)
      scheduleRetry(registration, message, retryOrdinal + 1)
      return
    }

    // A close that raced the send must not touch the store afterwards.
    if (disposed) return
    if (outcome.ok) return
    if (outcome.permanent) {
      markDead(registration, outcome.error)
      log(`[push] ${registration.provider} retry permanent failure: ${outcome.error}`)
      return
    }
    log(`[push] ${registration.provider} retry transient failure: ${outcome.error}`)
    scheduleRetry(registration, message, retryOrdinal + 1)
  }

  const scheduleRetry = (
    registration: PushRegistration,
    message: PushMessage,
    retryOrdinal: number,
  ): void => {
    // `attempts` counts the first send, so only attempts - 1 retries exist.
    if (disposed || retryOrdinal > attempts - 1) return
    const entry = { handle: undefined as unknown }
    pendingRetries.add(entry)
    entry.handle = schedule(() => {
      pendingRetries.delete(entry)
      if (disposed) return
      void retrySend(registration, message, retryOrdinal)
    }, retryDelay(retryOrdinal))
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    if (!customSchedule) {
      for (const entry of pendingRetries) {
        clearTimeout(entry.handle as ReturnType<typeof setTimeout>)
      }
    }
    pendingRetries.clear()
  }

  const notify = async (notification: PushNotification): Promise<PushDeliveryReport> => {
    const defaults = DEFAULT_PUSH_KIND_TITLES[notification.kind]
    const candidates = notification.registrationId
      ? [store.getPushRegistration(notification.registrationId)].filter(
          (registration): registration is NonNullable<typeof registration> => registration !== null,
        )
      : notification.deviceId
        ? store.listDevicePushRegistrations(notification.deviceId).filter(
            registration => registration.failedAt === null,
          )
        : store.listPushRegistrations({
          ...(notification.desktopId ? { desktopId: notification.desktopId } : {}),
          ...(notification.userId ? { userId: notification.userId } : {}),
        })

    const report: PushDeliveryReport = {
      considered: candidates.length,
      delivered: 0,
      retryable: 0,
      dead: 0,
      skipped: 0,
    }

    // Sends are independent; running them together keeps one slow endpoint from
    // delaying every other phone.
    await Promise.all(candidates.map(async (registration) => {
      const provider = providers[registration.provider]
      if (!provider) {
        report.skipped += 1
        return
      }

      const message: PushMessage = {
        token: registration.token,
        kind: notification.kind,
        title: notification.title ?? defaults.title,
        body: notification.body ?? defaults.body,
        sessionId: notification.sessionId,
        ...(notification.requestId ? { requestId: notification.requestId } : {}),
        // One live row per session: a dozen "waiting for you" notifications for
        // the same session are noise, and the newest one is the true state.
        collapseKey: notification.sessionId,
      }

      let outcome: Awaited<ReturnType<PushProvider['send']>>
      try {
        outcome = await provider.send(message)
      } catch (error) {
        // A provider that throws instead of returning a failure is still just a
        // failed delivery; the device stays registered.
        report.retryable += 1
        log(`[push] ${registration.provider} threw: ${error instanceof Error ? error.message : String(error)}`)
        scheduleRetry(registration, message, 1)
        return
      }

      if (outcome.ok) {
        report.delivered += 1
        return
      }
      if (outcome.permanent) {
        report.dead += 1
        markDead(registration, outcome.error)
        return
      }
      report.retryable += 1
      log(`[push] ${registration.provider} transient failure: ${outcome.error}`)
      scheduleRetry(registration, message, 1)
    }))

    store.audit('push_notified', null, notification.sessionId, {
      kind: notification.kind,
      ...report,
    })
    return report
  }

  return {
    register: registration => store.upsertPushRegistration(registration),
    unregister: id => store.deletePushRegistration(id),
    unregisterDevice: deviceId => store.deleteDevicePushRegistrations(deviceId),
    notify,
    dispose,
    availableProviders: (Object.keys(providers) as PushProviderName[]).filter(name => providers[name]),
  }
}
