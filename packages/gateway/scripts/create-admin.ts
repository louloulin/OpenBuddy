/**
 * Creates or promotes an administrator from a shell.
 *
 * The console can do this too, but the console is reachable only once an admin
 * exists — and a deployment locked out of its own gateway should not need to
 * edit the database by hand.
 *
 *   GATEWAY_DB=/opt/service/lumos/data/gateway.sqlite \
 *   bun run admin:create admin@example.com
 *
 * The password is read from stdin (never argv, which `ps` exposes to every user
 * on the host) or from GATEWAY_ADMIN_PASSWORD for scripted setups.
 */

import { loadConfig } from '../src/config.js'
import {
  MAX_ADMIN_PASSWORD_LENGTH,
  MIN_ADMIN_PASSWORD_LENGTH,
} from '../src/bootstrapAdmin.js'
import { isAdminUser } from '../src/auth.js'
import { Store } from '../src/store.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function readPassword(): Promise<string> {
  const fromEnv = process.env.GATEWAY_ADMIN_PASSWORD
  if (fromEnv) return fromEnv

  process.stdout.write('Password: ')
  // Echo is off, so the operator can type without it landing in a scrollback.
  if (process.stdin.isTTY) process.stdin.setRawMode?.(true)
  let value = ''
  for await (const chunk of process.stdin) {
    const text = String(chunk)
    if (text.includes('\n') || text.includes('\r')) {
      value += text.replace(/[\r\n].*$/s, '')
      break
    }
    if (text === '\u0003') {
      // Ctrl-C in raw mode does not raise SIGINT.
      process.stdout.write('\n')
      process.exit(130)
    }
    value += text
  }
  if (process.stdin.isTTY) process.stdin.setRawMode?.(false)
  process.stdout.write('\n')
  return value
}

async function main(): Promise<void> {
  const email = (process.argv[2] ?? '').trim().toLowerCase()
  if (!EMAIL_PATTERN.test(email)) {
    console.error('usage: bun run admin:create <email>')
    console.error('       (the password is read from stdin or GATEWAY_ADMIN_PASSWORD)')
    process.exit(2)
  }

  const password = await readPassword()
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH || password.length > MAX_ADMIN_PASSWORD_LENGTH) {
    console.error(`password must be ${MIN_ADMIN_PASSWORD_LENGTH}-${MAX_ADMIN_PASSWORD_LENGTH} characters`)
    process.exit(2)
  }

  const config = loadConfig()
  const store = new Store(config.dbPath)
  try {
    const existing = store.getUserByEmail(email)
    if (existing) {
      if (isAdminUser(existing)) {
        console.log(`${email} is already an administrator; nothing changed.`)
        return
      }
      store.setUserRole(existing.id, 'admin')
      store.audit('admin_created', null, existing.id, { email, via: 'cli', promoted: true })
      console.log(`Promoted existing account to administrator: ${email}`)
      return
    }

    const passwordHash = await Bun.password.hash(password)
    const user = store.createUser({
      id: crypto.randomUUID(),
      email,
      passwordHash,
      displayName: null,
      role: 'admin',
    })
    store.audit('admin_created', null, user.id, { email, via: 'cli', promoted: false })
    console.log(`Created administrator: ${email}`)
  } finally {
    store.close()
  }
}

await main()
