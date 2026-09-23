/**
 * @openbuddy/shared-error-codes — JSON-RPC error codes shared between the
 * OpenBuddy TypeScript surface and the Rust host-core.
 *
 * Mirror of `crates/openbuddy-error-codes/src/lib.rs`. Adding a new code in
 * one place requires the same change in the other, or the host-core's
 * `app.handshake` will surface a mismatch.
 *
 * PI-Desktop reference: `docs/spec/03-runtime/08-error-codes.md`.
 */

export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,

  HostUnavailable: 1001,
  HostOverloaded: 1002,
  SecretNotFound: 1003,
  SecretBackendUnavailable: 1004,
  PermissionDenied: 1005,
  PermissionTimeout: 1006,
  PermissionInvalid: 1007,
  PathOutsideWorkspace: 1008,
  WorkspaceIgnoreError: 1009,
  AuditAppendFailed: 1010,
  AuditExhausted: 1011,
  SessionSearchFailed: 1012,
  DbMigrationRequired: 1013,
  HandshakeFailed: 1014,
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const StableErrorCodeNames: Record<number, string> = {
  [-32700]: "PARSE_ERROR",
  [-32600]: "INVALID_REQUEST",
  [-32601]: "METHOD_NOT_FOUND",
  [-32602]: "INVALID_PARAMS",
  [-32603]: "INTERNAL_ERROR",

  [1001]: "HOST_UNAVAILABLE",
  [1002]: "HOST_OVERLOADED",
  [1003]: "SECRET_NOT_FOUND",
  [1004]: "SECRET_BACKEND_UNAVAILABLE",
  [1005]: "PERMISSION_DENIED",
  [1006]: "PERMISSION_TIMEOUT",
  [1007]: "PERMISSION_INVALID",
  [1008]: "PATH_OUTSIDE_WORKSPACE",
  [1009]: "WORKSPACE_IGNORE_ERROR",
  [1010]: "AUDIT_APPEND_FAILED",
  [1011]: "AUDIT_EXHAUSTED",
  [1012]: "SESSION_SEARCH_FAILED",
  [1013]: "DB_MIGRATION_REQUIRED",
  [1014]: "HANDSHAKE_FAILED",
};

/**
 * Wire-protocol version negotiated by `app.handshake`. Bumped whenever the
 * JSON-RPC method names, params, or results change in a backward-incompatible
 * way. The Rust host-core refuses to speak to a client whose
 * `protocolVersion` does not match.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Default JSON-RPC call timeout in milliseconds. Matches the host-core's
 * `DEFAULT_RPC_TIMEOUT_MS` constant and PI-Desktop's `DEFAULT_RPC_TIMEOUT_MS`.
 */
export const DEFAULT_RPC_TIMEOUT_MS = 130_000;

/**
 * Backoff schedule for `HOST_OVERLOADED` retries. Matches PI-Desktop's
 * `HOST_OVERLOAD_RETRY_DELAYS_MS`.
 */
export const HOST_OVERLOAD_RETRY_DELAYS_MS = [50, 100, 200, 400] as const;

/**
 * Maximum length of an NDJSON line that the host-core will accept before
 * returning an oversize-frame error.
 */
export const MAX_HOST_STDIN_LINE_BYTES = 1_048_576;

/**
 * Strip proxy environment variables from a child-process env so the
 * host-core never sees proxy credentials. Mirrors PI-Desktop's
 * `stripProxyEnv`.
 */
export function stripProxyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    // Strip any variable whose name ends in `_PROXY` (case-insensitive).
    // This covers HTTP_PROXY/HTTPS_PROXY/NO_PROXY/ALL_PROXY and their
    // lowercase siblings, as well as any user-defined `*_proxy` variable
    // that might leak proxy credentials into the host-core subprocess.
    if (/proxy$/i.test(k)) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

export class RpcCallError extends Error {
  readonly code: number;
  readonly errorCode: string;
  readonly data?: unknown;

  constructor(message: string, code: number, errorCode: string, data?: unknown) {
    super(message);
    this.name = "RpcCallError";
    this.code = code;
    this.errorCode = errorCode;
    this.data = data;
  }

  /** True for `HOST_OVERLOADED` responses, which the caller may retry. */
  isHostOverloaded(): boolean {
    return this.code === ErrorCodes.HostOverloaded || this.errorCode === "HOST_OVERLOADED";
  }
}
