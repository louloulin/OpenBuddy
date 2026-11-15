/**
 * Push notifications, as a protocol the rest of the gateway speaks.
 *
 * The gateway never decides what is worth telling a user; it carries a
 * decision someone closer to the session already made (`PushKind`) and knows
 * only how to deliver it. That split is what keeps the transport swappable and
 * the triggers testable.
 */

/**
 * Why the user is being interrupted.
 *
 * `approval` and `question` both mean "this session is waiting for you" —
 * they differ in what answering looks like, so the phone can open the right
 * surface. `done` means work stopped, and `scheduled` means a session started
 * by a scheduled task stopped.
 */
export const PUSH_KINDS = ['approval', 'question', 'done', 'scheduled'] as const
export type PushKind = (typeof PUSH_KINDS)[number]

export function isPushKind(value: unknown): value is PushKind {
  return typeof value === 'string' && (PUSH_KINDS as readonly string[]).includes(value)
}

export const PUSH_PROVIDERS = ['fcm', 'webhook'] as const
export type PushProviderName = (typeof PUSH_PROVIDERS)[number]

export function isPushProviderName(value: unknown): value is PushProviderName {
  return typeof value === 'string' && (PUSH_PROVIDERS as readonly string[]).includes(value)
}

/** One delivery attempt, already addressed to a single registration. */
export type PushMessage = {
  token: string
  kind: PushKind
  title: string
  body: string
  /** Which session the notification opens. Always the notification's subject. */
  sessionId: string
  /**
   * The pending approval the notification's buttons can answer, when one
   * exists; the phone posts the decision straight to the desktop.
   */
  requestId?: string
  /**
   * Collapses repeated notifications for one session on the device instead of
   * stacking a dozen "waiting for you" rows.
   */
  collapseKey?: string
}

export type PushOutcome =
  | { ok: true }
  /**
   * `permanent` means the token will never work again and the registration
   * should be dropped; a transient failure is worth retrying on the next event.
   */
  | { ok: false; permanent: boolean; error: string }

export interface PushProvider {
  readonly name: PushProviderName
  send(message: PushMessage): Promise<PushOutcome>
}

export type PushRegistration = {
  id: string
  deviceId: string
  provider: PushProviderName
  token: string
  platform: string
  createdAt: number
  updatedAt: number
  /** Set by the last permanent failure, so the row can be audited before pruning. */
  lastError: string | null
  failedAt: number | null
}

export const DEFAULT_PUSH_KIND_TITLES: Record<PushKind, { title: string; body: string }> = {
  approval: { title: 'Approval needed', body: 'A session is waiting for your approval.' },
  question: { title: 'Question waiting', body: 'A session asked you something.' },
  done: { title: 'Session finished', body: 'A session stopped working.' },
  scheduled: { title: 'Scheduled task finished', body: 'A scheduled task finished running.' },
}
