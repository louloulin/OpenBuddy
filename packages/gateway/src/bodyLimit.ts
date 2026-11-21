/**
 * JSON bodies read under a byte cap.
 *
 * `req.json()` buffers whatever arrives before anyone looks at the size, and
 * a chunked request carries no `content-length` to preview. These routes only
 * ever take tiny payloads (a pairing code, an email, a push token), so an
 * authenticated phone streaming gigabytes was memory it could take, not
 * bandwidth it had to earn. The body is therefore read chunk by chunk and
 * abandoned the moment it crosses the cap.
 */

export const JSON_BODY_LIMIT_BYTES = 1024 * 1024

export type JsonBody =
  | { tooLarge: false; body: unknown }
  | { tooLarge: true; body: null }

export async function readJsonBody(
  req: Request,
  maxBytes = JSON_BODY_LIMIT_BYTES,
): Promise<JsonBody> {
  if (!req.body) return { tooLarge: false, body: null }

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { tooLarge: true, body: null }
  }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value || value.byteLength === 0) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return { tooLarge: true, body: null }
    }
    chunks.push(value)
  }
  if (total === 0) return { tooLarge: false, body: null }

  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { tooLarge: false, body: JSON.parse(new TextDecoder().decode(joined)) }
  } catch {
    return { tooLarge: false, body: null }
  }
}
