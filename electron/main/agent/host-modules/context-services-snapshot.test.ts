/**
 * context-services-snapshot.test.ts — smoke tests for context service capture/restore.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

import {
  installContextServicesSnapshot,
  captureReloadableContextServices,
  restoreCapturedContextServices,
  __resetContextServicesSnapshotForTest,
} from "./context-services-snapshot";
import { createDefaultAgentHostState } from "./_default-state";

afterEach(() => {
  __resetContextServicesSnapshotForTest();
});

function installState(state = createDefaultAgentHostState()) {
  installContextServicesSnapshot({
    state,
    captureDeepSeekCapabilityServices: () => new Map([["cap", "dsh-service"]]),
    restoreDeepSeekCapabilityServices: async () => undefined,
  });
  return state;
}

describe("context-services-snapshot", () => {
  it("captureReloadableContextServices throws when not installed", () => {
    expect(() => captureReloadableContextServices()).toThrow(/not installed/);
  });

  it("restoreCapturedContextServices throws when not installed", () => {
    expect(() => restoreCapturedContextServices(new Map())).toThrow(/not installed/);
  });

  it("capture merges dsh capabilities + workspaceRegistry from state", () => {
    const state = installState();
    // stub a context that holds workspaceRegistry
    state.context = { get: (k: string) => (k === "workspaceRegistry" ? "wr-val" : undefined) } as any;
    const captured = captureReloadableContextServices();
    expect(captured.get("cap")).toBe("dsh-service");
    expect(captured.get("workspaceRegistry")).toBe("wr-val");
  });

  it("capture omits workspaceRegistry when context returns undefined", () => {
    const state = installState();
    state.context = { get: () => undefined } as any;
    const captured = captureReloadableContextServices();
    expect(captured.has("workspaceRegistry")).toBe(false);
  });

  it("restore writes services only if not already present", () => {
    const state = installState();
    state.context = {
      _store: new Map<string, unknown>(),
      get(k: string) { return this._store.get(k); },
      set(k: string, v: unknown) { this._store.set(k, v); },
    } as any;
    restoreCapturedContextServices(new Map([["newService", "x"], ["existing", "should-not-overwrite"]]));
    // pre-set "existing" then call restore — should NOT overwrite
    state.context!.set("existing", "kept");
    restoreCapturedContextServices(new Map([["newService", "x"], ["existing", "should-not-overwrite"]]));
    expect(state.context!.get("newService")).toBe("x");
    expect(state.context!.get("existing")).toBe("kept");
  });

  it("restore is a no-op when state.context is null", () => {
    const state = installState();
    state.context = null;
    expect(() => restoreCapturedContextServices(new Map())).not.toThrow();
  });
});
