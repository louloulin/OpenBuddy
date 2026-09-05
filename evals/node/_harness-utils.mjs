// Internal harness utilities shared by evals/node runners and scripts/electron
// closed-loop launcher. NOT a public API; underscore prefix discourages imports
// from outside this directory.
//
// Reused patterns:
//   - timeout + heartbeat: scripts/electron/launch-real-evals-echo.mjs:288-297
//   - dataset hash shape: evals/node/evaluate_email_ai_quality.mjs:169

import { createHash } from "node:crypto";

/**
 * Race a promise against a timeout. The losing side is detached (not aborted);
 * the underlying work continues to completion but its result is discarded.
 */
export function withTimeout(promise, ms, label = "withTimeout") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Retry an async function with exponential backoff + jitter. Only retries on
 * thrown errors whose message matches `retryOn` (regex) when provided;
 * otherwise every error retries. Stops after `attempts`.
 */
export async function withRetry(fn, {
  attempts = 2,
  baseDelayMs = 500,
  jitterRatio = 0.25,
  retryOn,
  onRetry,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const message = String(error?.message ?? error);
      if (retryOn && !retryOn.test(message)) throw error;
      if (attempt >= attempts) break;
      const base = baseDelayMs * 2 ** (attempt - 1);
      const jitter = base * jitterRatio * (Math.random() * 2 - 1);
      const delay = Math.max(0, Math.round(base + jitter));
      if (typeof onRetry === "function") onRetry({ attempt, attempts, delay, error });
      console.error(`[retry] attempt ${attempt}/${attempts} failed (${message}); sleeping ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Heartbeat printer for a long-running promise. Returns the original result on
 * completion, or rejects with the timeout error if it elapses.
 */
export function withHeartbeat(promise, { ms = 10_000, label = "heartbeat", onTick } = {}) {
  const startedAt = Date.now();
  const interval = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const detail = typeof onTick === "function" ? onTick(elapsed) : "";
    console.error(`[heartbeat] ${label} elapsedMs=${elapsed}${detail ? ` ${detail}` : ""}`);
  }, ms);
  return promise.finally(() => clearInterval(interval));
}

/**
 * Deterministic SHA-256 hash of a JSON-serializable value. Object key order is
 * normalized so semantically identical inputs produce identical hashes.
 */
export function sha256Canonical(value) {
  const canonical = JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce((acc, k) => {
        acc[k] = v[k];
        return acc;
      }, {});
    }
    return v;
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * Dataset version hash: stable across formatting differences in the source
 * JSONL. Sorts by `id` field when present so reorders do not bump the hash.
 */
export function computeDatasetHash(items) {
  const normalized = (Array.isArray(items) ? items : []).map((item) => {
    if (item && typeof item === "object" && "id" in item) {
      return { id: item.id, ...stripVolatileFields(item) };
    }
    return stripVolatileFields(item);
  }).sort((a, b) => {
    const ai = String(a?.id ?? "");
    const bi = String(b?.id ?? "");
    return ai.localeCompare(bi);
  });
  return sha256Canonical(normalized);
}

/**
 * SHA-256 of a file's contents. Used for `scriptHash` so runners can detect
 * runner script drift independent from dataset changes.
 */
export function sha256OfText(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 16);
}

/**
 * Fingerprint for a sequence of session events. Sorts by sequence number so
 * unordered delivery does not affect the fingerprint.
 */
export function eventsFingerprint(events) {
  if (!Array.isArray(events)) return null;
  const sorted = events
    .filter((event) => event && Number.isInteger(event.sequence))
    .map((event) => ({
      sequence: event.sequence,
      type: event.type,
      sessionId: event.sessionId,
    }))
    .sort((a, b) => a.sequence - b.sequence);
  return sha256Canonical(sorted);
}

/**
 * Strip volatile fields that legitimately differ run-to-run (timestamps,
 * sequence numbers). Used before hashing so dataset edits change the hash.
 */
function stripVolatileFields(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "createdAt" || k === "updatedAt" || k === "sequence") continue;
    if (k === "timestamp" || k === "startedAt" || k === "finishedAt") continue;
    out[k] = v;
  }
  return out;
}

/**
 * Normalize an event payload to the human-readable text fields only. Strips
 * metadata (sequence, sessionId, model, provider keys) so substring match
 * reflects semantic content rather than envelope noise.
 */
export function normalizeEventPayload(event) {
  if (!event || typeof event !== "object") return "";
  const payload = event.payload ?? event;
  if (!payload || typeof payload !== "object") return String(payload ?? "");
  switch (event.type) {
    case "assistant_message_chunk":
    case "assistant/update": {
      const content = payload.content ?? payload.message?.content ?? [];
      if (Array.isArray(content)) {
        return content
          .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
          .filter(Boolean)
          .join(" ");
      }
      return typeof content === "string" ? content : JSON.stringify(content);
    }
    case "tool/start":
    case "tool_call_update":
    case "tool/end": {
      const title = payload.title ?? payload.toolName ?? "";
      const status = payload.status ?? "";
      const args = payload.args ?? payload.input ?? {};
      const result = payload.result ?? payload.output ?? "";
      return `${title} ${status} ${JSON.stringify(args)} ${typeof result === "string" ? result : JSON.stringify(result)}`;
    }
    default:
      return JSON.stringify(payload);
  }
}

/**
 * Lowercase, collapse whitespace, and strip punctuation that frequently
 * shifts between runs (trailing commas, smart quotes).
 */
export function normalizeTarget(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim();
}