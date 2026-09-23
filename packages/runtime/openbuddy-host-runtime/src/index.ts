/**
 * @openbuddy/host-runtime — TypeScript surface for the Rust host-core sidecar.
 *
 * Phase 0 entry points:
 *  - `HostProcess` (spawn / call / notify / dispose)
 *  - `resolveHostBinary` (4-candidate path resolution)
 *  - `readNdjsonFrames` + protocol types
 *  - Re-exports of shared error codes
 *
 * Phase 1 will add typed wrappers per capability (secrets / permissions /
 * session_search / workspace / audit) — but those belong at the
 * capability consumer, not here.
 */

export { HostProcess } from "./host-process.js";
export type {
  HostNotificationHandler,
  ProcessExitHandler,
  StderrHandler,
  HostProcessOptions,
  HandshakeResult,
} from "./host-process.js";

export { resolveHostBinary } from "./resolve-binary.js";
export {
  formatRequest,
  readNdjsonFrames,
  type JsonRpcRequest,
  type JsonRpcNotification,
  type JsonRpcResponse,
  type JsonRpcSuccessResponse,
  type JsonRpcErrorResponse,
} from "./protocol.js";

export {
  ErrorCodes,
  PROTOCOL_VERSION,
  DEFAULT_RPC_TIMEOUT_MS,
  HOST_OVERLOAD_RETRY_DELAYS_MS,
  MAX_HOST_STDIN_LINE_BYTES,
  RpcCallError,
  StableErrorCodeNames,
  stripProxyEnv,
} from "@openbuddy/shared-error-codes";
