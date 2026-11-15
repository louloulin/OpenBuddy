/**
 * Machine-readable error codes for the wire protocol (20261115-md R1). Older handlers still
 * throw `code: message` strings; new commands throw through `protocolError`, which keeps that
 * wire format (the IPC layer only carries the message) and also sets `code` on the Error.
 */
export type ProtocolErrorCode =
  | 'not_implemented'
  | 'invalid_payload'
  | 'session_not_loaded'
  | 'workspace_not_authorized'
  | 'model_not_found'
  | 'model_auth_missing'
  | 'extension_load_failed'
  | 'export_path_not_authorized'
  // 20261116-pii W1.1–W1.3
  | 'session_busy'
  | 'entry_not_found'
  | 'permission_denied'
  | 'bash_running';

export interface ProtocolError {
  code: ProtocolErrorCode;
  message?: string;
  details?: unknown;
}

/** An Error whose message is `code: message` (the wire format) and which carries `code` / `details`. */
export function protocolError(code: ProtocolErrorCode, message?: string, details?: unknown): Error & ProtocolError {
  const error = new Error(message ? `${code}: ${message}` : code) as Error & ProtocolError;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}
