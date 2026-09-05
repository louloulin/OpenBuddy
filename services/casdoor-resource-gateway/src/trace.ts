// W3C Trace Context helpers — https://www.w3.org/TR/trace-context/
//
// Parses and validates the `traceparent` header so downstream services can
// preserve the trace. When the header is missing or malformed, a fresh
// traceparent is minted locally. The helper never throws; callers receive a
// sanitized context that is safe to log and to forward.
//
// AsyncLocalStorage carries the current trace into every audit() / SIEM /
// downstream call without forcing callers to pass traceId through every
// argument list.

import { AsyncLocalStorage } from "node:async_hooks";

const TRACEPARENT_PATTERN = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const HEX_BYTE = /^[0-9a-f]{2}$/;
const FLAG_SAMPLED = "01";
const FLAG_NONE = "00";

const storage = new AsyncLocalStorage<TraceContext>();

export interface TraceContext {
  version: string;
  traceId: string;
  spanId: string;
  flags: string;
  sampled: boolean;
  remote: boolean;
  raw: string;
}

export function parseTraceparent(value: string | string[] | undefined): TraceContext | null {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const match = TRACEPARENT_PATTERN.exec(raw.trim());
  if (!match) return null;
  const version = match[1];
  const traceId = match[2];
  const spanId = match[3];
  const flags = match[4];
  if (traceId === "0".repeat(32)) return null;
  if (spanId === "0".repeat(16)) return null;
  if (!HEX_BYTE.test(flags)) return null;
  return {
    version,
    traceId,
    spanId,
    flags,
    sampled: (Number.parseInt(flags, 16) & 0x01) === 0x01,
    remote: true,
    raw: `${version}-${traceId}-${spanId}-${flags}`,
  };
}

export function mintTraceContext(forceSampled = false): TraceContext {
  const traceId = randomHex(32);
  const spanId = randomHex(16);
  const flags = forceSampled ? FLAG_SAMPLED : FLAG_NONE;
  return {
    version: "00",
    traceId,
    spanId,
    flags,
    sampled: forceSampled,
    remote: false,
    raw: `00-${traceId}-${spanId}-${flags}`,
  };
}

export function deriveTraceContext(headers: Record<string, string | string[] | undefined>, forceSampled = false): TraceContext {
  const parsed = parseTraceparent(headers && headers["traceparent"]);
  if (parsed) return parsed;
  return mintTraceContext(forceSampled);
}

export function currentTraceContext() {
  return storage.getStore() ?? null;
}

export function currentTraceId() {
  const context = storage.getStore();
  return context ? context.traceId : undefined;
}

export function withTrace<T>(trace: TraceContext, callback: () => T): T {
  return storage.run(trace, callback);
}

export function withChildSpan(context: TraceContext, spanId?: string, sampled?: boolean): TraceContext {
  const forceSampled = typeof sampled === "boolean" ? sampled : context.sampled;
  const targetSpan = spanId || randomHex(16);
  const flags = forceSampled ? FLAG_SAMPLED : FLAG_NONE;
  return {
    version: context.version,
    traceId: context.traceId,
    spanId: targetSpan,
    flags,
    sampled: forceSampled,
    remote: false,
    raw: `${context.version}-${context.traceId}-${targetSpan}-${flags}`,
  };
}

function randomHex(length: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}
