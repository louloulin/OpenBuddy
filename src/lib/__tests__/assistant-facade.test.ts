import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock is hoisted, so we declare the fns with vi.hoisted to share state
// between the factory and the assertions below.
const fns = vi.hoisted(() => {
  const create = () => vi.fn(async (...args: unknown[]) => `mocked:${Math.random()}:${args.length}`);
  return {
    collaborationSnapshot: create(),
    collaborationOnUpdate: create(),
    collaborationPropose: create(),
    collaborationExecute: create(),
    collaborationWorkflowPropose: create(),
    collaborationWorkflowExecute: create(),
    collaborationWorkflowStatus: create(),
    collaborationWorkflowControl: create(),
    collaborationAckInbox: create(),
    emailAcknowledgeInbox: create(),
    collaborationRequestApproval: create(),
    collaborationDecideApproval: create(),
    collaborationSideEffectApprove: create(),
    collaborationSideEffectCreate: create(),
    collaborationSideEffectComplete: create(),
    collaborationSideEffectCancel: create(),
    collaborationControlTask: create(),
    collaborationSetNetworkPeerTrust: create(),
    collaborationAddNetworkTrustRoot: create(),
    collaborationRevokeNetworkTrustRoot: create(),
    collaborationGrantDelegation: create(),
    collaborationRevokeDelegation: create(),
    collaborationAddOrganizationMember: create(),
    collaborationRemoveOrganizationMember: create(),
    collaborationAddRoomMember: create(),
    collaborationRemoveRoomMember: create(),
    collaborationGetIdentity: create(),
    collaborationUpdateIdentity: create(),
    collaborationRegisterNetworkPeer: create(),
    collaborationSubmitNetworkBid: create(),
    collaborationProposeNetworkService: create(),
    collaborationNegotiateNetworkCapability: create(),
    collaborationRevokeNetworkCapabilityAgreement: create(),
    collaborationPublishNetworkOffer: create(),
    collaborationAwardNetworkBid: create(),
    collaborationRetryNetworkDeliveries: create(),
    collaborationFederatedRoomGrants: create(),
    collaborationIssueFederatedRoomGrant: create(),
    collaborationRevokeFederatedRoomGrant: create(),
  };
});

vi.mock("@/lib/agent/pi-client", () => fns);

import { assistantFacade } from "../agent/assistant-facade";

describe("assistantFacade", () => {
  beforeEach(() => {
    for (const key of Object.keys(fns)) (fns as Record<string, ReturnType<typeof vi.fn>>)[key].mockClear();
  });

  it("delegates snapshot to collaborationSnapshot", async () => {
    await assistantFacade.snapshot();
    expect(fns.collaborationSnapshot).toHaveBeenCalledTimes(1);
  });

  it("forwards propose input untouched", async () => {
    await assistantFacade.propose({ kind: "task" } as never);
    expect(fns.collaborationPropose).toHaveBeenCalledWith({ kind: "task" } as never);
  });

  it("passes execute(taskId) through", async () => {
    await assistantFacade.execute("task-42");
    expect(fns.collaborationExecute).toHaveBeenCalledWith("task-42");
  });

  it("passes workflow propose input untouched", async () => {
    await assistantFacade.proposeWorkflow({ workflow: "x" } as never);
    expect(fns.collaborationWorkflowPropose).toHaveBeenCalledWith({ workflow: "x" } as never);
  });

  it("passes ackInbox event id through", async () => {
    await assistantFacade.ackInbox("evt-1");
    expect(fns.collaborationAckInbox).toHaveBeenCalledWith("evt-1");
  });

  it("acks email inbox with account/thread/date", async () => {
    await assistantFacade.ackEmailInbox("acct", "thread", "2026-08-31");
    expect(fns.emailAcknowledgeInbox).toHaveBeenCalledWith("acct", "thread", "2026-08-31");
  });

  it("approves side effects with the intent id", async () => {
    await assistantFacade.approveSideEffect("intent-1");
    expect(fns.collaborationSideEffectApprove).toHaveBeenCalledWith("intent-1");
  });

  it("completeSideEffect passes receipt through when provided", async () => {
    await assistantFacade.completeSideEffect("intent-1", "receipt");
    expect(fns.collaborationSideEffectComplete).toHaveBeenCalledWith("intent-1", "receipt");
  });

  it("completeSideEffect omits receipt when not provided", async () => {
    await assistantFacade.completeSideEffect("intent-1");
    expect(fns.collaborationSideEffectComplete).toHaveBeenCalledWith("intent-1", undefined);
  });

  it("cancelSideEffect accepts optional reason", async () => {
    await assistantFacade.cancelSideEffect("intent-1", "user-cancel");
    expect(fns.collaborationSideEffectCancel).toHaveBeenCalledWith("intent-1", "user-cancel");
  });

  it("controlTask forwards the action", async () => {
    await assistantFacade.controlTask({ taskId: "t1", action: "pause" });
    expect(fns.collaborationControlTask).toHaveBeenCalledWith({ taskId: "t1", action: "pause" });
  });

  it("delegates grant/revoke delegation", async () => {
    await assistantFacade.grantDelegation({ to: "user-x" } as never);
    await assistantFacade.revokeDelegation("delegation-1");
    expect(fns.collaborationGrantDelegation).toHaveBeenCalledWith({ to: "user-x" } as never);
    expect(fns.collaborationRevokeDelegation).toHaveBeenCalledWith("delegation-1");
  });

  it("adds/removes room members", async () => {
    await assistantFacade.addRoomMember({ roomId: "r", subject: "s" } as never);
    await assistantFacade.removeRoomMember({ roomId: "r", subject: "s" } as never);
    expect(fns.collaborationAddRoomMember).toHaveBeenCalledWith({ roomId: "r", subject: "s" } as never);
    expect(fns.collaborationRemoveRoomMember).toHaveBeenCalledWith({ roomId: "r", subject: "s" } as never);
  });

  it("proxies getIdentity and updateIdentity", async () => {
    await assistantFacade.getIdentity();
    await assistantFacade.updateIdentity({ displayName: "Ren" });
    expect(fns.collaborationGetIdentity).toHaveBeenCalledTimes(1);
    expect(fns.collaborationUpdateIdentity).toHaveBeenCalledWith({ displayName: "Ren" });
  });

  it("delegates network bid/award/capability negotiation", async () => {
    await assistantFacade.submitNetworkBid({ bid: "b1" } as never);
    await assistantFacade.awardNetworkBid("bid-1");
    await assistantFacade.negotiateNetworkCapability({ cap: "x" } as never);
    expect(fns.collaborationSubmitNetworkBid).toHaveBeenCalledWith({ bid: "b1" } as never);
    expect(fns.collaborationAwardNetworkBid).toHaveBeenCalledWith("bid-1");
    expect(fns.collaborationNegotiateNetworkCapability).toHaveBeenCalledWith({ cap: "x" } as never);
  });

  it("revokeNetworkCapabilityAgreement requires reason", async () => {
    await assistantFacade.revokeNetworkCapabilityAgreement("agree-1", "policy-violation");
    expect(fns.collaborationRevokeNetworkCapabilityAgreement).toHaveBeenCalledWith(
      "agree-1",
      "policy-violation",
    );
  });

  it("delegates federated room grant operations", async () => {
    await assistantFacade.issueFederatedRoomGrant({ roomId: "r1" } as never);
    await assistantFacade.revokeFederatedRoomGrant("grant-1");
    expect(fns.collaborationIssueFederatedRoomGrant).toHaveBeenCalledWith({ roomId: "r1" } as never);
    expect(fns.collaborationRevokeFederatedRoomGrant).toHaveBeenCalledWith("grant-1");
  });
});
