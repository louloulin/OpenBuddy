/**
 * Serving the phone's web client from the gateway.
 *
 * The H5 client and the Electron renderer are the same React application, so
 * a phone that wants to talk to a desktop through the gateway needs a page to
 * open. Without one, the only URL that serves it is the desktop's own address
 * on the LAN — which is exactly the situation the gateway exists to remove.
 *
 * So the gateway serves the built H5 bundle under `/h5`. The page is then
 * same-origin with the API it calls: the client's own origin is the gateway's
 * origin, the browser sends no cross-origin request at all, and the CORS and
 * CSP rules that a separate static host would force on the deployment simply
 * do not arise.
 *
 * The bundle is large (tens of megabytes with its syntax themes and fonts) and
 * is therefore read from disk rather than embedded in the binary. A packaged
 * gateway serves it from a directory beside itself.
 */

import { stat } from 'node:fs/promises'
import { join, normalize, resolve, sep } from 'node:path'

import { contentTypeFor } from './ui.js'

/** Vite emits content-hashed files under `assets/`, so they never change in place. */
const IMMUTABLE_PREFIX = '/assets/'

/** Where the H5 client lives, relative to the gateway's origin. */
export const H5_PREFIX = '/h5'

export type H5MountOptions = {
  /** Directory holding the built H5 client (`index.html` at its root). */
  h5Dir: string
  /** Whether the gateway publishes the client at all. */
  enabled: boolean
}

/**
 * Applies the headers the client must carry.
 *
 * The client ships its own content security policy in a `<meta>` tag, and two
 * policies intersect: a second one here could only narrow it, never widen it.
 * So this sends the headers a policy cannot express on its own and leaves the
 * policy alone.
 */
function setSecurityHeaders(headers: Headers): void {
  // The client shows a login form on this origin. Letting a page frame it
  // would put a clickjacking target in front of credentials.
  headers.set('X-Frame-Options', 'DENY')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Resolves a URL path to a file inside the build directory, or null.
 *
 * The resolved path must stay inside the build root: a traversal that escaped
 * it would turn the client's static handler into a reader for the whole disk.
 */
function resolveInside(root: string, urlPath: string): string | null {
  const relative = urlPath.replace(/^\/+/, '')
  if (!relative) return null
  const candidate = resolve(root, normalize(relative))
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  return candidate
}

/**
 * Whether a request path tried to climb out of the build directory.
 *
 * `resolveInside` already refuses to open such a file, but a refusal that
 * falls through to the shell answers 200 with the app, which reads like a hit.
 * Both the raw and the decoded form are checked, because the path arrives
 * percent-encoded and `..%2f` is still a climb.
 */
function climbsOut(relative: string): boolean {
  const forms = [relative]
  try {
    forms.push(decodeURIComponent(relative))
  } catch {
    // A path this cannot decode is not one the decoder can resolve either;
    // the raw form above still decides.
  }
  return forms.some((form) => {
    if (form.includes('\\')) return true
    return form.split('/').some(segment => segment === '..')
  })
}

function unbuiltResponse(h5Dir: string): Response {
  return new Response(
    'The phone web client has not been built.\n\n'
      + `  Expected it at ${h5Dir}\n\n`
      + '  Build it first: cd desktop && bun run build && cd ../mobile && bun run sync:web\n'
      + 'Or point GATEWAY_H5_DIR at an existing build.\n',
    { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } },
  )
}

function notFoundResponse(): Response {
  return new Response('not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function serveFile(path: string, headers: Headers, method: string): Promise<Response> {
  headers.set('Content-Type', contentTypeFor(path))
  headers.set('Content-Length', String((await stat(path)).size))
  setSecurityHeaders(headers)
  if (method === 'HEAD') return new Response(null, { status: 200, headers })
  return new Response(Bun.file(path), { status: 200, headers })
}

/**
 * Answers a client request, or returns null when the path is not the client.
 *
 * A build that is missing answers 404 with an instruction rather than a silent
 * pass-through: an operator who pointed `/h5` at a directory and got the
 * gateway's JSON 404 would reasonably conclude the client is broken instead of
 * unbuilt.
 */
export async function handleH5Request(
  request: Request,
  url: URL,
  options: H5MountOptions,
): Promise<Response | null> {
  const pathname = url.pathname
  if (pathname !== H5_PREFIX && !pathname.startsWith(`${H5_PREFIX}/`)) return null
  if (!options.enabled) {
    return new Response('the phone web client is disabled on this gateway', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  }

  const root = resolve(options.h5Dir)
  const indexPath = join(root, 'index.html')
  if (!(await isFile(indexPath))) return unbuiltResponse(options.h5Dir)

  // The shell references its assets relatively (`./assets/...`), which only
  // resolves under `/h5/`. A browser that loads `/h5` treats the mount as a
  // file and asks for `/assets/...` at the origin root, where nothing exists.
  // Redirect before serving so the document always has a directory base.
  if (pathname === H5_PREFIX) {
    return new Response(null, {
      status: 308,
      headers: { location: `${H5_PREFIX}/${url.search}`, 'cache-control': 'no-store' },
    })
  }

  // `/h5/` is the client itself.
  const relative = pathname.slice(H5_PREFIX.length)
  if (relative === '') {
    return serveFile(indexPath, new Headers({ 'Cache-Control': 'no-store' }), request.method)
  }

  const filePath = resolveInside(root, relative)
  if (filePath && (await isFile(filePath))) {
    const headers = new Headers({
      'Cache-Control': relative.startsWith(IMMUTABLE_PREFIX)
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
    })
    return serveFile(filePath, headers, request.method)
  }

  // An asset that is missing is missing. Falling back to the shell here would
  // hand a browser HTML where it asked for JavaScript, and the page would fail
  // with a parse error instead of a clear 404.
  if (relative.startsWith(IMMUTABLE_PREFIX) || /\.[a-z0-9]+$/i.test(relative)) {
    return notFoundResponse()
  }

  // A path that tried to climb out is not a client-side route either: it is
  // answered plainly rather than with a 200 the caller could mistake for a
  // hit. `resolveInside` already refused to open anything; this keeps the
  // refusal visible instead of disguising it as a route.
  if (climbsOut(relative)) return notFoundResponse()

  // Any other path is a client-side route; the shell resolves it.
  return serveFile(indexPath, new Headers({ 'Cache-Control': 'no-store' }), request.method)
}
