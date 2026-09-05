import { describe, expect, it } from "vitest";
import { buildEnterpriseBillingHeaders } from "./enterprise-billing-context";

describe("buildEnterpriseBillingHeaders", () => {
  it("adds auditable Agent, session, and wallet dimensions for New API", () => {
    expect(buildEnterpriseBillingHeaders({
      provider: "new_api-minimax",
      sessionId: "session-1",
      agentId: "agent-1",
      walletId: "wallet-1",
    }, { accept: "application/json" })).toEqual({
      accept: "application/json",
      "x-openbuddy-agent": "agent-1",
      "x-openbuddy-session": "session-1",
      "x-openbuddy-wallet": "wallet-1",
    });
  });

  it("does not add enterprise dimensions to BYOK providers", () => {
    const headers = { accept: "application/json" };
    expect(buildEnterpriseBillingHeaders({ provider: "openai", sessionId: "session-1" }, headers)).toBe(headers);
  });

  it("sanitizes and bounds forwarded dimensions", () => {
    const headers = buildEnterpriseBillingHeaders({
      provider: "new_api",
      sessionId: " session\n1 ",
      agentId: "\tagent-1",
    });
    expect(headers["x-openbuddy-agent"]).toBe("agent-1");
    expect(headers["x-openbuddy-session"]).toBe("session1");
    expect(headers["x-openbuddy-wallet"]).toBeUndefined();
  });
});
