/**
 * @openbuddy/storage/sqlite/typed-settings — coercion helpers for
 * pi `RetrySettings` / `ImageSettings` typed accessors.
 *
 * Extracted from `settings-store.ts` in G2 PR 4 (Round 37) to keep
 * `settings-store.ts` ≤ 50 LOC per GA gate. The helpers are pure
 * data projections — no I/O, no pi dependency — so callers can unit
 * test them directly.
 *
 * Pi already runs its migration pipeline (e.g. legacy
 * `retry.maxDelayMs` → `retry.provider.maxRetryDelayMs`) on every
 * `set()`, so by the time we read back the value only canonical keys
 * survive; coerce just filters to those.
 */
import type { ImageSettings, RetrySettings } from "@earendil-works/pi-coding-agent";

export function coerceRetrySettings(value: object): RetrySettings {
  const out: RetrySettings = {};
  const v = value as Record<string, unknown>;
  if (typeof v.enabled === "boolean") out.enabled = v.enabled;
  if (typeof v.maxRetries === "number") out.maxRetries = v.maxRetries;
  if (typeof v.baseDelayMs === "number") out.baseDelayMs = v.baseDelayMs;
  const provider = v.provider;
  if (provider && typeof provider === "object" && !Array.isArray(provider)) {
    const p = provider as Record<string, unknown>;
    const providerOut: NonNullable<RetrySettings["provider"]> = {};
    if (typeof p.timeoutMs === "number") providerOut.timeoutMs = p.timeoutMs;
    if (typeof p.maxRetries === "number") providerOut.maxRetries = p.maxRetries;
    if (typeof p.maxRetryDelayMs === "number") providerOut.maxRetryDelayMs = p.maxRetryDelayMs;
    if (Object.keys(providerOut).length > 0) out.provider = providerOut;
  }
  return out;
}

export function coerceImageSettings(value: object): ImageSettings {
  const out: ImageSettings = {};
  const v = value as Record<string, unknown>;
  if (typeof v.autoResize === "boolean") out.autoResize = v.autoResize;
  if (typeof v.blockImages === "boolean") out.blockImages = v.blockImages;
  return out;
}