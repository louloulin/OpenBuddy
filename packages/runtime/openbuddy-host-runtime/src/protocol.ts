/**
 * JSON-RPC 2.0 wire types and NDJSON framing helpers for talking to the
 * Rust host-core. Mirrors `crates/openbuddy-host-core/src/rpc/mod.rs`.
 *
 * Frame rules (PI-Desktop §06-host-rpc-protocol.md §2):
 * - One JSON object per LF-delimited line (NDJSON); CRLF accepted.
 * - U+2028 / U+2029 inside string bodies are payload, never frame delimiters.
 * - UTF-8 encoding; final unterminated frame at EOF is accepted.
 * - Lines exceeding `MAX_HOST_STDIN_LINE_BYTES` are rejected with
 *   `INVALID_PARAMS` before the JSON parser runs.
 */

import { MAX_HOST_STDIN_LINE_BYTES } from "@openbuddy/shared-error-codes";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: { errorCode?: string; details?: unknown };
  };
}

export interface JsonRpcSuccessResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result: T;
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccessResponse<T> | JsonRpcErrorResponse;

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: unknown;
}

/**
 * Yield successive LF-delimited frames from a `ReadableStream<Uint8Array>`.
 * UTF-8 chunk boundaries are preserved; U+2028 / U+2029 are *not* treated
 * as frame delimiters (PI-Desktop spec §2).
 */
export async function* readNdjsonFrames(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const reader = stream.getReader();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newline: number;
      // eslint-disable-next-line no-cond-assign
      while ((newline = pending.indexOf("\n")) >= 0) {
        let frame = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        // Strip a trailing CR if present (CRLF tolerated).
        if (frame.endsWith("\r")) frame = frame.slice(0, -1);
        if (frame.length > 0) yield frame;
      }
    }
    // Flush any remaining bytes as a final frame (EOF acceptance).
    pending += decoder.decode();
    if (pending.length > 0) yield pending;
  } finally {
    reader.releaseLock();
  }
}

/** Strip proxy env vars so the child never sees proxy credentials. */
export { stripProxyEnv } from "@openbuddy/shared-error-codes";

/** Hard cap on a single NDJSON frame. */
export { MAX_HOST_STDIN_LINE_BYTES };

/**
 * Format a request envelope as a single NDJSON line.
 */
export function formatRequest(request: JsonRpcRequest): string {
  return `${JSON.stringify(request)}\n`;
}
