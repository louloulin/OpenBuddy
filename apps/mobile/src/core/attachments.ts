/**
 * Camera → desktop attachment pipeline (20261115-mobile.md §5.6).
 *
 * `validate.ts` forbids renderer image bytes on `agent_send`; the contract only
 * accepts `attachments: [{ path }]` pointing at the desktop's own disk. So the
 * phone uploads bytes to the bridge first and sends the returned path. This
 * module owns the client-side rules that keep that hop small and predictable.
 */

/** The bridge accepts these; anything else is rejected before the upload. */
export const UPLOAD_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
export type UploadMime = (typeof UPLOAD_MIME)[number]

/** One upload may be at most 8 MiB (gateway body limit is 20 MiB). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
/** A message may carry at most this many (contract allows 8). */
export const MAX_ATTACHMENTS = 4
/** Downscale target: long edge in pixels before compression. */
export const MAX_EDGE = 1600

export function isUploadMime(value: string): value is UploadMime {
  return (UPLOAD_MIME as readonly string[]).includes(value)
}

/**
 * Compress settings for `expo-image-manipulator`. Returned as data so the
 * native call site stays a two-line function and the policy is testable.
 */
export function compressOptions(width: number, height: number): {
  resize: { width?: number; height?: number } | null
  compress: number
  format: 'jpeg'
} {
  const longEdge = Math.max(width, height)
  if (longEdge <= MAX_EDGE) return { resize: null, compress: 0.8, format: 'jpeg' }
  return width >= height
    ? { resize: { width: MAX_EDGE }, compress: 0.8, format: 'jpeg' }
    : { resize: { height: MAX_EDGE }, compress: 0.8, format: 'jpeg' }
}

export type UploadCheck = { ok: true } | { ok: false; reason: string }

/** Pre-flight check so the user learns about a problem before the upload. */
export function checkUpload(mime: string, bytes: number, existing: number): UploadCheck {
  if (!isUploadMime(mime)) return { ok: false, reason: '只支持 JPG、PNG、WebP 图片。' }
  if (bytes <= 0) return { ok: false, reason: '这张图片读不出来，请重拍。' }
  if (bytes > MAX_UPLOAD_BYTES) return { ok: false, reason: '图片超过 8MB，请先裁剪。' }
  if (existing >= MAX_ATTACHMENTS) return { ok: false, reason: `一条消息最多附 ${MAX_ATTACHMENTS} 张图片。` }
  return { ok: true }
}

/** `POST {base}/upload` — the same `/api` prefix the bridge serves. */
export function uploadPath(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/upload`
}
