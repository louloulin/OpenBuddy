import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("../platform/electron-api", () => ({
  invoke: (channel: string, payload?: unknown) => invokeMock(channel, payload),
}));

import { casdoorListWebhookSubscriptions, casdoorUpdateWebhookSubscriptions, CASDOOR_WEBHOOK_EVENT_TYPES } from "../casdoor/casdoor-client";

describe("casdoorListWebhookSubscriptions / casdoorUpdateWebhookSubscriptions client wrappers", () => {
  it("lists default-all subscriptions when none configured", async () => {
    invokeMock.mockResolvedValueOnce({
      tenantId: "acme",
      eventTypes: [...CASDOOR_WEBHOOK_EVENT_TYPES],
      source: "default-all",
    });
    const out = await casdoorListWebhookSubscriptions("acme");
    expect(invokeMock).toHaveBeenCalledWith("casdoor:webhook-subscription-list", { tenantId: "acme" });
    expect(out.source).toBe("default-all");
    expect(out.eventTypes).toContain("user.update");
  });

  it("lists explicit subscriptions when tenant has configured them", async () => {
    invokeMock.mockResolvedValueOnce({
      tenantId: "acme",
      eventTypes: ["user.delete", "organization.delete"],
      source: "explicit",
    });
    const out = await casdoorListWebhookSubscriptions("acme");
    expect(out.source).toBe("explicit");
    expect(out.eventTypes).toHaveLength(2);
  });

  it("updates subscriptions and returns the new snapshot", async () => {
    invokeMock.mockResolvedValueOnce({
      tenantId: "acme",
      eventTypes: ["user.update", "role.delete"],
      source: "explicit",
    });
    const out = await casdoorUpdateWebhookSubscriptions({ tenantId: "acme", eventTypes: ["user.update", "role.delete"] });
    expect(invokeMock).toHaveBeenCalledWith("casdoor:webhook-subscription-update", { tenantId: "acme", eventTypes: ["user.update", "role.delete"] });
    expect(out.eventTypes).toHaveLength(2);
  });

  it("propagates IPC errors", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Casdoor /api/webhook-subscription 403"));
    await expect(casdoorUpdateWebhookSubscriptions({ tenantId: "acme", eventTypes: [] })).rejects.toThrow("Casdoor /api/webhook-subscription 403");
  });
});
