/**
 * agent-secret-store-bridge.test.ts — SecretStore 双路径适配层单元测试 (P2.1-secrets)
 *
 * 覆盖 5 个核心场景(与 permission bridge 同款):
 *   1. fallback path (no host-core) → 完全走 platform SecretStore
 *   2. host-core path (attached) → 优先 host-core
 *   3. degradation on host-core failure → 降级到 fallback
 *   4. backoff after failure → 失败后短期不再重试
 *   5. reset semantics
 *
 * 测试策略:
 *   - mock `@openbuddy/host-runtime` 的 callSecrets* wrappers
 *   - 提供 fake fallback SecretStore
 *   - 不 spawn 真实 host-core binary
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachHostCoreSecretStore,
  createBridgeSecretStore,
  HostCoreSecretStoreBridge,
  resetAgentSecretStoreBridge,
  secretStoreBridgeState,
} from "../agent-secret-store-bridge";

// ---- mocks -----------------------------------------------------------------

const {
  callSecretsSet,
  callSecretsGet,
  callSecretsDelete,
} = vi.hoisted(() => ({
  callSecretsSet: vi.fn(),
  callSecretsGet: vi.fn(),
  callSecretsDelete: vi.fn(),
}));

vi.mock("@openbuddy/host-runtime", () => ({
  callSecretsSet,
  callSecretsGet,
  callSecretsDelete,
}));

// fake host handle
const fakeHost = { call: vi.fn(), dispose: vi.fn() } as unknown as { call: unknown };

// fake fallback SecretStore
function makeFakeFallback() {
  const values = new Map<string, { value: string; label?: string }>();
  return {
    values,
    async put(ref: string, value: string, metadata?: { label?: string }) {
      values.set(ref, { value, label: metadata?.label });
      return { ref, provider: "fake-fallback", ...(metadata?.label ? { label: metadata.label } : {}) };
    },
    async get(ref: string) {
      return values.get(ref)?.value;
    },
    async delete(ref: string) {
      values.delete(ref);
    },
  };
}

beforeEach(() => {
  callSecretsSet.mockReset();
  callSecretsGet.mockReset();
  callSecretsDelete.mockReset();
  resetAgentSecretStoreBridge();
});

afterEach(() => {
  resetAgentSecretStoreBridge();
});

// ---- tests -----------------------------------------------------------------

describe("agent-secret-store-bridge — fallback path (no host-core)", () => {
  it("put goes to fallback when host-core not attached", async () => {
    const fallback = makeFakeFallback();
    const bridge = new HostCoreSecretStoreBridge(fallback);

    const res = await bridge.put("secret:openai:api_key", "sk-xxx", { label: "OpenAI" });

    expect(res).toEqual({ ref: "secret:openai:api_key", provider: "fake-fallback", label: "OpenAI" });
    expect(callSecretsSet).not.toHaveBeenCalled();
    expect(fallback.values.get("secret:openai:api_key")).toEqual({ value: "sk-xxx", label: "OpenAI" });
  });

  it("get returns fallback value when host-core not attached", async () => {
    const fallback = makeFakeFallback();
    await fallback.put("secret:x", "value-from-fallback");
    const bridge = new HostCoreSecretStoreBridge(fallback);

    const result = await bridge.get("secret:x");

    expect(result).toBe("value-from-fallback");
    expect(callSecretsGet).not.toHaveBeenCalled();
  });

  it("delete removes from fallback when host-core not attached", async () => {
    const fallback = makeFakeFallback();
    await fallback.put("secret:x", "v");
    const bridge = new HostCoreSecretStoreBridge(fallback);

    await bridge.delete("secret:x");

    expect(callSecretsDelete).not.toHaveBeenCalled();
    expect(fallback.values.has("secret:x")).toBe(false);
  });

  it("createBridgeSecretStore returns fallback as-is when host is null", () => {
    const fallback = makeFakeFallback();
    const result = createBridgeSecretStore({ host: null, fallback });

    expect(result).toBe(fallback);
  });
});

describe("agent-secret-store-bridge — host-core path (attached)", () => {
  beforeEach(() => {
    attachHostCoreSecretStore(fakeHost as never);
  });

  it("put uses host-core on the happy path", async () => {
    const fallback = makeFakeFallback();
    const bridge = new HostCoreSecretStoreBridge(fallback);
    callSecretsSet.mockResolvedValue({ ref: "secret:x", backend: "file_fallback", updatedAt: "2026-09-24T00:00:00Z" });

    const res = await bridge.put("secret:x", "value", { label: "L" });

    expect(res).toEqual({ ref: "secret:x", provider: "file_fallback", label: "L" });
    expect(callSecretsSet).toHaveBeenCalledWith(fakeHost, { ref: "secret:x", value: "value", label: "L" });
    expect(fallback.values.size).toBe(0); // fallback untouched
  });

  it("get uses host-core on the happy path", async () => {
    const fallback = makeFakeFallback();
    const bridge = new HostCoreSecretStoreBridge(fallback);
    callSecretsGet.mockResolvedValue({ backend: "file_fallback", value: "from-host-core" });

    const result = await bridge.get("secret:x");

    expect(result).toBe("from-host-core");
    expect(callSecretsGet).toHaveBeenCalledWith(fakeHost, { ref: "secret:x" });
  });

  it("get returns undefined when host-core returns null value", async () => {
    const fallback = makeFakeFallback();
    const bridge = new HostCoreSecretStoreBridge(fallback);
    callSecretsGet.mockResolvedValue({ backend: "file_fallback", value: null });

    const result = await bridge.get("missing");

    expect(result).toBeUndefined();
  });

  it("delete uses host-core on the happy path", async () => {
    const fallback = makeFakeFallback();
    const bridge = new HostCoreSecretStoreBridge(fallback);
    callSecretsDelete.mockResolvedValue({ ok: true });

    await bridge.delete("secret:x");

    expect(callSecretsDelete).toHaveBeenCalledWith(fakeHost, { ref: "secret:x" });
    expect(fallback.values.size).toBe(0);
  });

  it("createBridgeSecretStore wraps fallback when host is provided", async () => {
    const fallback = makeFakeFallback();
    callSecretsSet.mockResolvedValue({ ref: "x", backend: "keychain", updatedAt: "2026-09-24T00:00:00Z" });

    const store = createBridgeSecretStore({ host: fakeHost as never, fallback });
    await store.put("x", "v");

    expect(callSecretsSet).toHaveBeenCalledWith(fakeHost, { ref: "x", value: "v", label: undefined });
  });
});

describe("agent-secret-store-bridge — degradation on host-core failure", () => {
  beforeEach(() => {
    attachHostCoreSecretStore(fakeHost as never);
  });

  it("falls back when callSecretsSet throws", async () => {
    const fallback = makeFakeFallback();
    const bridge = new HostCoreSecretStoreBridge(fallback);
    callSecretsSet.mockRejectedValue(new Error("host-core disconnected"));

    const res = await bridge.put("secret:x", "v", { label: "L" });

    expect(res.provider).toBe("fake-fallback");
    expect(fallback.values.get("secret:x")).toEqual({ value: "v", label: "L" });
  });

  it("falls back when callSecretsGet throws", async () => {
    const fallback = makeFakeFallback();
    await fallback.put("secret:x", "fallback-value");
    const bridge = new HostCoreSecretStoreBridge(fallback);
    callSecretsGet.mockRejectedValue(new Error("ENOENT: no such file"));

    const result = await bridge.get("secret:x");

    expect(result).toBe("fallback-value");
  });

  it("falls back when callSecretsDelete throws", async () => {
    const fallback = makeFakeFallback();
    await fallback.put("secret:x", "v");
    const bridge = new HostCoreSecretStoreBridge(fallback);
    callSecretsDelete.mockRejectedValue(new Error("rpc timeout"));

    await bridge.delete("secret:x");

    expect(callSecretsDelete).toHaveBeenCalledTimes(1);
    expect(fallback.values.has("secret:x")).toBe(false);
  });
});

describe("agent-secret-store-bridge — backoff after failure", () => {
  beforeEach(() => {
    attachHostCoreSecretStore(fakeHost as never);
  });

  it("skips host-core during backoff window after a failure", async () => {
    const fallback = makeFakeFallback();
    const bridge = new HostCoreSecretStoreBridge(fallback);
    callSecretsSet.mockRejectedValue(new Error("boom"));

    await bridge.put("secret:x", "v1");
    expect(callSecretsSet).toHaveBeenCalledTimes(1);

    // Second call within backoff window: skips host-core entirely
    await bridge.put("secret:x", "v2");
    expect(callSecretsSet).toHaveBeenCalledTimes(1); // still 1
    expect(fallback.values.get("secret:x")?.value).toBe("v2");
  });

  it("secretStoreBridgeState reports inBackoff after a failure", async () => {
    const bridge = new HostCoreSecretStoreBridge(makeFakeFallback());
    callSecretsGet.mockRejectedValue(new Error("boom"));

    await bridge.get("secret:x");

    const state = secretStoreBridgeState();
    expect(state.hostAttached).toBe(true);
    expect(state.available).toBe(false);
    expect(state.inBackoff).toBe(true);
  });

  it("secretStoreBridgeState reports available when host-core healthy", () => {
    const state = secretStoreBridgeState();
    expect(state.hostAttached).toBe(true);
    expect(state.available).toBe(true);
    expect(state.inBackoff).toBe(false);
  });

  it("secretStoreBridgeState reports hostAttached=false when no host", () => {
    attachHostCoreSecretStore(null);
    const state = secretStoreBridgeState();
    expect(state.hostAttached).toBe(false);
  });
});

describe("agent-secret-store-bridge — reset semantics", () => {
  it("resetAgentSecretStoreBridge clears host attachment", () => {
    attachHostCoreSecretStore(fakeHost as never);
    expect(secretStoreBridgeState().hostAttached).toBe(true);

    resetAgentSecretStoreBridge();

    expect(secretStoreBridgeState().hostAttached).toBe(false);
    expect(secretStoreBridgeState().available).toBe(true);
  });
});
