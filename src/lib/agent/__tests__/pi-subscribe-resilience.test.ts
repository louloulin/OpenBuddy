import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/platform/electron-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/platform/electron-api")>("@/lib/platform/electron-api");
  return {
    ...actual,
    listen: vi.fn(async () => () => {}),
    invoke: vi.fn(async () => ({ sessionId: "fake-session", cwd: "/tmp/x", defaultModelId: "x", auth: { ready: true } })),
  };
});

import { subscribePiEvents } from "@/lib/agent/pi-client";
import { listen } from "@/lib/platform/electron-api";

const setBridge = (api?: unknown) => {
  if (api === undefined) {
    delete (window as Window & { api?: unknown }).api;
  } else {
    (window as Window & { api?: unknown }).api = api;
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
