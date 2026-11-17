// @vitest-environment node
import { describe, expect, it } from "vitest";
import { HOST_MODULES } from "./index";
import type { HostContext } from "../module";

// Factories only build closures; nothing on the context is touched until a command runs.
const ctx = { options: { shell: {} }, settings: {}, emit: () => {}, engine: {}, update: () => {}, servedCommands: () => [] } as unknown as HostContext;

describe("host modules (20261115-md §5.3)", () => {
  it("are the §5.3 modules and no two of them define the same command", () => {
    const modules = HOST_MODULES.map((create) => create(ctx));
    expect(modules.map((m) => m.id)).toEqual(["session", "turn", "model", "providers", "approvals", "extensions", "skills", "mcp", "notifications", "artifacts", "experts", "memory", "library", "automation", "host", "files"]);
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const { id, commands } of modules)
      for (const key of Object.keys(commands)) {
        if (owner.has(key)) clashes.push(`${key}: ${owner.get(key)} / ${id}`);
        owner.set(key, id);
      }
    expect(clashes).toEqual([]);
    // 92 + 15 experts commands (experts module, pii W2.1–W2.3) + settings_agent_get / settings_agent_set / agent_cycle_model (model, pii W0.4/W1.6) + session_search (session, pii W1.4) + agent_tree / agent_navigate (session), agent_bash / agent_bash_abort (turn), files_search (files) — 20261116-pii W1.1–W1.3.
    expect(owner.size).toBe(152); // +5 memory +4 skills_catalog +4 prompts (W2.7) +2 extensions (W2.6) +1 mcp_test (W2.4) +2 teams (W3.5) +1 usage (W5.6) +3 library (W5.5) +8 automation (W4) +4 notify_channels (W4.6) +2 protected (W6.2)
    expect([owner.get("agent_tree"), owner.get("agent_navigate"), owner.get("agent_bash"), owner.get("agent_bash_abort"), owner.get("files_search")]).toEqual(["session", "session", "turn", "turn", "files"]);
  });

  it("host_capabilities reports what the host serves plus what the embedding app serves", async () => {
    const { COMMANDS } = await import("@openbuddy/protocol/commands");
    const { EVENTS } = await import("@openbuddy/protocol/events");
    const hostKeys = HOST_MODULES.flatMap((create) => Object.keys(create(ctx).commands));
    const capabilities = async (options: Record<string, unknown>) => {
      const c = { ...ctx, options: { shell: {}, ...options }, servedCommands: () => hostKeys } as unknown as HostContext;
      const host = HOST_MODULES.map((create) => create(c)).find((m) => m.id === "host")!;
      return (await host.commands.host_capabilities({})) as { protocolVersion: number; platform: string; commands: string[]; events: string[]; features: string[] };
    };
    const bare = await capabilities({});
    expect(bare.protocolVersion).toBe(1);
    expect(bare.platform).toBe("unknown");
    expect(bare.commands).toEqual(COMMANDS.filter((c) => hostKeys.includes(c)));
    expect(bare.commands).toContain("host_capabilities");
    expect(bare.commands).not.toContain("dialog_open");
    expect(bare.events).toEqual(EVENTS.filter((e) => e.startsWith("agent://")));
    expect(bare.features).toEqual([]);
    const desktop = await capabilities({ platform: { kind: "desktop", commands: ["dialog_open"], events: ["window://resized"] } });
    expect(desktop.platform).toBe("desktop");
    expect(desktop.commands).toContain("dialog_open");
    expect(desktop.events).toContain("window://resized");
    expect(desktop.events).not.toContain("app://focus-session");
  });
});
