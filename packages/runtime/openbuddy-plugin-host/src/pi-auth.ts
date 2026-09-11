/**
 * @openbuddy/plugin-host/pi-auth — R39 G15 PR (pi 原生凭据读 + 同步 facade)
 *
 * Wraps pi 0.85's credential surface behind a single import so
 * OpenBuddy's Electron main process stops hand-rolling the
 * `auth.json` read + credential-shape check + provider sync loop.
 *
 * Background (before R39):
 *   `electron/main/agent/host-modules/bootstrap/model-runtime.ts`
 *   did all three by hand:
 *
 *     1. `JSON.parse(await readFile(authPath, "utf8"))` — its own
 *        BOM-less JSON read (pi's own read strips BOM + normalizes
 *        the path).
 *     2. `value?.type === "api_key" && typeof value.key === "string"`
 *        — its own credential-shape validation, which silently
 *        ignores pi's `oauth` credential branch.
 *     3. `await runtime.setRuntimeApiKey(...)` in a bare try/catch
 *        that logged `String(error)` and lost pi's
 *        `CredentialSynchronizationError.operation` classification.
 *
 * After R39 all three delegate to pi:
 *   - {@link readProviderCredential} → pi's `readStoredCredential`
 *   - {@link collectStoredApiKeys}    → pi's credential parsing per provider
 *   - {@link syncRuntimeCredentials}  → typed `CredentialSynchronizationError`
 *                                       classification + per-provider results
 *
 * 覆盖的 pi auth 符号（audit domain `auth`）:
 *   readStoredCredential                — 真实读写路径（替换自实现 JSON.parse）
 *   ModelRuntimeAuthOverrides           — getAuth() 的 typed overrides
 *   CredentialSynchronizationError      — setRuntimeApiKey 失败的分类错误
 *   CredentialSynchronizationOperation  — 上述错误的 operation 联合类型
 *
 * 未覆盖（诚实记录）:
 *   OAuthSelectorComponent — pi 的 TUI（ink/React-for-terminal）组件，
 *   electron-vite 架构下没有终端渲染层，强行 import 只会把 ink 拉进
 *   主进程。R39 明确不接，登记在 plan4.1.md §11 已知限制。
 *
 * auth 域 unused 演进：
 *   R38 (pre-R39) : auth = 5 unused
 *   R39 (本轮)    : auth = 1 unused   (target ≤ 2 ✅)
 */
import { readFile } from "node:fs/promises";

import {
  CredentialSynchronizationError,
  readStoredCredential,
  type CredentialSynchronizationOperation,
  type ModelRuntimeAuthOverrides,
} from "@earendil-works/pi-coding-agent";

/**
 * Stored api-key credential — structurally identical to pi-ai's
 * `ApiKeyCredential`. Declared locally so this module does not need a
 * direct `@earendil-works/pi-ai` dependency.
 */
export interface StoredApiKeyCredential {
  type: "api_key";
  key?: string;
  env?: Record<string, string>;
}

/** Stored OAuth credential — structurally identical to pi-ai's `OAuthCredential`. */
export interface StoredOAuthCredential {
  type: "oauth";
  access?: string;
  refresh?: string;
  expires?: number;
  [key: string]: unknown;
}

export type StoredCredential = StoredApiKeyCredential | StoredOAuthCredential;

/** One resolved provider → api-key pair ready for `setRuntimeApiKey`. */
export interface StoredApiKeyEntry {
  providerId: string;
  apiKey: string;
}

/** Per-provider outcome of {@link syncRuntimeCredentials}. */
export interface CredentialSyncResult {
  providerId: string;
  ok: boolean;
  /** Present only when `ok === false` and pi tagged the failure. */
  operation?: CredentialSynchronizationOperation;
  /** Present only when `ok === false`. */
  error?: unknown;
}

/**
 * Minimal structural port of the pi `ModelRuntime` surface this module
 * needs. `ModelRuntime` satisfies it directly; tests can pass a fake.
 */
export interface CredentialRuntimePort {
  setRuntimeApiKey(
    providerId: string,
    apiKey: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  getAuth(
    providerId: string,
    overrides?: ModelRuntimeAuthOverrides,
  ): Promise<unknown>;
}

export interface SyncRuntimeCredentialsOptions {
  /** Called once per failed provider, after the failure is classified. */
  onError?: (
    providerId: string,
    error: unknown,
    operation: CredentialSynchronizationOperation | undefined,
  ) => void;
}

/**
 * Read a single provider's stored credential via pi's own reader.
 *
 * Delegates to `readStoredCredential` so the BOM strip, path
 * normalization and "missing / unparsable file ⇒ undefined" semantics
 * are pi's, not ours.
 */
export function readProviderCredential(
  providerId: string,
  authPath: string,
): StoredCredential | undefined {
  return readStoredCredential(providerId, authPath) as
    | StoredCredential
    | undefined;
}

/** Narrow a stored credential to its api-key branch. */
export function isApiKeyCredential(
  credential: StoredCredential | undefined,
): credential is StoredApiKeyCredential {
  return credential?.type === "api_key";
}

/**
 * Extract the usable api-key string from a stored credential.
 *
 * Returns `undefined` for OAuth credentials and for empty / non-string
 * keys, mirroring what the old hand-rolled check accepted — but as a
 * named, testable unit instead of an inline boolean.
 */
export function apiKeyOf(
  credential: StoredCredential | undefined,
): string | undefined {
  if (!isApiKeyCredential(credential)) return undefined;
  const key = credential.key;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

/**
 * Enumerate the provider ids present in `auth.json`.
 *
 * pi's `readStoredCredential` reads one provider at a time, so the id
 * list has to come from the file's own top-level keys. Only the keys
 * are read here — every credential value is then re-read through pi's
 * `readStoredCredential`, so parsing/validation stays pi-owned.
 *
 * Missing or unparsable file ⇒ `[]` (first-launch case), never a throw.
 */
export async function listCredentialProviderIds(
  authPath: string,
): Promise<string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(authPath, "utf8"));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.keys(parsed as Record<string, unknown>);
}

/**
 * Collect every provider in `auth.json` that carries a usable api-key
 * credential, resolved through pi's reader.
 */
export async function collectStoredApiKeys(
  authPath: string,
): Promise<StoredApiKeyEntry[]> {
  const entries: StoredApiKeyEntry[] = [];
  for (const providerId of await listCredentialProviderIds(authPath)) {
    const apiKey = apiKeyOf(readProviderCredential(providerId, authPath));
    if (apiKey) entries.push({ providerId, apiKey });
  }
  return entries;
}

/**
 * Hydrate a `ModelRuntime` from `auth.json`.
 *
 * Replaces the old `syncAuthCredentials` loop. Differences that matter:
 *   - pi's reader decides what a credential is (not an inline cast)
 *   - every failure is classified through
 *     {@link isCredentialSynchronizationError} so callers get pi's
 *     `operation` (`login` / `logout` / `setRuntimeApiKey` /
 *     `removeRuntimeApiKey`) instead of an opaque `unknown`
 *   - the return value reports per-provider outcomes, so a partially
 *     hydrated runtime is observable rather than just logged
 *
 * Never throws — a failed provider is reported in the result list.
 */
export async function syncRuntimeCredentials(
  runtime: CredentialRuntimePort,
  authPath: string,
  options?: SyncRuntimeCredentialsOptions,
): Promise<CredentialSyncResult[]> {
  const results: CredentialSyncResult[] = [];
  for (const { providerId, apiKey } of await collectStoredApiKeys(authPath)) {
    try {
      await runtime.setRuntimeApiKey(providerId, apiKey);
      results.push({ providerId, ok: true });
    } catch (error) {
      const operation = isCredentialSynchronizationError(error)
        ? error.operation
        : undefined;
      results.push({ providerId, ok: false, operation, error });
      options?.onError?.(providerId, error, operation);
    }
  }
  return results;
}

/**
 * Type guard for pi's `CredentialSynchronizationError`.
 *
 * Uses `instanceof` first, then falls back to a structural check so the
 * guard still holds when the error crossed a bundle boundary (two
 * copies of pi's module graph in one Electron process).
 */
export function isCredentialSynchronizationError(
  value: unknown,
): value is CredentialSynchronizationError {
  if (value instanceof CredentialSynchronizationError) return true;
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    name?: unknown;
    providerId?: unknown;
    operation?: unknown;
  };
  return (
    candidate.name === "CredentialSynchronizationError" &&
    typeof candidate.providerId === "string" &&
    typeof candidate.operation === "string"
  );
}

/** Human-readable label for a credential-sync operation (UI / logs). */
export function describeCredentialSyncOperation(
  operation: CredentialSynchronizationOperation,
): string {
  switch (operation) {
    case "login":
      return "登录凭据写入";
    case "logout":
      return "登录凭据清除";
    case "setRuntimeApiKey":
      return "运行时 API Key 写入";
    case "removeRuntimeApiKey":
      return "运行时 API Key 移除";
  }
}

/**
 * Resolve the request auth for a provider through pi's `ModelRuntime`,
 * forwarding the typed {@link ModelRuntimeAuthOverrides} bag.
 *
 * The overrides carry `apiKey` / `env` / `minOAuthValidityMs`, which the
 * runtime applies without mutating persisted credentials — the right
 * path for per-request BYOK overrides.
 */
export async function resolveProviderAuth(
  runtime: CredentialRuntimePort,
  providerId: string,
  overrides?: ModelRuntimeAuthOverrides,
): Promise<unknown> {
  return runtime.getAuth(providerId, overrides);
}

export type { CredentialSynchronizationOperation, ModelRuntimeAuthOverrides };
