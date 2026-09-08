/**
 * _agent-host-deps.test.ts — verify the shared deps bag type compiles.
 */
import { describe, expect, it } from "vitest";

import type { AgentHostIpcDeps } from "../_agent-host-deps";

describe("ipc/_agent-host-deps", () => {
  it("exposes the AgentHostIpcDeps interface with the expected fields", () => {
    const deps: AgentHostIpcDeps = {
      ensureAgentHost: async () => undefined,
      agentHost: {} as never,
      casdoorAuth: {} as never,
      inflightAbortControllers: new Map(),
      awaitExtensionsBound: async () => undefined,
      getWindow: () => null,
    };
    expect(typeof deps.ensureAgentHost).toBe("function");
    expect(typeof deps.getWindow).toBe("function");
    expect(deps.inflightAbortControllers).toBeInstanceOf(Map);
  });
});