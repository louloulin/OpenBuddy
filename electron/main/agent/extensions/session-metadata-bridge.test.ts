import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * session-metadata-bridge.test.ts
 *
 * Phase B.1 — verify the 5th builtin ExtensionFactory wires up
 * session_start / session_shutdown / session_info_changed handlers
 * correctly without touching disk when no JSON mirror exists.
 *
 * Uses a per-test isolated HOME via `process.env.PI_HOME` so the
 * `_host-paths.piHome()` lookup points at a tmpdir.
 */

import {
  createSessionMetadataBridgeExtension,
  sessionMetadataBridgeFactory,
} from "./session-metadata-bridge";

type Handler = (payload: unknown) => unknown | Promise<unknown>;

function makeFakePi() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    api: {
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
      },
    } as const,
  };
}

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), "openbuddy-bridge-"));
  // piHome() reads PI_CODING_AGENT_DIR first, then PI_HOME, then defaults.
  process.env["PI_CODING_AGENT_DIR"] = tmpHome;
});

afterEach(async () => {
  delete process.env["PI_CODING_AGENT_DIR"];
  await rm(tmpHome, { recursive: true, force: true });
});

describe("session-metadata-bridge", () => {
  it("is a callable factory (B.1 sanity)", () => {
    expect(typeof sessionMetadataBridgeFactory).toBe("function");
    expect(typeof createSessionMetadataBridgeExtension()).toBe("function");
  });

  it("registers handlers for session_start / session_shutdown / session_info_changed", () => {
    const fake = makeFakePi();
    sessionMetadataBridgeFactory(fake.api as never);

    expect(fake.handlers.has("session_start")).toBe(true);
    expect(fake.handlers.has("session_shutdown")).toBe(true);
    expect(fake.handlers.has("session_info_changed")).toBe(true);
  });

  it("session_start loads the JSON mirror without throwing on first run", async () => {
    const fake = makeFakePi();
    sessionMetadataBridgeFactory(fake.api as never);

    const handler = fake.handlers.get("session_start");
    expect(handler).toBeDefined();
    await expect(handler?.({ cwd: tmpHome })).resolves.toBeUndefined();
  });

  it("session_start parses an existing JSON mirror", async () => {
    const mirror = {
      version: 1,
      pinned: ["s1"],
      archived: ["s2"],
      experts: { s3: { expertId: "e1", expertName: "Expert 1" } },
    };
    await writeFile(
      join(tmpHome, "openbuddy-state.json"),
      JSON.stringify(mirror, null, 2),
      "utf8",
    );

    const fake = makeFakePi();
    sessionMetadataBridgeFactory(fake.api as never);

    const handler = fake.handlers.get("session_start");
    expect(handler).toBeDefined();
    await expect(handler?.({ cwd: tmpHome })).resolves.toBeUndefined();
  });

  it("session_shutdown returns the empty-mirror marker (forwarder)", () => {
    const fake = makeFakePi();
    sessionMetadataBridgeFactory(fake.api as never);
    const handler = fake.handlers.get("session_shutdown");
    expect(handler).toBeDefined();
    const result = handler?.({});
    expect(result).toEqual({ version: 1, pinned: [], archived: [], experts: {} });
  });

  it("session_info_changed forwards arbitrary payload (no-op today)", () => {
    const fake = makeFakePi();
    sessionMetadataBridgeFactory(fake.api as never);
    const handler = fake.handlers.get("session_info_changed");
    expect(handler).toBeDefined();
    expect(handler?.({ sessionId: "x", label: "y" })).toBeUndefined();
  });

  it("does not crash when given an api object without `on`", () => {
    expect(() => sessionMetadataBridgeFactory({} as never)).not.toThrow();
  });

  it("OPENBUDDY_BRIDGE_DEBUG=1 enables console logging (smoke test)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      process.env["OPENBUDDY_BRIDGE_DEBUG"] = "1";
      const fake = makeFakePi();
      sessionMetadataBridgeFactory(fake.api as never);
      const handler = fake.handlers.get("session_start");
      await handler?.({ cwd: tmpHome });
      expect(spy).toHaveBeenCalled();
    } finally {
      delete process.env["OPENBUDDY_BRIDGE_DEBUG"];
      spy.mockRestore();
    }
  });
});