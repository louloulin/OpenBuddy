/**
 * Credential material the gateway generates for itself.
 *
 * A generated token is the highest privilege the gateway has, and stdout is
 * the one channel that cannot be kept private: log shippers, CI transcripts,
 * tmux scrollback and crash dumps all outlive the process that printed them.
 * So a generated token is written to a file only the operator can read, and
 * the operator is told the path — never the value.
 *
 * A token supplied through the environment belongs to the operator already and
 * is never copied anywhere: the gateway only uses it.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** `adm_…` / `agt_…`: 24 random bytes, base64url, no padding. */
export function randomToken(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return `${prefix}${Buffer.from(bytes).toString('base64url')}`
}

/** Where a credential came from. */
export type SecretOrigin =
  /** The operator set it in the environment. */
  | 'env'
  /** The gateway read it back from its own file. */
  | 'file'
  /** The gateway made it up and wrote it to its own file. */
  | 'generated'

export type ResolvedSecret = {
  value: string
  origin: SecretOrigin
  /** The file the gateway manages, when it has one. */
  path: string | null
  /**
   * Whether the operator can obtain this value without reading a log.
   *
   * True for an environment value (they have it) and for a value on disk.
   * False only when the gateway generated a token and could not store it —
   * the credential exists, but nobody can learn it.
   */
  recoverable: boolean
}

export type SecretOptions = {
  /** The operator-supplied value. When set, the filesystem is never touched. */
  envValue: string | undefined
  /** The variable the value came from, for the operator-facing message. */
  envName: string
  /** Directory the token file lives in. Null means there is nowhere to put it. */
  dataDir: string | null
  fileName: string
  prefix: string
}

/**
 * Resolves one credential: the environment first, then the gateway's own file.
 *
 * A file that already holds a token is reused, so a restart does not invalidate
 * the credential the operator saved. A missing file gets a fresh token, written
 * with owner-only permissions.
 */
export function resolveSecret(options: SecretOptions): ResolvedSecret {
  const { envValue, envName, dataDir, fileName, prefix } = options
  if (envValue) return { value: envValue, origin: 'env', path: null, recoverable: true }

  const path = dataDir ? join(dataDir, fileName) : null
  if (path) {
    try {
      const existing = readFileSync(path, 'utf8').trim()
      if (existing) {
        // A token file that anyone but the operator can read is a leak waiting
        // to happen; tighten it without disturbing the value.
        try {
          chmodSync(path, 0o600)
        } catch {
          // Not fatal: the value is still correct, only the mode is off.
        }
        return { value: existing, origin: 'file', path, recoverable: true }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EACCES' || code === 'EPERM') {
        // The token exists but cannot be read. Generating a new one would
        // silently replace the operator's credential, so the gateway stops.
        throw new Error(
          `[gateway] ${path} exists but cannot be read; fix its permissions or set ${envName}`,
        )
      }
      // Absent: a fresh token is generated below.
    }
  }

  const value = randomToken(prefix)
  if (path) {
    try {
      mkdirSync(dataDir!, { recursive: true })
      writeFileSync(path, `${value}\n`, { mode: 0o600 })
      chmodSync(path, 0o600)
      return { value, origin: 'generated', path, recoverable: true }
    } catch (error) {
      console.error(
        `[gateway] could not write ${path}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return { value, origin: 'generated', path, recoverable: false }
}

/**
 * The one line the operator sees about a credential.
 *
 * It never contains the value — that is the whole point of the file.
 */
export function secretNotice(label: string, secret: ResolvedSecret, envName: string): string {
  if (secret.origin === 'env') return `[gateway] ${label} comes from ${envName}`
  if (secret.recoverable && secret.path) {
    const verb = secret.origin === 'file' ? 'restored from' : 'written to'
    return `[gateway] ${label} ${verb} ${secret.path} (mode 0600)`
  }
  return `[gateway] ${label} could not be persisted; set ${envName} explicitly`
}
