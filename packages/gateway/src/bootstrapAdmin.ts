/**
 * Creating the first administrator.
 *
 * A gateway with no admin account cannot be administered through the console,
 * and the break-glass token is not something anyone should have to hand-type
 * into a browser on every deployment. So the operator can name one account in
 * the environment and have it exist on boot — idempotently, and without ever
 * overwriting a password someone has since changed.
 */

import type { GatewayConfig } from './config.js'
import { isAdminUser } from './auth.js'
import type { Store, UserRow } from './store.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MIN_ADMIN_PASSWORD_LENGTH = 8
export const MAX_ADMIN_PASSWORD_LENGTH = 200

export type BootstrapResult =
  /** The account was created with `role = 'admin'`. */
  | { kind: 'created'; user: UserRow }
  /** An existing account was promoted; its password was left alone. */
  | { kind: 'promoted'; user: UserRow }
  /** Already an admin: nothing to do, so a restart is not a password reset. */
  | { kind: 'already-admin'; user: UserRow }
  /** No bootstrap configured, or only half of it. */
  | { kind: 'skipped'; reason: string }

/**
 * Ensures the configured account exists as an administrator.
 *
 * Deliberately does **not** reset an existing account's password: the value in
 * the environment is a bootstrap secret, and a deployment that keeps it set
 * should not silently undo a password change made in the console. Promoting an
 * existing ordinary account (an owner who already signed up on their phone) is
 * the one thing this does beyond creation, and it is the common case.
 */
export async function ensureBootstrapAdmin(
  store: Store,
  config: GatewayConfig,
  log: (message: string) => void = console.log,
): Promise<BootstrapResult> {
  const email = config.bootstrapAdminEmail
  const password = config.bootstrapAdminPassword

  if (!email && !password) return { kind: 'skipped', reason: 'no GATEWAY_ADMIN_EMAIL/PASSWORD' }
  if (!email || !password) {
    // Half a credential is a typo, not an instruction. Say so loudly enough to
    // find in a boot log, and carry on — refusing to start would take a
    // working gateway down over a missing variable.
    log('[gateway] GATEWAY_ADMIN_EMAIL and GATEWAY_ADMIN_PASSWORD must be set together; ignoring both')
    return { kind: 'skipped', reason: 'incomplete bootstrap credentials' }
  }
  if (!EMAIL_PATTERN.test(email)) {
    log(`[gateway] GATEWAY_ADMIN_EMAIL is not an email address; ignoring it`)
    return { kind: 'skipped', reason: 'invalid bootstrap email' }
  }
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH || password.length > MAX_ADMIN_PASSWORD_LENGTH) {
    log(
      `[gateway] GATEWAY_ADMIN_PASSWORD must be ${MIN_ADMIN_PASSWORD_LENGTH}-`
        + `${MAX_ADMIN_PASSWORD_LENGTH} characters; ignoring it`,
    )
    return { kind: 'skipped', reason: 'invalid bootstrap password length' }
  }

  const existing = store.getUserByEmail(email)
  if (existing) {
    if (isAdminUser(existing)) {
      log(`[gateway] admin account already exists: ${email}`)
      return { kind: 'already-admin', user: existing }
    }
    if (existing.disabled_at !== null) {
      log(`[gateway] account ${email} is disabled; refusing to promote it`)
      return { kind: 'skipped', reason: 'account is disabled' }
    }
    store.setUserRole(existing.id, 'admin')
    store.audit('admin_bootstrapped', null, existing.id, { email, promoted: true })
    log(`[gateway] promoted existing account to admin: ${email}`)
    return { kind: 'promoted', user: { ...existing, role: 'admin' } }
  }

  let passwordHash: string
  try {
    passwordHash = await Bun.password.hash(password)
  } catch (error) {
    log(`[gateway] could not hash the bootstrap password: ${error instanceof Error ? error.message : String(error)}`)
    return { kind: 'skipped', reason: 'password hashing failed' }
  }

  const user = store.createUser({
    id: crypto.randomUUID(),
    email,
    passwordHash,
    displayName: null,
    role: 'admin',
  })
  store.audit('admin_bootstrapped', null, user.id, { email, promoted: false })
  // The password is never logged; only the address, which the operator already
  // knows and which makes the log line useful.
  log(`[gateway] created admin account: ${email}`)
  return { kind: 'created', user }
}
