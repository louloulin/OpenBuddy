import { describe, expect, it, vi } from "vitest";
import { Context } from "@openbuddy/cordis";
import {
  openBuddyRendererContributionPluginIndex,
  rendererProjectCrossOrgDeliveriesPlugin,
  rendererProjectWorkflowBlackboardPlugin,
  rendererMessageDelegateToBuddyPlugin,
  rendererSettingsCollaborationPlugin,
  rendererCommandBuddyProposePlugin,
  rendererCommandFederatedGrantPlugin,
} from "./renderer-contributions";
import { openBuddyRendererEntries } from "./index";

describe("openbuddy-bundle-base renderer contributions (project / message / settings / command)", () => {
  it("exports one contribution per renderer-host kind except sidebar / composer / assistant", () => {
    expect(openBuddyRendererContributionPluginIndex.size).toBe(6);
    const kinds = new Set<string>();
    const registry = { register: vi.fn((value: { kind: string }) => { kinds.add(value.kind); return () => undefined; }) };
    const ctx = new Context();
    ctx.provide("rendererContributions", registry);
    for (const plugin of openBuddyRendererContributionPluginIndex.values()) {
      plugin.apply(ctx);
    }
    expect(kinds).toEqual(new Set(["project", "message", "settings", "command"]));
  });

  it("every contribution keeps the multi-agent collaboration invariants in its payload", () => {
    const all = [
      rendererProjectCrossOrgDeliveriesPlugin,
      rendererProjectWorkflowBlackboardPlugin,
      rendererMessageDelegateToBuddyPlugin,
      rendererSettingsCollaborationPlugin,
      rendererCommandBuddyProposePlugin,
      rendererCommandFederatedGrantPlugin,
    ];
    for (const plugin of all) {
      expect(plugin.id).toMatch(/^openbuddy-(project|message|settings|command)-/);
      expect(plugin.name).toBe(plugin.id);
      expect(plugin.inject).toEqual(["rendererContributions"]);
    }
  });

  it("project-scoped cross-org delivery contribution enforces Federated Room Grant as authority", () => {
    const registry = { register: vi.fn((_contribution: { kind: string; payload: { route?: string; capabilityIds?: string[]; requiredTrust?: string; modes?: string[] } }) => () => undefined) };
    const ctx = new Context();
    ctx.provide("rendererContributions", registry);
    rendererProjectCrossOrgDeliveriesPlugin.apply(ctx);
    const call = registry.register.mock.calls[0][0];
    expect(call.payload.capabilityIds).toContain("federated-room-grant");
    expect(call.payload.requiredTrust).toBe("known_peer");
    expect(call.payload.modes).toEqual(expect.arrayContaining(["organization", "network"]));
  });

  it("project-scoped workflow blackboard contribution reuses Provider ≠ Verifier semantics", () => {
    const registry = { register: vi.fn((_contribution: { kind: string; payload: { route?: string; command?: string; section?: string; projectTab?: string; capabilityIds?: string[]; requiredTrust?: string; modes?: string[] } }) => () => undefined) };
    const ctx = new Context();
    ctx.provide("rendererContributions", registry);
    rendererProjectWorkflowBlackboardPlugin.apply(ctx);
    const call = registry.register.mock.calls[0][0];
    expect(call.payload.capabilityIds).toContain("workflow:read");
    expect(call.payload.projectTab).toBe("workflow-blackboard");
  });

  it("message-level delegate-to-buddy contribution is replayable and redacts the original prompt", () => {
    const registry = { register: vi.fn((_contribution: { kind: string; payload: { route?: string; command?: string; section?: string; projectTab?: string; capabilityIds?: string[]; requiredTrust?: string; modes?: string[] } }) => () => undefined) };
    const ctx = new Context();
    ctx.provide("rendererContributions", registry);
    rendererMessageDelegateToBuddyPlugin.apply(ctx);
    const call = registry.register.mock.calls[0][0];
    expect(call.payload.capabilityIds).toEqual(expect.arrayContaining(["task:propose", "buddy:delegate"]));
    expect(call.payload.requiredTrust).toBe("org");
  });

  it("settings collaboration section exposes the invariants without re-implementing authority", () => {
    const registry = { register: vi.fn((_contribution: { kind: string; payload: { route?: string; command?: string; section?: string; projectTab?: string; capabilityIds?: string[]; requiredTrust?: string; modes?: string[] } }) => () => undefined) };
    const ctx = new Context();
    ctx.provide("rendererContributions", registry);
    rendererSettingsCollaborationPlugin.apply(ctx);
    const call = registry.register.mock.calls[0][0];
    expect(call.payload.capabilityIds).toEqual(expect.arrayContaining(["policy:read", "buddy:identity:read", "federated-room-grant:read"]));
    expect(call.payload.section).toBe("collaboration");
  });

  it("slash commands namespace under openbuddy-command and reference the unified collaboration surface", () => {
    const registry = { register: vi.fn((_contribution: { kind: string; payload: { route?: string; command?: string; section?: string; projectTab?: string; capabilityIds?: string[]; requiredTrust?: string; modes?: string[] } }) => () => undefined) };
    const ctx = new Context();
    ctx.provide("rendererContributions", registry);
    rendererCommandBuddyProposePlugin.apply(ctx);
    rendererCommandFederatedGrantPlugin.apply(ctx);
    const calls = registry.register.mock.calls.map((entry) => entry[0]);
    expect(calls[0].payload.command).toBe("buddy-propose");
    expect(calls[1].payload.command).toBe("federated-grant");
    expect(calls[1].payload.requiredTrust).toBe("known_peer");
  });

  it("every contribution is wired through openBuddyRendererEntries", () => {
    const ids = new Set(openBuddyRendererEntries.map((entry) => entry.id));
    for (const id of [
      "openbuddy-project-cross-org-deliveries",
      "openbuddy-project-workflow-blackboard",
      "openbuddy-message-delegate-to-buddy",
      "openbuddy-settings-collaboration",
      "openbuddy-command-buddy-propose",
      "openbuddy-command-federated-grant",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("throws if the rendererContributions service is missing", () => {
    const ctx = new Context();
    expect(() => rendererSettingsCollaborationPlugin.apply(ctx)).toThrow(/rendererContributions/);
  });
});
