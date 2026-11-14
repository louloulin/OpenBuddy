// @vitest-environment node
import { describe, expect, it } from "vitest";
import { HOST_MODULES } from "./index";
import type { HostContext } from "../module";

// Factories only build closures; nothing on the context is touched until a command runs.
const ctx = { options: { shell: {} }, settings: {}, emit: () => {}, engine: {}, update: () => {} } as unknown as HostContext;

describe("host modules (20261115-md §5.3)", () => {
  it("are the §5.3 modules and no two of them define the same command", () => {
    const modules = HOST_MODULES.map((create) => create(ctx));
    expect(modules.map((m) => m.id)).toEqual(["session", "turn", "model", "providers", "approvals", "extensions", "skills", "mcp", "notifications", "artifacts", "host", "files"]);
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const { id, commands } of modules)
      for (const key of Object.keys(commands)) {
        if (owner.has(key)) clashes.push(`${key}: ${owner.get(key)} / ${id}`);
        owner.set(key, id);
      }
    expect(clashes).toEqual([]);
    expect(owner.size).toBe(92);
  });

  it("host_capabilities reports the protocol version and the whole contract", async () => {
    const { COMMANDS } = await import("@openbuddy/protocol/commands");
    const { EVENTS } = await import("@openbuddy/protocol/events");
    const host = HOST_MODULES.map((create) => create(ctx)).find((m) => m.id === "host")!;
    const caps = (await host.commands.host_capabilities({})) as Record<string, unknown>;
    expect(caps).toEqual({ protocolVersion: 1, platform: "desktop", commands: [...COMMANDS], events: [...EVENTS], features: [] });
    expect(caps.commands).toContain("host_capabilities");
  });
});
