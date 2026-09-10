/**
 * Keep event payloads safe for IPC, replay buffers and renderer memory.
 *
 * Event payloads are untrusted runtime data: tool output can contain very large
 * strings, binary values, cyclic objects or provider-specific class instances.
 * This helper makes a detached JSON-safe projection with a hard UTF-8 byte
 * budget. It is deliberately transport-agnostic so Main, preload adapters and
 * tests use the same limit semantics.
 */

export const DEFAULT_EVENT_PAYLOAD_MAX_BYTES = 64 * 1024;
const TRUNCATION_MARKER = "[truncated]";
const TRUNCATED_KEY = "__openbuddy_truncated__";

export interface BoundedEventPayloadOptions {
  readonly maxBytes?: number;
  readonly maxDepth?: number;
  readonly maxStringBytes?: number;
  readonly maxCollectionItems?: number;
}

export interface BoundedEventPayloadResult {
  readonly value: unknown;
  readonly bytes: number;
  readonly truncated: boolean;
}

interface FitResult {
  value: unknown;
  truncated: boolean;
}

const encoder = new TextEncoder();

function jsonBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 0 : encoder.encode(serialized).byteLength;
  } catch {
    return encoder.encode(JSON.stringify(String(value))).byteLength;
  }
}

function validLimit(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`event payload limit must be an integer >= ${minimum}`);
  }
  return value;
}

function truncateString(value: string, maxBytes: number): { value: string; truncated: boolean } {
  if (jsonBytes(value) <= maxBytes) return { value, truncated: false };
  const units = Array.from(value);
  let low = 0;
  let high = units.length;
  let best = "";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${units.slice(0, middle).join("")}${TRUNCATION_MARKER}`;
    if (jsonBytes(candidate) <= maxBytes) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (best) return { value: best, truncated: true };
  return { value: "", truncated: true };
}

function markerForBinary(value: ArrayBuffer | ArrayBufferView, maxBytes: number): FitResult {
  const marker = `[binary ${value.byteLength} bytes omitted]`;
  const fitted = truncateString(marker, maxBytes);
  return { value: fitted.value, truncated: true };
}

function fitValue(
  value: unknown,
  budget: number,
  depth: number,
  options: Required<
    Pick<BoundedEventPayloadOptions, "maxDepth" | "maxStringBytes" | "maxCollectionItems">
  >,
  seen: Set<object>,
): FitResult {
  if (value === undefined) return { value: undefined, truncated: false };
  if (budget < 4) return { value: null, truncated: true };
  if (value === null || typeof value === "boolean") {
    return { value, truncated: jsonBytes(value) > budget };
  }
  if (typeof value === "number") {
    if (Number.isFinite(value) && jsonBytes(value) <= budget) return { value, truncated: false };
    return { value: null, truncated: true };
  }
  if (typeof value === "string") {
    const fitted = truncateString(value, Math.min(budget, options.maxStringBytes));
    return { value: fitted.value, truncated: fitted.truncated };
  }
  if (typeof value === "bigint") {
    const fitted = truncateString(`${value}n`, Math.min(budget, options.maxStringBytes));
    return { value: fitted.value, truncated: true };
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return { value: TRUNCATION_MARKER, truncated: true };
  }
  if (typeof value !== "object") return { value: TRUNCATION_MARKER, truncated: true };

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)
    return markerForBinary(value, budget);
  if (seen.has(value)) return { value: TRUNCATION_MARKER, truncated: true };
  if (depth >= options.maxDepth) return { value: TRUNCATION_MARKER, truncated: true };

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      let truncated = false;
      const items = value.slice(0, options.maxCollectionItems);
      if (items.length !== value.length) truncated = true;
      for (const item of items) {
        const remaining = budget - jsonBytes(output) - 1;
        if (remaining < 4) {
          truncated = true;
          break;
        }
        const child = fitValue(item, remaining, depth + 1, options, seen);
        const candidate = [...output, child.value];
        if (jsonBytes(candidate) > budget) {
          truncated = true;
          break;
        }
        output.push(child.value);
        truncated ||= child.truncated;
      }
      if (truncated) {
        const candidate = [...output, TRUNCATION_MARKER];
        if (jsonBytes(candidate) <= budget) output.push(TRUNCATION_MARKER);
      }
      return { value: output, truncated };
    }

    const output: Record<string, unknown> = {};
    let truncated = false;
    let keys: string[];
    try {
      keys = Object.keys(value);
    } catch {
      return { value: TRUNCATION_MARKER, truncated: true };
    }
    if (keys.length > options.maxCollectionItems) {
      keys = keys.slice(0, options.maxCollectionItems);
      truncated = true;
    }
    for (const key of keys) {
      let item: unknown;
      try {
        item = (value as Record<string, unknown>)[key];
      } catch {
        truncated = true;
        continue;
      }
      const safeKey = truncateString(
        key,
        Math.min(options.maxStringBytes, Math.max(16, budget)),
      ).value;
      const remaining = budget - jsonBytes(output) - jsonBytes(safeKey) - 2;
      if (remaining < 4) {
        truncated = true;
        break;
      }
      const child = fitValue(item, remaining, depth + 1, options, seen);
      const candidate = { ...output, [safeKey]: child.value };
      if (jsonBytes(candidate) > budget) {
        truncated = true;
        break;
      }
      output[safeKey] = child.value;
      truncated ||= child.truncated;
    }
    if (truncated && !(TRUNCATED_KEY in output)) {
      const candidate = { ...output, [TRUNCATED_KEY]: true };
      if (jsonBytes(candidate) <= budget) output[TRUNCATED_KEY] = true;
    }
    return { value: output, truncated };
  } finally {
    seen.delete(value);
  }
}

/** Return a detached JSON-safe payload that fits within `maxBytes`. */
export function boundEventPayload(
  value: unknown,
  options: BoundedEventPayloadOptions = {},
): BoundedEventPayloadResult {
  const maxBytes = validLimit(options.maxBytes, DEFAULT_EVENT_PAYLOAD_MAX_BYTES, 16);
  const resolved = {
    maxDepth: validLimit(options.maxDepth, 8, 1),
    maxStringBytes: validLimit(options.maxStringBytes, 16 * 1024, 16),
    maxCollectionItems: validLimit(options.maxCollectionItems, 256, 1),
  } as const;
  if (value === undefined) return { value: undefined, bytes: 0, truncated: false };
  const fitted = fitValue(value, maxBytes, 0, resolved, new Set());
  const bytes = jsonBytes(fitted.value);
  if (bytes <= maxBytes)
    return {
      value: fitted.value,
      bytes,
      truncated: fitted.truncated || jsonBytes(value) > maxBytes,
    };
  return { value: null, bytes: 4, truncated: true };
}
