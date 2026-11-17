import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invoke, listen, setBridgeFallback } from "@openbuddy/client/ipc";
import { claimPairing, forgetPairing, installPairing, isBrowserHost, savedPairing } from "../boot";

const token = "dvc_1_secret";

function stubFetch() {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith("/pair/claim")) {
      return new Response(JSON.stringify({ deviceToken: token, deviceId: "d1", scopes: ["sessions:read"] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, result: ["from-gateway"] }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchImpl);
  return { calls, fetchImpl };
}

describe("H5 boot", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as { openbuddy?: unknown }).openbuddy;
  });

  afterEach(() => {
    setBridgeFallback(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("treats a page without the preload bridge as the browser host", () => {
    expect(isBrowserHost()).toBe(true);
    (window as { openbuddy?: unknown }).openbuddy = {};
    expect(isBrowserHost()).toBe(false);
  });

  it("claims the code, stores the token, and installs a working transport", async () => {
    const { calls } = stubFetch();
    const pairing = await claimPairing("https://gw.test/", "12345678", "浏览器");
    expect(pairing.deviceToken).toBe(token);
    expect(calls[0]!.url).toBe("https://gw.test/pair/claim");
    expect(calls[0]!.body).toMatchObject({ code: "12345678", deviceName: "浏览器", platform: "web" });

    expect(savedPairing()).toMatchObject({ gatewayUrl: "https://gw.test/", deviceToken: token });
    expect(isBrowserHost()).toBe(true);

    installPairing(pairing);
    await expect(invoke<string[]>("agent_list_sessions", {})).resolves.toEqual(["from-gateway"]);
    const streamed: unknown[] = [];
    const unlisten = await listen<{ n: number }>("agent://event", envelope => streamed.push(envelope));
    expect(typeof unlisten).toBe("function");
    unlisten();
  });

  it("forgets the credential", async () => {
    stubFetch();
    await claimPairing("https://gw.test", "12345678", "浏览器");
    forgetPairing();
    expect(savedPairing()).toBeNull();
  });

  it("surfaces a refused claim instead of storing anything", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "code_expired" }), { status: 410 })));
    await expect(claimPairing("https://gw.test", "12345678", "浏览器")).rejects.toThrow("code_expired");
    expect(savedPairing()).toBeNull();
  });
});
