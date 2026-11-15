/**
 * Machine-readable error codes for the wire protocol (20261115-md R1, pii W0.6).
 *
 * Electron's `ipcMain.handle` only carries an error's `message` across IPC (custom fields are
 * dropped), so the code travels as a `code: detail` prefix of the message. `ProtocolError`
 * builds that message; `parseProtocolError` reads it back from whatever reaches the renderer
 * ("Error invoking remote method '…': Error: code: detail", a bare preload rejection, or an
 * object that still has `code`). The renderer maps codes to copy in chat-core's error-format.
 */
export const PROTOCOL_ERROR_CODES = [
  'not_implemented',
  'invalid_payload',
  'session_not_loaded',
  'workspace_not_authorized',
  'model_not_found',
  'model_auth_missing',
  'extension_load_failed',
  'export_path_not_authorized',
  'not_found',
  'already_exists',
  'session_busy',
  // 20261116-pii W1.1–W1.3
  'entry_not_found',
  'permission_denied',
  'bash_running',
  // 20261116-pii W2.1–W2.3
  'path_not_authorized',
  'expert_not_found',
  'expert_invalid',
  'expert_readonly',
] as const;
export type ProtocolErrorCode = typeof PROTOCOL_ERROR_CODES[number];

/** The parsed shape of a protocol error. `code` may be a legacy snake_case code outside the list. */
export interface ProtocolErrorInfo {
  code: string;
  message?: string;
  details?: unknown;
}

/** Throw this from host modules / engine features for expected failures of new commands. */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly details?: unknown;
  constructor(code: ProtocolErrorCode, detail?: string, details?: unknown) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ProtocolError';
    this.code = code;
    this.details = details;
  }
}

/** Function form of `new ProtocolError(...)` (pii W1.1–W1.3 call sites). */
export function protocolError(code: ProtocolErrorCode, message?: string, details?: unknown): ProtocolError {
  return new ProtocolError(code, message, details);
}

export const isProtocolErrorCode = (value: unknown): value is ProtocolErrorCode =>
  typeof value === 'string' && (PROTOCOL_ERROR_CODES as readonly string[]).includes(value);

/** Strip the wrappers Electron and `String(error)` put in front of a message. */
export function stripErrorWrappers(text: string): string {
  let out = text.trim();
  for (let i = 0; i < 4; i++) {
    const next = out
      .replace(/^(?:Error:\s*)?Error invoking remote method '[^']+':\s*/, '')
      .replace(/^(?:Uncaught\s+)?(?:Error|ProtocolError|TypeError):\s*/, '')
      .trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

// A snake_case code (at least one underscore, so plain words like "timeout" are not codes),
// optionally followed by ": detail".
const CODE_PREFIX = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?::\s*([\s\S]*))?$/;

/** Read a protocol error code from an Error, an IPC rejection message or a `{ code }` object. */
export function parseProtocolError(error: unknown): ProtocolErrorInfo | undefined {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && CODE_PREFIX.test(code)) {
      const raw = (error as { message?: unknown }).message;
      const message = typeof raw === 'string' ? parseProtocolError(raw)?.message ?? raw : undefined;
      return { code, message: message || undefined, details: (error as { details?: unknown }).details };
    }
  }
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  if (!text) return undefined;
  const match = stripErrorWrappers(text).match(CODE_PREFIX);
  if (!match) return undefined;
  const detail = match[2]?.trim();
  return { code: match[1], message: detail || undefined };
}
