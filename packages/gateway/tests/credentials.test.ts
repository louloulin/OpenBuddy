import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'

import { randomToken, resolveSecret, secretNotice } from '../src/credentials.js'

/**
 * Generated credentials.
 *
 * The rule these tests defend: the value never reaches a log line. Everything
 * the operator is told is a path, an environment variable name, or a mode.
 */

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gw-credentials-'))
  dirs.push(dir)
  return dir
}

const adminOptions = (dir: string | null) => ({
  envValue: undefined,
  envName: 'GATEWAY_ADMIN_TOKEN',
  dataDir: dir,
  fileName: 'admin.token',
  prefix: 'adm_',
})

describe('generated tokens', () => {
  test('an environment token is used as it stands and writes nothing', () => {
    const dir = tempDir()
    const secret = resolveSecret({ ...adminOptions(dir), envValue: 'adm_from_env' })

    expect(secret.value).toBe('adm_from_env')
    expect(secret.origin).toBe('env')
    expect(secret.recoverable).toBe(true)
    expect(() => statSync(join(dir, 'admin.token'))).toThrow()
  })

  test('a generated token lands in an owner-only file', () => {
    const dir = tempDir()
    const secret = resolveSecret(adminOptions(dir))

    expect(secret.origin).toBe('generated')
    expect(secret.recoverable).toBe(true)
    expect(secret.value.startsWith('adm_')).toBe(true)
    expect(readFileSync(join(dir, 'admin.token'), 'utf8').trim()).toBe(secret.value)
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'admin.token')).mode & 0o777).toBe(0o600)
    }
  })

  test('a restart reuses the token the operator already has', () => {
    const dir = tempDir()
    const first = resolveSecret(adminOptions(dir))
    const second = resolveSecret(adminOptions(dir))

    expect(second.value).toBe(first.value)
    expect(second.origin).toBe('file')
    expect(second.recoverable).toBe(true)
  })

  test('an environment token wins over a token left on disk', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'admin.token'), 'adm_stale\n')
    const secret = resolveSecret({ ...adminOptions(dir), envValue: 'adm_from_env' })

    expect(secret.value).toBe('adm_from_env')
    expect(secret.origin).toBe('env')
    // The file is left alone: it may be the operator's own record.
    expect(readFileSync(join(dir, 'admin.token'), 'utf8').trim()).toBe('adm_stale')
  })

  test('a token file that anyone can read is tightened', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'admin.token'), 'adm_existing\n')
    if (process.platform !== 'win32') chmodSync(join(dir, 'admin.token'), 0o644)

    const secret = resolveSecret(adminOptions(dir))

    expect(secret.value).toBe('adm_existing')
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'admin.token')).mode & 0o777).toBe(0o600)
    }
  })

  test('a token that cannot be written is reported as unrecoverable', () => {
    const dir = tempDir()
    // A file where the data directory should be: the write cannot succeed.
    writeFileSync(join(dir, 'not-a-directory'), 'x')
    const secret = resolveSecret(adminOptions(join(dir, 'not-a-directory')))

    expect(secret.origin).toBe('generated')
    expect(secret.recoverable).toBe(false)
  })

  test('no notice ever contains the value', () => {
    const dir = tempDir()
    const generated = resolveSecret(adminOptions(dir))
    const fromEnv = resolveSecret({ ...adminOptions(dir), envValue: 'adm_from_env' })

    for (const secret of [generated, fromEnv]) {
      const notice = secretNotice('admin token', secret, 'GATEWAY_ADMIN_TOKEN')
      expect(notice).toContain('admin token')
      expect(notice).not.toContain(secret.value)
    }
    // The path is the whole instruction: read the file to get the token.
    expect(secretNotice('admin token', generated, 'GATEWAY_ADMIN_TOKEN')).toContain(generated.path!)
  })
})

describe('token shape', () => {
  test('tokens carry their prefix and enough entropy', () => {
    const token = randomToken('agt_')
    expect(token.startsWith('agt_')).toBe(true)
    expect(token.length).toBeGreaterThan(20)
    expect(randomToken('agt_')).not.toBe(token)
  })
})
