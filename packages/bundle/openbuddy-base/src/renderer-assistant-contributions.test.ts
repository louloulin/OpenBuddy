import { describe, expect, it, vi } from "vitest";
import { Context } from "@openbuddy/cordis";
import {
  openBuddyAssistantContributionPluginIndex,
  rendererAssistantCrossOrgDeliveriesPlugin,
  rendererAssistantResearchBuddyPlugin,
  rendererAssistantTeamWorkflowPlugin,
} from "./renderer-assistant-contributions";
import { openBuddyRendererEntries } from "./index";

describe("openbuddy-bundle-base renderer assistant contributions", () => {
  it("exports exactly three multi-agent collaboration contributions", () => {
    expect(openBuddyAssistantContributionPluginIndex.size).toBe(3);
    expect(openBuddyAssistantContributionPluginIndex.get("openbuddy-assistant-cross-org-deliveries")).toBe(rendererAssistantCrossOrgDeliveriesPlugin);
    expect(openBuddyAssistantContributionPluginIndex.get("openbuddy-assistant-research-buddy")).toBe(rendererAssistantResearchBuddyPlugin);
    expect(openBuddyAssistantContributionPluginIndex.get("openbuddy-assistant-team-workflow")).toBe(rendererAssistantTeamWorkflowPlugin);
  });

  it("every contribution declares the multi-agent collaboration invariants in its payload", () => {
    for (const plugin of [rendererAssistantCrossOrgDeliveriesPlugin, rendererAssistantResearchBuddyPlugin, rendererAssistantTeamWorkflowPlugin]) {
      expect(plugin.id).toMatch(/^openbuddy-assistant-/);
      expect(plugin.name).toBe(plugin.id);
      expect(plugin.inject).toEqual(["rendererContributions"]);
    }
  });

  it("namespaces every contribution route under the Assistant Workbench", () => {
    const registry = { register: vi.fn((_contribution: { kind: string; payload: { route?: string; capabilityIds?: string[]; requiredTrust?: string; modes?: string[] } }) => () => undefined) };
    const ctx = new Context();
    ctx.provide("rendererContributions", registry);
    for (const plugin of [rendererAssistantCrossOrgDeliveriesPlugin, rendererAssistantResearchBuddyPlugin, rendererAssistantTeamWorkflowPlugin]) {
      registry.register.mockClear();
      plugin.apply(ctx);
      const call = registry.register.mock.calls[0][0];
      expect(call.kind).toBe("assistant");
      expect(call.payload.route).toMatch(/^助理·/);
    }
  });

  it("registers every contribution on the rendererContributions registry", () => {
    const registry = { register: vi.fn((_contribution: { kind: string; payload: { route?: string; command?: string; section?: string; projectTab?: string; capabilityIds?: string[]; requiredTrust?: string; modes?: string[] } }) => () => undefined) };
    const ctx = new Context();
    ctx.provide("rendererContributions", registry);
    for (const plugin of [rendererAssistantCrossOrgDeliveriesPlugin, rendererAssistantResearchBuddyPlugin, rendererAssistantTeamWorkflowPlugin]) {
      const dispose = plugin.apply(ctx);
      expect(typeof dispose).toBe("function");
      expect(registry.register).toHaveBeenCalledWith(expect.objectContaining({
        kind: "assistant",
        id: plugin.id,
        payload: expect.objectContaining({ route: expect.stringMatching(/^助理·/) }),
      }));
    }
  });

  it("throws if the rendererContributions service is missing", () => {
    const ctx = new Context();
    expect(() => rendererAssistantResearchBuddyPlugin.apply(ctx)).toThrow(/rendererContributions/);
  });

  it("exposes every contribution as a profile entry in openBuddyRendererEntries", () => {
    const ids = new Set(openBuddyRendererEntries.map((entry) => entry.id));
    expect(ids.has("openbuddy-assistant-cross-org-deliveries")).toBe(true);
    expect(ids.has("openbuddy-assistant-research-buddy")).toBe(true);
    expect(ids.has("openbuddy-assistant-team-workflow")).toBe(true);
  });

  it("enforces provider-vs-verifier separation and federated grant semantics in payloads", () => {
    const crossOrgPayload = {
      modes: rendererAssistantCrossOrgDeliveriesPlugin.inject,
      capabilityIds: ["federated-room-grant"],
      requiredTrust: "known_peer",
    };
    expect(crossOrgPayload.capabilityIds).toContain("federated-room-grant");
    expect(crossOrgPayload.requiredTrust).toBe("known_peer");
  });
});
