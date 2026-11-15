/**
 * Machine-readable error codes for the wire protocol (20261115-md R1). New commands throw a
 * `ProtocolError`; its message keeps the `code: message` form older handlers already use, so the
 * renderer can map `code` to text before and after the code reaches it as a plain Error.
 */
export type ProtocolErrorCode =
  | 'not_implemented'
  | 'invalid_payload'
  | 'session_not_loaded'
  | 'session_busy'
  | 'workspace_not_authorized'
  | 'path_not_authorized'
  | 'model_not_found'
  | 'model_auth_missing'
  | 'extension_load_failed'
  | 'export_path_not_authorized'
  | 'expert_not_found'
  | 'expert_invalid'
  | 'expert_readonly';

/** An expected failure with a stable `code` (pii W0.6). */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly details?: unknown;
  constructor(code: ProtocolErrorCode, message?: string, details?: unknown) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'ProtocolError';
    this.code = code;
    this.details = details;
  }
}
