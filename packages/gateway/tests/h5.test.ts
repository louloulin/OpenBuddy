import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { handleH5Request } from '../src/h5.js'

/**
 * The gateway serves the phone web client so a phone outside the LAN has a
 * page to open. It is served from the same origin as the API it calls, so the
 * interesting behaviour is the file handling: the shell, its assets, the
 * client-side routes, and the paths that must never resolve.
 */

let root: string | null = null

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = null
})

async function build(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gw-h5-'))
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>Lumos</title><script src="./assets/app-abc123.js"></script>')
  await writeFile(join(dir, 'assets', 'app-abc123.js'), 'export const version = 1\n')
  await writeFile(join(dir, 'favicon.ico'), 'icon')
  root = dir
  return dir
}

describe('the phone web client', () => {
  test('serves the shell', async () => {
    const dir = await build()
    const response = await handleH5Request(
      new Request('https://gw.example/h5/'),
      new URL('https://gw.example/h5/'),
      { h5Dir: dir, enabled: true },
    )
    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toContain('text/html')
    expect(await response?.text()).toContain('Lumos')
  })

  test('redirects /h5 to /h5/ so relative asset URLs stay under the mount', async () => {
    const dir = await build()
    const response = await handleH5Request(
      new Request('https://gw.example/h5'),
      new URL('https://gw.example/h5'),
      { h5Dir: dir, enabled: true },
    )
    expect(response?.status).toBe(308)
    expect(response?.headers.get('location')).toBe('/h5/')
  })

  test('preserves the query string when redirecting the bare mount', async () => {
    const dir = await build()
    const response = await handleH5Request(
      new Request('https://gw.example/h5?d=desktop-1'),
      new URL('https://gw.example/h5?d=desktop-1'),
      { h5Dir: dir, enabled: true },
    )
    expect(response?.status).toBe(308)
    expect(response?.headers.get('location')).toBe('/h5/?d=desktop-1')
  })

  test('serves an asset', async () => {
    const dir = await build()
    const response = await handleH5Request(
      new Request('https://gw.example/h5/assets/app-abc123.js'),
      new URL('https://gw.example/h5/assets/app-abc123.js'),
      { h5Dir: dir, enabled: true },
    )
    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toContain('text/javascript')
  })

  test('a hashed asset is cached forever', async () => {
    const dir = await build()
    const response = await handleH5Request(
      new Request('https://gw.example/h5/assets/app-abc123.js'),
      new URL('https://gw.example/h5/assets/app-abc123.js'),
      { h5Dir: dir, enabled: true },
    )
    expect(response?.headers.get('cache-control')).toContain('immutable')
  })

  test('the shell is never cached', async () => {
    const dir = await build()
    const response = await handleH5Request(
      new Request('https://gw.example/h5/'),
      new URL('https://gw.example/h5/'),
      { h5Dir: dir, enabled: true },
    )
    expect(response?.headers.get('cache-control')).toBe('no-store')
  })

  test('a client-side route falls back to the shell', async () => {
    const dir = await build()
    const response = await handleH5Request(
      new Request('https://gw.example/h5/session/abc'),
      new URL('https://gw.example/h5/session/abc'),
      { h5Dir: dir, enabled: true },
    )
    expect(response?.status).toBe(200)
    expect(await response?.text()).toContain('Lumos')
  })

  test('a missing asset is a 404, not the shell', async () => {
    const dir = await build()
    const response = await handleH5Request(
      new Request('https://gw.example/h5/assets/missing.js'),
      new URL('https://gw.example/h5/assets/missing.js'),
      { h5Dir: dir, enabled: true },
    )
    expect(response?.status).toBe(404)
  })

  test('a traversal never escapes the build directory', async () => {
    const dir = await build()
    for (const target of [
      'https://gw.example/h5/../../etc/passwd',
      'https://gw.example/h5/..%2f..%2fetc%2fpasswd',
      'https://gw.example/h5/assets/..%2f..%2f..%2fetc%2fpasswd',
    ]) {
      const response = await handleH5Request(
        new Request(target),
        new URL(target),
        { h5Dir: dir, enabled: true },
      )
      // Two refusals are possible and both are correct: the URL parser
      // normalizes a raw climb out of `/h5` (so the request is not the
      // client's at all), and an encoded climb that stays under `/h5` is
      // answered as a miss. What must never happen is the file's contents.
      if (response) {
        expect(response.status).toBe(404)
        expect(await response.text()).not.toContain('root:')
      }
    }
  })

  test('another route is left alone', async () => {
    const response = await handleH5Request(
      new Request('https://gw.example/api/sessions'),
      new URL('https://gw.example/api/sessions'),
      { h5Dir: '/nowhere', enabled: true },
    )
    expect(response).toBeNull()
  })

  test('a write is refused', async () => {
    const dir = await build()
    const response = await handleH5Request(
      new Request('https://gw.example/h5/', { method: 'POST' }),
      new URL('https://gw.example/h5/'),
      { h5Dir: dir, enabled: true },
    )
    expect(response?.status).toBe(405)
  })

  test('a build that is missing says how to produce one', async () => {
    const response = await handleH5Request(
      new Request('https://gw.example/h5/'),
      new URL('https://gw.example/h5/'),
      { h5Dir: '/nowhere-at-all', enabled: true },
    )
    expect(response?.status).toBe(404)
    expect(await response?.text()).toContain('has not been built')
  })

  test('the client can be turned off', async () => {
    const dir = await build()
    const response = await handleH5Request(
      new Request('https://gw.example/h5/'),
      new URL('https://gw.example/h5/'),
      { h5Dir: dir, enabled: false },
    )
    expect(response?.status).toBe(404)
  })

  test('the shell cannot be framed', async () => {
    const dir = await build()
    const response = await handleH5Request(
      new Request('https://gw.example/h5/'),
      new URL('https://gw.example/h5/'),
      { h5Dir: dir, enabled: true },
    )
    expect(response?.headers.get('x-frame-options')).toBe('DENY')
    expect(response?.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
