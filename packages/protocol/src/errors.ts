/**
 * Machine-readable error codes for the wire protocol (20261115-md R1). Not wired in yet:
 * handlers still throw `code: message` strings; the renderer will map `code` to text later.
 */
export type ProtocolErrorCode =
  | 'not_implemented'
  | 'invalid_payload'
  | 'session_not_loaded'
  | 'workspace_not_authorized'
  | 'model_not_found'
  | 'model_auth_missing'
  | 'extension_load_failed'
  | 'export_path_not_authorized';

export interface ProtocolError {
  code: ProtocolErrorCode;
  message?: string;
  details?: unknown;
}
