import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative } from 'node:path';
import { Readable } from 'node:stream';

/**
 * `ob-preview://local/<path segments>` (20261115-ui §5.5, D2): serves files
 * inside the workspaces the agent works in, so HTML and PDF artifacts render
 * in a sandboxed iframe on their own origin — never the app's.
 */
export const PREVIEW_SCHEME = 'ob-preview';

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp', pdf: 'application/pdf',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8', xml: 'text/plain; charset=utf-8',
};

/**
 * Scripts and styles may come from the file's folder or a CDN (generated
 * reports often use one), but the page can't fetch, frame or post anything.
 */
export const PREVIEW_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${PREVIEW_SCHEME}: https:`,
  `style-src 'unsafe-inline' ${PREVIEW_SCHEME}: https:`,
  `img-src ${PREVIEW_SCHEME}: data: blob: https:`,
  `font-src ${PREVIEW_SCHEME}: data: https:`,
  `media-src ${PREVIEW_SCHEME}: data: blob:`,
  "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'",
].join('; ');

/** URL → absolute path. Windows drive letters come through as the first segment. */
export function previewPath(url: string, platform: NodeJS.Platform = process.platform): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== `${PREVIEW_SCHEME}:` || parsed.hostname !== 'local') return null;
  let segments: string[];
  try { segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return null; }
  if (!segments.length || segments.some(s => s === '..' || s === '.' || s.includes('/') || s.includes('\\') || s.includes('\0'))) return null;
  const path = platform === 'win32' ? segments.join('\\') : '/' + segments.join('/');
  return (platform === 'win32' ? /^[a-zA-Z]:\\/.test(path) : isAbsolute(path)) ? path : null;
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
};

/** Resolve symlinks on both sides, so a link inside a workspace can't point outside it. */
export async function allowedPreviewPath(path: string, roots: string[]): Promise<string | null> {
  let real: string;
  try { real = await realpath(path); } catch { return null; }
  for (const root of roots) {
    try { if (inside(await realpath(root), real)) return real; } catch { /* missing root */ }
  }
  return null;
}

export async function previewResponse(url: string, roots: string[]): Promise<Response> {
  const requested = previewPath(url);
  if (!requested) return new Response('bad request', { status: 400 });
  const path = await allowedPreviewPath(requested, roots);
  if (!path) return new Response('forbidden', { status: 403 });
  let info;
  try { info = await stat(path); } catch { return new Response('not found', { status: 404 }); }
  if (!info.isFile()) return new Response('not found', { status: 404 });
  const type = MIME[extname(path).slice(1).toLowerCase()] ?? 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Content-Length': String(info.size),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': PREVIEW_CSP,
  };
  const body = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream;
  return new Response(body, { status: 200, headers });
}

