/**
 * Serving the built admin console.
 *
 * The console is a separate package with its own toolchain, and the gateway
 * must not need it to run: a gateway deployed from a tarball that has no
 * `gateway-ui/dist` still serves every API, and an operator who never builds
 * the UI is not punished for it. So this reads a directory and degrades to a
 * 404 that says how to produce it.
 *
 * Nothing here is authenticated. The console's HTML and its bundle are inert;
 * the data behind them comes from `/admin/*`, which is. That is also why the
 * shell may be cached but the API may not: a stale bundle is a bug report, a
 * stale device list is a wrong decision.
 */

import { stat } from 'node:fs/promises'
import { join, normalize, posix, resolve, sep } from 'node:path'

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

/** Vite emits content-hashed files under `assets/`, so they never change in place. */
const IMMUTABLE_PREFIX = '/assets/'
const UI_PREFIX = '/ui'

/**
 * The same policy the shell declares in `<meta>`, plus `frame-ancestors`.
 *
 * Browsers ignore `frame-ancestors` in a meta tag, so the part that actually
 * stops clickjacking has to arrive as a header. Sending the whole policy here
 * too means a proxy that strips `<meta>` cannot loosen the console: two
 * policies intersect, and these directives are identical.
 */
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
  + "script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; "
  + "form-action 'self'; frame-ancestors 'none'"

/** Nothing in the console needs a device capability, so none is granted. */
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'

/**
 * Applies every header the static shell must carry.
 *
 * Stated once because there are three response paths (shell, asset, HEAD) and a
 * security header that only guards two of them is a header that will be missed.
 */
function setSecurityHeaders(headers: Headers): void {
  // A console that could be framed is a clickjacking target on an origin that
  // holds admin credentials.
  headers.set('X-Frame-Options', 'DENY')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  headers.set('Permissions-Policy', PERMISSIONS_POLICY)
}

/**
 * A console build held in memory rather than on disk.
 *
 * Keys are the paths inside `gateway-ui/dist` (`index.html`,
 * `assets/index-abc.js`), with forward slashes regardless of platform. This is
 * what lets `bun build --compile` produce a single executable that still serves
 * `/ui` on a machine where no `dist` directory exists.
 */
export type UiAssetMap = ReadonlyMap<string, Uint8Array>

let embeddedUi: UiAssetMap | null = null

/**
 * Installs a packaged console. Called by the generated embedding entry before
 * the gateway starts; tests can pass `embedded` directly instead.
 */
export function setEmbeddedUi(assets: UiAssetMap | null): void {
  embeddedUi = assets
}

export type UiMountOptions = {
  /** Directory holding the built console (`index.html` at its root). */
  uiDir: string
  /**
   * In-memory build. A directory that contains `index.html` still wins, so a
   * developer's `GATEWAY_UI_DIR` is never shadowed by a stale embedded copy.
   */
  embedded?: UiAssetMap | null
}

/**
 * Resolves a URL path to a file inside the build directory, or null.
 *
 * The resolved path must stay inside the build root: a traversal that escaped
 * it would turn the console's static handler into a reader for the whole disk.
 */
function resolveInside(root: string, urlPath: string): string | null {
  const relative = urlPath.replace(/^\/+/, '')
  if (!relative) return null
  const candidate = resolve(root, normalize(relative))
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  return candidate
}

export function contentTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  const extension = dot === -1 ? '' : filePath.slice(dot).toLowerCase()
  return MIME_TYPES[extension] ?? 'application/octet-stream'
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function serveFile(path: string, headers: Headers): Promise<Response> {
  headers.set('Content-Type', contentTypeFor(path))
  headers.set('Content-Length', String((await stat(path)).size))
  setSecurityHeaders(headers)
  // `Bun.file` streams the body; the stat above exists so the client can see a
  // length before the first byte, which is what makes a large bundle's progress
  // bar honest.
  return new Response(Bun.file(path), { status: 200, headers })
}

function unbuiltResponse(): Response {
  return new Response(
    'The admin console has not been built.\n\n'
      + '  cd gateway-ui && bun install && bun run build\n\n'
      + 'Or point GATEWAY_UI_DIR at an existing build, or run `bun run build:binary` '
      + 'for a packaged gateway with the console embedded. The admin API on /admin/* works without it.\n',
    { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } },
  )
}

/**
 * Maps a URL path onto an embedded key.
 *
 * There is no filesystem to escape here, but a key that climbs out is still
 * nonsense and cheap to reject rather than silently miss.
 */
function embeddedKey(relative: string): string | null {
  const trimmed = relative.replace(/^\/+/, '')
  if (!trimmed) return 'index.html'
  if (trimmed.includes('\\')) return null
  const normalized = posix.normalize(trimmed)
  if (normalized === '..' || normalized.startsWith('../')) return null
  return normalized
}

function embeddedResponse(
  request: Request,
  body: Uint8Array,
  path: string,
  cacheControl: string,
): Response {
  const headers = new Headers({
    'Cache-Control': cacheControl,
    'Content-Type': contentTypeFor(path),
    'Content-Length': String(body.byteLength),
  })
  setSecurityHeaders(headers)
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers })
}

/** Serves a build from memory with the same routing and header rules as disk. */
function handleEmbeddedRequest(
  request: Request,
  url: URL,
  assets: UiAssetMap,
): Response {
  const index = assets.get('index.html')!
  const relative = url.pathname.slice(UI_PREFIX.length)
  if (relative === '' || relative === '/') {
    return embeddedResponse(request, index, 'index.html', 'no-store')
  }

  const key = embeddedKey(relative)
  const body = key ? assets.get(key) : undefined
  if (key && body) {
    return embeddedResponse(
      request,
      body,
      key,
      relative.startsWith(IMMUTABLE_PREFIX)
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
    )
  }

  if (relative.startsWith(IMMUTABLE_PREFIX) || /\.[a-z0-9]+$/i.test(relative)) {
    return new Response('not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  return embeddedResponse(request, index, 'index.html', 'no-store')
}

/**
 * Answers a console request, or returns null when the path is not the console.
 *
 * A build that is missing answers 404 with an instruction rather than a silent
 * pass-through: an operator who configured `/ui` and got the gateway's JSON
 * 404 would reasonably conclude the UI is broken instead of unbuilt.
 */
export async function handleUiRequest(
  request: Request,
  url: URL,
  options: UiMountOptions,
): Promise<Response | null> {
  const pathname = url.pathname
  if (pathname !== UI_PREFIX && !pathname.startsWith(`${UI_PREFIX}/`)) return null
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  }

  const root = resolve(options.uiDir)
  const indexPath = join(root, 'index.html')
  const embedded = options.embedded ?? embeddedUi
  if (!(await isFile(indexPath))) {
    // A packaged binary has no directory to read; a developer's build always
    // wins when it exists, so an embedded (possibly older) copy cannot shadow it.
    if (embedded?.has('index.html')) return handleEmbeddedRequest(request, url, embedded)
    return unbuiltResponse()
  }

  // `/ui` and `/ui/` are the app itself.
  const relative = pathname.slice(UI_PREFIX.length)
  if (relative === '' || relative === '/') {
    const headers = new Headers({ 'Cache-Control': 'no-store' })
    headers.set('Content-Type', 'text/html; charset=utf-8')
    headers.set('Content-Length', String((await stat(indexPath)).size))
    setSecurityHeaders(headers)
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
    return new Response(Bun.file(indexPath), { status: 200, headers })
  }

  const filePath = resolveInside(root, relative)
  if (filePath && (await isFile(filePath))) {
    const headers = new Headers({
      'Cache-Control': relative.startsWith(IMMUTABLE_PREFIX)
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
    })
    if (request.method === 'HEAD') {
      headers.set('Content-Type', contentTypeFor(filePath))
      headers.set('Content-Length', String((await stat(filePath)).size))
      setSecurityHeaders(headers)
      return new Response(null, { status: 200, headers })
    }
    return serveFile(filePath, headers)
  }

  // An asset that is missing is missing. Falling back to the shell here would
  // hand a browser HTML where it asked for JavaScript, and the page would fail
  // with a parse error instead of a clear 404.
  if (relative.startsWith(IMMUTABLE_PREFIX) || /\.[a-z0-9]+$/i.test(relative)) {
    return new Response('not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  // Any other path is a client-side route; the shell resolves it.
  return serveFile(indexPath, new Headers({ 'Cache-Control': 'no-store' }))
}
