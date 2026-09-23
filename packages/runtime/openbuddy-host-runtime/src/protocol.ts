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

import type { Readable } from "node:stream";
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
 * Anything that can yield NDJSON bytes — Node `Readable` (used by the live
 * host-core child process) or a Web `ReadableStream` of bytes (used by the
 * protocol unit tests). We type this as a structural subset on purpose:
 * the Node and DOM `ReadableStream` instantiations disagree on the inner
 * `ArrayBufferLike` parameter, and pinning either one would reject the
 * other at the type level. `any` is acceptable here because the function
 * only calls `getReader().read()` and treats the result opaquely.
 */
export type NdjsonSource = Readable | { getReader(): { read(): Promise<{ value?: Uint8Array; done: boolean }>; releaseLock?(): void } };

/** True if `stream` exposes the Web Streams API (`getReader`). */
function isWebStream(stream: NdjsonSource): stream is { getReader(): { read(): Promise<{ value?: Uint8Array; done: boolean }>; releaseLock?(): void } } {
  return typeof (stream as { getReader?: unknown }).getReader === "function";
}

/**
 * Yield successive LF-delimited frames from a Node `Readable` or Web
 * `ReadableStream<Uint8Array>`. UTF-8 chunk boundaries are preserved;
 * U+2028 / U+2029 are *not* treated as frame delimiters.
 *
 * The Rust host-core writes complete NDJSON lines terminated by `\n`; we
 * accept CRLF as well. A trailing non-newline-terminated frame at EOF is
 * still yielded (PI-Desktop spec §2 EOF acceptance).
 */
export async function* readNdjsonFrames(stream: NdjsonSource): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: false });

  // Web ReadableStream path (used by unit tests that construct a fresh
  // stream in-memory). Keeps the protocol test independent of Node's
  // Readable so the same helper serves both transports.
  if (isWebStream(stream)) {
    const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    let pending = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) {
          let frame = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (frame.endsWith("\r")) frame = frame.slice(0, -1);
          if (frame.length > 0) yield frame;
        }
      }
      pending += decoder.decode();
      if (pending.length > 0) yield pending;
    } finally {
      reader.releaseLock();
    }
    return;
  }

  // Node Readable path (used by the live host-core child process).
  const queue: string[] = [];
  let waiter: (() => void) | null = null;
  let ended = false;
  let error: Error | null = null;

  const onData = (chunk: Buffer | string): void => {
    queue.push(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
    if (waiter) {
      const w = waiter;
      waiter = null;
      w();
    }
  };
  const onEnd = (): void => {
    ended = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w();
    }
  };
  const onError = (err: Error): void => {
    error = err;
    ended = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w();
    }
  };

  stream.on("data", onData);
  stream.on("end", onEnd);
  stream.on("error", onError);
  stream.on("close", onEnd);

  try {
    let pending = "";
    while (true) {
      while (queue.length > 0) {
        pending += queue.shift() as string;
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) {
          let frame = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (frame.endsWith("\r")) frame = frame.slice(0, -1);
          if (frame.length > 0) yield frame;
        }
      }
      if (error) throw error;
      if (ended) {
        pending += decoder.decode();
        if (pending.length > 0) yield pending;
        return;
      }
      await new Promise<void>((resolve) => {
        waiter = resolve;
      });
    }
  } finally {
    stream.off("data", onData);
    stream.off("end", onEnd);
    stream.off("error", onError);
    stream.off("close", onEnd);
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
