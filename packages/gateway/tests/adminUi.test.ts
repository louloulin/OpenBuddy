import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { UiAssetMap } from '../src/ui.js'
import { ADMIN_TOKEN, startGateway, type Harness } from './helpers.js'

/**
 * Serving the console's static shell.
 *
 * The gateway must be usable with no UI build at all — that is what lets a
 * server deploy from a tarball — and must never let a static path escape the
 * build directory. Both are checked here because both are mistakes that would
 * only show up in production.
 */

const open: Harness[] = []
const dirs: string[] = []

function gateway(
  overrides: Parameters<typeof startGateway>[0] = {},
  gatewayOptions: Parameters<typeof startGateway>[2] = {},
): Harness {
  const harness = startGateway(overrides, {}, gatewayOptions)
  open.push(harness)
  return harness
}

const encoder = new TextEncoder()

/** A build small enough to read at a glance, shaped like Vite's output. */
function embeddedBuild(): UiAssetMap {
  return new Map([
    ['index.html', encoder.encode('<!doctype html><div id="root">embedded</div>')],
    ['assets/index-emb123.js', encoder.encode('console.log("embedded")')],
    ['assets/index-emb123.css', encoder.encode('body{}')],
  ])
}

afterEach(async () => {
  for (const harness of open.splice(0)) harness.close()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** Writes a minimal build: an index and one hashed asset under assets/. */
async function makeBuild(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gateway-ui-'))
  dirs.push(dir)
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
  await writeFile(join(dir, 'assets', 'index-abc123.js'), 'console.log("console")')
  await writeFile(join(dir, 'assets', 'index-abc123.css'), 'body{}')
  return dir
}

describe('without a build', () => {
  test('/ui answers 404 and explains how to build it', async () => {
    const harness = gateway({ uiDir: join(tmpdir(), 'definitely-not-built-here') })
    const response = await fetch(`${harness.url}/ui`)
    expect(response.status).toBe(404)
    const text = await response.text()
    expect(text).toContain('has not been built')
    expect(text).toContain('gateway-ui')
  })

  test('the admin API is unaffected by a missing build', async () => {
    const harness = gateway({ uiDir: join(tmpdir(), 'definitely-not-built-here') })
    const response = await fetch(`${harness.url}/admin/health`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    expect(response.status).toBe(200)
  })

  test('the mount can be turned off entirely', async () => {
    const dir = await makeBuild()
    const harness = gateway({ uiDir: dir, adminUiEnabled: false })
    const response = await fetch(`${harness.url}/ui/`)
    // No handler is mounted, so the gateway's own 404 answers — and it must not
    // have served the shell.
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('<div id="root">')
  })

  test('the bare domain is the console front door', async () => {
    const dir = await makeBuild()
    const harness = gateway({ uiDir: dir })
    const response = await fetch(`${harness.url}/`, { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/ui/')
  })

  test('the root stays dead when the mount is off', async () => {
    const harness = gateway({ uiDir: join(tmpdir(), 'definitely-not-built-here'), adminUiEnabled: false })
    const response = await fetch(`${harness.url}/`, { redirect: 'manual' })
    expect(response.status).toBe(404)
  })
})

describe('with a build', () => {
  test('serves the shell at /ui and /ui/', async () => {
    const dir = await makeBuild()
    const harness = gateway({ uiDir: dir })
    for (const path of ['/ui', '/ui/']) {
      const response = await fetch(`${harness.url}${path}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(await response.text()).toContain('<div id="root">')
    }
  })

  test('serves assets with an immutable cache and the right type', async () => {
    const dir = await makeBuild()
    const harness = gateway({ uiDir: dir })

    const js = await fetch(`${harness.url}/ui/assets/index-abc123.js`)
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('text/javascript')
    expect(js.headers.get('cache-control')).toContain('immutable')

    const css = await fetch(`${harness.url}/ui/assets/index-abc123.css`)
    expect(css.headers.get('content-type')).toContain('text/css')
  })

  test('answers a client-side route with the shell, not a 404', async () => {
    const dir = await makeBuild()
    const harness = gateway({ uiDir: dir })
    const response = await fetch(`${harness.url}/ui/devices`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<div id="root">')
  })

  test('a missing asset is a 404, never the shell', async () => {
    const dir = await makeBuild()
    const harness = gateway({ uiDir: dir })
    for (const path of ['/ui/assets/gone-999.js', '/ui/missing.css']) {
      const response = await fetch(`${harness.url}${path}`)
      expect(response.status).toBe(404)
      // HTML served where JavaScript was requested fails with a parse error;
      // a plain 404 is the honest answer.
      expect(await response.text()).not.toContain('<div id="root">')
    }
  })

  test('refuses to frame the console', async () => {
    const dir = await makeBuild()
    const harness = gateway({ uiDir: dir })
    const response = await fetch(`${harness.url}/ui/`)
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('sends a CSP that a proxy cannot loosen and grants no capabilities', async () => {
    const dir = await makeBuild()
    const harness = gateway({ uiDir: dir })

    for (const path of ['/ui/', '/ui/devices', '/ui/assets/index-abc123.js']) {
      const response = await fetch(`${harness.url}${path}`)
      const csp = response.headers.get('content-security-policy') ?? ''
      expect(csp).toContain("default-src 'self'")
      expect(csp).toContain("frame-ancestors 'none'")
      expect(csp).toContain("script-src 'self'")
      // `unsafe-eval` and wildcard sources are the two things this console has
      // no use for, so their absence is worth asserting rather than assuming.
      expect(csp).not.toContain('unsafe-eval')
      expect(csp).not.toContain('*')
      expect(response.headers.get('permissions-policy')).toContain('camera=()')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    }
  })

  test('HEAD carries the same headers as GET', async () => {
    const dir = await makeBuild()
    const harness = gateway({ uiDir: dir })
    const response = await fetch(`${harness.url}/ui/assets/index-abc123.js`, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/javascript')
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('does not serve files outside the build directory', async () => {
    const dir = await makeBuild()
    const harness = gateway({ uiDir: dir })
    // Traversal is normalized by the URL parser before it reaches the handler,
    // so this either lands on the shell (a route) or a 404 — never on a file
    // above the build root.
    for (const path of ['/ui/../package.json', '/ui/%2e%2e/package.json', '/ui/..%2Fpackage.json']) {
      const response = await fetch(`${harness.url}${path}`)
      const body = await response.text()
      expect(body).not.toContain('"name": "lumos-gateway"')
    }
  })

  test('the admin API still answers alongside the console', async () => {
    const dir = await makeBuild()
    const harness = gateway({ uiDir: dir })
    const response = await fetch(`${harness.url}/admin/health`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    expect(response.status).toBe(200)
  })
})

describe('with an embedded build', () => {
  const missingDir = join(tmpdir(), 'definitely-not-built-here')

  test('the bare domain redirects straight into the embedded shell with no directory', async () => {
    const harness = gateway({ uiDir: missingDir }, { embeddedUi: embeddedBuild() })
    const response = await fetch(`${harness.url}/`, { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/ui/')
    const shell = await fetch(`${harness.url}/ui/`)
    expect(shell.status).toBe(200)
    expect(await shell.text()).toContain('embedded')
  })

  test('serves the shell and assets with no directory at all', async () => {
    const harness = gateway({ uiDir: missingDir }, { embeddedUi: embeddedBuild() })

    for (const path of ['/ui', '/ui/', '/ui/devices']) {
      const response = await fetch(`${harness.url}${path}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(await response.text()).toContain('embedded')
    }

    const js = await fetch(`${harness.url}/ui/assets/index-emb123.js`)
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('text/javascript')
    expect(js.headers.get('cache-control')).toContain('immutable')
    expect(await js.text()).toContain('embedded')
    // A length before the first byte keeps a large bundle's progress honest.
    expect(js.headers.get('content-length')).toBe('23')
  })

  test('HEAD carries the same headers and no body', async () => {
    const harness = gateway({ uiDir: missingDir }, { embeddedUi: embeddedBuild() })
    const response = await fetch(`${harness.url}/ui/assets/index-emb123.js`, {
      method: 'HEAD',
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/javascript')
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(await response.text()).toBe('')
  })

  test('a missing asset is a 404, never the embedded shell', async () => {
    const harness = gateway({ uiDir: missingDir }, { embeddedUi: embeddedBuild() })
    for (const path of ['/ui/assets/gone-999.js', '/ui/missing.css']) {
      const response = await fetch(`${harness.url}${path}`)
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain('id="root"')
    }
  })

  test('a real directory wins over an embedded copy', async () => {
    const dir = await makeBuild()
    await writeFile(join(dir, 'index.html'), '<!doctype html><div id="root">from-disk</div>')
    const harness = gateway({ uiDir: dir }, { embeddedUi: embeddedBuild() })

    const body = await (await fetch(`${harness.url}/ui`)).text()
    expect(body).toContain('from-disk')
    expect(body).not.toContain('embedded')
  })

  test('traversal cannot reach anything outside the map', async () => {
    const harness = gateway({ uiDir: missingDir }, { embeddedUi: embeddedBuild() })
    for (const path of ['/ui/../package.json', '/ui/%2e%2e/package.json', '/ui/..%2Fpackage.json']) {
      const response = await fetch(`${harness.url}${path}`)
      expect(await response.text()).not.toContain('"name": "lumos-gateway"')
    }
  })

  test('the 404 explains both ways to produce a console', async () => {
    const harness = gateway({ uiDir: missingDir })
    const response = await fetch(`${harness.url}/ui`)
    expect(response.status).toBe(404)
    const text = await response.text()
    expect(text).toContain('gateway-ui')
    expect(text).toContain('build:binary')
  })
})
