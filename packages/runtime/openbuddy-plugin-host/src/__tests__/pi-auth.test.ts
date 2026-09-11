/**
 * @openbuddy/plugin-host — pi-auth facade tests (R39 G15 PR).
 *
 * Verifies the pi-native credential read + sync path that replaced
 * `bootstrap/model-runtime.ts`'s hand-rolled `JSON.parse` loop:
 *   1. readProviderCredential delegates to pi's readStoredCredential
 *      (incl. its "missing file ⇒ undefined" semantics).
 *   2. apiKeyOf accepts api_key credentials and rejects oauth / empty.
 *   3. collectStoredApiKeys enumerates providers from auth.json.
 *   4. syncRuntimeCredentials reports per-provider outcomes and
 *      classifies pi's CredentialSynchronizationError.
 *   5. describeCredentialSyncOperation covers all four operations.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CredentialSynchronizationError } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  apiKeyOf,
  collectStoredApiKeys,
  describeCredentialSyncOperation,
  isApiKeyCredential,
  isCredentialSynchronizationError,
  listCredentialProviderIds,
  readProviderCredential,
  resolveProviderAuth,
  syncRuntimeCredentials,
  type CredentialRuntimePort,
} from "../pi-auth";

function authFile(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "openbuddy-r39-pi-auth-"));
  const path = join(dir, "auth.json");
  writeFileSync(path, JSON.stringify(content), "utf8");
  return path;
}

const SAMPLE = {
  deepseek: { type: "api_key", key: "sk-deepseek-placeholder" },
  openai: { type: "api_key", key: "sk-openai-placeholder" },
  anthropic: { type: "oauth", access: "access-placeholder", refresh: "refresh-placeholder", expires: 0 },
  empty: { type: "api_key", key: "" },
};

describe("R39 G15 — pi-auth facade", () => {
  it("readProviderCredential returns the stored credential for a provider", () => {
    const path = authFile(SAMPLE);
    const credential = readProviderCredential("deepseek", path);
    expect(credential?.type).toBe("api_key");
    expect(isApiKeyCredential(credential)).toBe(true);
    expect(apiKeyOf(credential)).toBe("sk-deepseek-placeholder");
  });

  it("readProviderCredential returns undefined for a missing file", () => {
    expect(readProviderCredential("deepseek", "/nonexistent/r39/auth.json")).toBeUndefined();
  });

  it("apiKeyOf rejects oauth credentials and empty keys", () => {
    expect(apiKeyOf({ type: "oauth", access: "a", refresh: "r", expires: 0 })).toBeUndefined();
    expect(apiKeyOf({ type: "api_key", key: "" })).toBeUndefined();
    expect(apiKeyOf(undefined)).toBeUndefined();
  });

  it("listCredentialProviderIds returns [] for a missing file and the keys otherwise", async () => {
    expect(await listCredentialProviderIds("/nonexistent/r39/auth.json")).toEqual([]);
    const ids = await listCredentialProviderIds(authFile(SAMPLE));
    expect(ids.sort()).toEqual(["anthropic", "deepseek", "empty", "openai"]);
  });

  it("collectStoredApiKeys keeps only usable api_key providers", async () => {
    const entries = await collectStoredApiKeys(authFile(SAMPLE));
    expect(entries.map((e) => e.providerId).sort()).toEqual(["deepseek", "openai"]);
    expect(entries.find((e) => e.providerId === "deepseek")?.apiKey).toBe(
      "sk-deepseek-placeholder",
    );
  });

  it("syncRuntimeCredentials hydrates every api-key provider and reports ok", async () => {
    const calls: Array<[string, string]> = [];
    const runtime: CredentialRuntimePort = {
      setRuntimeApiKey: async (providerId, apiKey) => {
        calls.push([providerId, apiKey]);
      },
      getAuth: async () => undefined,
    };

    const results = await syncRuntimeCredentials(runtime, authFile(SAMPLE));
    expect(calls.map(([id]) => id).sort()).toEqual(["deepseek", "openai"]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results).toHaveLength(2);
  });

  it("syncRuntimeCredentials classifies CredentialSynchronizationError and keeps going", async () => {
    const onError = vi.fn();
    const runtime: CredentialRuntimePort = {
      setRuntimeApiKey: async (providerId) => {
        if (providerId === "deepseek") {
          throw new CredentialSynchronizationError(
            "deepseek",
            "setRuntimeApiKey",
            undefined,
            { cause: new Error("snapshot write failed") },
          );
        }
      },
      getAuth: async () => undefined,
    };

    const results = await syncRuntimeCredentials(runtime, authFile(SAMPLE), { onError });
    const failed = results.find((r) => !r.ok);
    expect(failed?.providerId).toBe("deepseek");
    expect(failed?.operation).toBe("setRuntimeApiKey");
    expect(isCredentialSynchronizationError(failed?.error)).toBe(true);
    // The other provider still hydrated — one bad credential must not
    // abort the whole startup sync.
    expect(results.find((r) => r.providerId === "openai")?.ok).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("isCredentialSynchronizationError matches structurally across bundle boundaries", () => {
    expect(isCredentialSynchronizationError(new Error("nope"))).toBe(false);
    expect(isCredentialSynchronizationError(undefined)).toBe(false);
    expect(
      isCredentialSynchronizationError({
        name: "CredentialSynchronizationError",
        providerId: "deepseek",
        operation: "login",
      }),
    ).toBe(true);
  });

  it("describeCredentialSyncOperation labels all four operations", () => {
    for (const operation of [
      "login",
      "logout",
      "setRuntimeApiKey",
      "removeRuntimeApiKey",
    ] as const) {
      expect(describeCredentialSyncOperation(operation).length).toBeGreaterThan(0);
    }
  });

  it("resolveProviderAuth forwards typed ModelRuntimeAuthOverrides", async () => {
    const getAuth = vi.fn(async () => ({ auth: { apiKey: "override-placeholder" } }));
    const runtime: CredentialRuntimePort = {
      setRuntimeApiKey: async () => {},
      getAuth,
    };

    await resolveProviderAuth(runtime, "deepseek", {
      apiKey: "override-placeholder",
      minOAuthValidityMs: 60_000,
    });

    expect(getAuth).toHaveBeenCalledWith("deepseek", {
      apiKey: "override-placeholder",
      minOAuthValidityMs: 60_000,
    });
  });
});
