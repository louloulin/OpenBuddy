import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the specifier the implementation actually imports. The package-side
// module resolves `@openbuddy/platform/electron-api` directly, so mocking the
// app-side shim path would silently stop intercepting the bridge.
vi.mock("@openbuddy/platform/electron-api", async () => {
  const actual = await vi.importActual<typeof import("@openbuddy/platform/electron-api")>("@openbuddy/platform/electron-api");
  return {
    ...actual,
    listen: vi.fn(async () => () => {}),
    invoke: vi.fn(async () => ({ sessionId: "fake-session", cwd: "/tmp/x", defaultModelId: "x", auth: { ready: true } })),
  };
});

import { subscribePiEvents } from "@/lib/agent/pi-client";
import { listen } from "@openbuddy/platform/electron-api";

const setBridge = (api?: unknown) => {
  if (api === undefined) {
    delete (window as unknown as { api?: unknown }).api;
  } else {
    (window as unknown as { api?: unknown }).api = api;
  }
};

describe("subscribePiEvents bridge resilience", () => {
  beforeEach(() => {
    setBridge(undefined);
    vi.mocked(listen).mockReset();
  });
  afterEach(() => {
    setBridge(undefined);
  });

  it("rejects with ElectronBridgeUnavailable when preload is missing", async () => {
    await expect(
      subscribePiEvents({
        onUpdate: () => {},
      }),
    ).rejects.toMatchObject({ name: "ElectronBridgeUnavailable", reason: "preload-not-loaded" });
  });

  it("does not silently swallow other errors", async () => {
    setBridge({ apiVersion: 1 });
    vi.mocked(listen).mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    await expect(
      subscribePiEvents({
        onUpdate: () => {},
      }),
    ).rejects.toThrow("boom");
  });
});
