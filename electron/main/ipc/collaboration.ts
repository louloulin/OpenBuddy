/**
 * IPC surface — collaboration domain.
 *
 * Split out of `./index.ts`.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { agentHost, bindRendererEventEmitter } from "./agent-host-proxy";
import * as resources from "../agent/pi-resources";
import {
	absolutePath,
	assertPolicyModelAllowed,
	assertPolicySkillUploadAllowed,
	emailComposePayload,
	emailMutationPayload,
	emailRuleSchedule,
	emailSearchPayload,
	emailTagMutationPayload,
	enumValue,
	fromPiPermissionMode,
	httpUrl,
	memoryScope,
	modelId,
	normalizePromptContent,
	numberValue,
	openDialogOptions,
	optionalCwd,
	optionalFiniteInteger,
	optionalFiniteNumber,
	optionalNonNegativeIntegerArray,
	optionalString,
	optionalStringArray,
	permissionRules,
	providerId,
	publicPermissionMode,
	recordValue,
	requiredBoolean,
	requiredString,
	requiredStringArray,
	saveDialogOptions,
	stringValue,
	throwWorkspaceIpcError,
	toPiPermissionMode,
	writeAllowedRoot,
	type RecordValue,
} from "./validation";
// dynamic: ../casdoor/buddy-identity-store
// dynamic: ../collaboration/a2a-runtime-adapter
// dynamic: ../collaboration/collaboration-runtime
// dynamic: @openbuddy/collaboration-protocol

export function registerCollaborationIpc(getWindow: () => BrowserWindow | null): void {
		ipcMain.handle("collaboration:a2a-agent-card", async () => {
			await syncCollaborationCapabilityCards();
			const { collaborationRuntime } = await import("../collaboration/collaboration-runtime");
			const { createA2ARuntimeFacade } = await import("../collaboration/a2a-runtime-adapter");
			return createA2ARuntimeFacade(collaborationRuntime).getAgentCard();
		});
		ipcMain.handle("collaboration:a2a-task-submit", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "A2A task payload");
			const sender = recordValue(input.sender, "sender");
			const senderIdentity = {
				id: requiredString(sender.id, "sender.id"),
				handle: requiredString(sender.handle, "sender.handle"),
				displayName: requiredString(sender.displayName, "sender.displayName"),
				ownerUserId: requiredString(sender.ownerUserId, "sender.ownerUserId"),
				trustLevel: enumValue(sender.trustLevel, "sender.trustLevel", ["local", "org", "known_peer", "public"] as const),
				status: enumValue(sender.status, "sender.status", ["offline", "idle", "working", "paused"] as const),
				...(sender.organizationId === undefined ? {} : { organizationId: requiredString(sender.organizationId, "sender.organizationId") }),
				...(sender.publicKeyRef === undefined ? {} : { publicKeyRef: requiredString(sender.publicKeyRef, "sender.publicKeyRef") }),
			};
			const request = {
				id: requiredString(input.id, "id"),
				...(input.contextId === undefined ? {} : { contextId: requiredString(input.contextId, "contextId") }),
				skillId: requiredString(input.skillId, "skillId"),
				objective: requiredString(input.objective, "objective"),
				sender: senderIdentity,
				...(input.roomRef === undefined ? {} : { roomRef: requiredString(input.roomRef, "roomRef") }),
				contextRefs: input.contextRefs === undefined ? [] : requiredStringArray(input.contextRefs, "contextRefs"),
				dataScopes: requiredStringArray(input.dataScopes, "dataScopes"),
				allowedActions: input.allowedActions === undefined ? [] : requiredStringArray(input.allowedActions, "allowedActions"),
				...(input.approval === undefined ? {} : { approval: enumValue(input.approval, "approval", ["never", "before_external_commit", "always"] as const) }),
				artifactTypes: requiredStringArray(input.artifactTypes, "artifactTypes"),
				expiresAt: requiredString(input.expiresAt, "expiresAt"),
				...(input.traceId === undefined ? {} : { traceId: requiredString(input.traceId, "traceId") }),
				...(input.nonce === undefined ? {} : { nonce: requiredString(input.nonce, "nonce") }),
				...(input.capabilityToken === undefined ? {} : { capabilityToken: requiredString(input.capabilityToken, "capabilityToken") }),
			};
			const { collaborationRuntime } = await import("../collaboration/collaboration-runtime");
			const { createA2ARuntimeFacade } = await import("../collaboration/a2a-runtime-adapter");
			const result = createA2ARuntimeFacade(collaborationRuntime).submitTask(request);
			return { requestId: result.requestId, runtimeTaskId: result.runtimeTaskId, view: result.view };
		});
		ipcMain.handle("collaboration:a2a-task-get", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "A2A task lookup payload");
			const { collaborationRuntime } = await import("../collaboration/collaboration-runtime");
			const { createA2ARuntimeFacade } = await import("../collaboration/a2a-runtime-adapter");
			return createA2ARuntimeFacade(collaborationRuntime).getTask(requiredString(input.taskId, "taskId"));
		});
		ipcMain.handle("collaboration:federated-grants", async () => (await import("../collaboration/collaboration-runtime")).collaborationRuntime.federatedRoomGrantSnapshot());
		ipcMain.handle("collaboration:federated-grant-issue", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "federated room grant payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.issueFederatedRoomGrant({
				projectId: requiredString(input.projectId, "projectId"),
				roomId: requiredString(input.roomId, "roomId"),
				principalId: requiredString(input.principalId, "principalId"),
				providerOrganizationId: input.providerOrganizationId === undefined ? undefined : requiredString(input.providerOrganizationId, "providerOrganizationId"),
				taskId: input.taskId === undefined ? undefined : requiredString(input.taskId, "taskId"),
				allowedCapabilities: requiredStringArray(input.allowedCapabilities, "allowedCapabilities"),
				allowedDataScopes: requiredStringArray(input.allowedDataScopes, "allowedDataScopes"),
				allowedActions: requiredStringArray(input.allowedActions, "allowedActions"),
				allowedOperations: requiredStringArray(input.allowedOperations, "allowedOperations").map((operation) => enumValue(operation, "allowedOperations", ["endpoint.register", "task.send", "events.query"] as const)),
				expiresAt: requiredString(input.expiresAt, "expiresAt"),
			});
		ipcMain.handle("collaboration:identity-get", async () => {
			const { sharedBuddyIdentityStore } = await import("../casdoor/buddy-identity-store");
			const store = sharedBuddyIdentityStore();
			const file = store.loadOrCreate();
			return { identity: store.toBuddyIdentity(file), file, filePath: store.fileLocation() };
		});
		ipcMain.handle("collaboration:identity-update", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "buddy identity update payload");
			const patch: { handle?: string; displayName?: string; organizationId?: string; status?: "idle" | "working" | "offline" } = {};
			if (input.handle !== undefined) patch.handle = requiredString(input.handle, "handle");
			if (input.displayName !== undefined) patch.displayName = requiredString(input.displayName, "displayName");
			if (input.organizationId !== undefined) patch.organizationId = requiredString(input.organizationId, "organizationId");
			if (input.status !== undefined) patch.status = enumValue(input.status, "status", ["idle", "working", "offline"] as const);
			const { sharedBuddyIdentityStore } = await import("../casdoor/buddy-identity-store");
			const { collaborationRuntime } = await import("../collaboration/collaboration-runtime");
			const updated = sharedBuddyIdentityStore().updateIdentity(patch);
			const identity = collaborationRuntime.updateBuddyIdentity(patch);
			return { identity, file: updated, filePath: sharedBuddyIdentityStore().fileLocation() };
		});
		});
		ipcMain.handle("collaboration:federated-grant-revoke", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "federated room grant revoke payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.revokeFederatedRoomGrant(requiredString(input.grantId, "grantId"));
		});
		ipcMain.handle("collaboration:propose-task", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration task payload");
			const title = requiredString(input.title, "title");
			const objective = requiredString(input.objective, "objective");
			const capability = input.capability === undefined ? undefined : requiredString(input.capability, "capability");
			const roomId = input.roomId === undefined ? undefined : requiredString(input.roomId, "roomId");
			const projectId = input.projectId === undefined ? undefined : requiredString(input.projectId, "projectId");
			const agentRef = input.agentRef === undefined ? undefined : recordValue(input.agentRef, "agentRef");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.proposeTask({ title, objective, capability, roomId, projectId, ...(agentRef ? { agentRef: { type: enumValue(agentRef.type, "agentRef.type", ["expert", "personal-buddy", "organization-buddy", "external-buddy"] as const), id: requiredString(agentRef.id, "agentRef.id") } } : {}) });
		});
		ipcMain.handle("collaboration:propose", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "unified collaboration payload");
			const strings = (value: unknown, name: string): string[] | undefined => value === undefined ? undefined : optionalStringArray(value, name);
			const agentRef = input.agentRef === undefined ? undefined : recordValue(input.agentRef, "agentRef");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.proposeCollaboration({
				mode: enumValue(input.mode, "mode", ["personal", "organization", "network"] as const),
				title: requiredString(input.title, "title"),
				objective: requiredString(input.objective, "objective"),
				capability: input.capability === undefined ? undefined : requiredString(input.capability, "capability"),
				roomId: input.roomId === undefined ? undefined : requiredString(input.roomId, "roomId"),
				projectId: input.projectId === undefined ? undefined : requiredString(input.projectId, "projectId"),
				contextRefs: strings(input.contextRefs, "contextRefs"),
				dataScopes: strings(input.dataScopes, "dataScopes"),
				artifactTypes: strings(input.artifactTypes, "artifactTypes"),
				expiresAt: input.expiresAt === undefined ? undefined : requiredString(input.expiresAt, "expiresAt"),
					providerId: input.providerId === undefined ? undefined : requiredString(input.providerId, "providerId"),
					capabilityInput: input.capabilityInput === undefined ? undefined : recordValue(input.capabilityInput, "capabilityInput"),
					agentRef: agentRef === undefined ? undefined : { type: enumValue(agentRef.type, "agentRef.type", ["expert", "personal-buddy", "organization-buddy", "external-buddy"] as const), id: requiredString(agentRef.id, "agentRef.id") },
					sideEffectIntentId: input.sideEffectIntentId === undefined ? undefined : requiredString(input.sideEffectIntentId, "sideEffectIntentId"),
					sideEffectFingerprint: input.sideEffectFingerprint === undefined ? undefined : requiredString(input.sideEffectFingerprint, "sideEffectFingerprint"),
			});
		});
		ipcMain.handle("collaboration:execute", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration execute payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.executeCollaborationTask(requiredString(input.taskId, "taskId"));
		});
		ipcMain.handle("collaboration:workflow-propose", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "workflow proposal payload");
			if (!Array.isArray(input.nodes)) throw new Error("nodes must be an array");
			const nodes = input.nodes.map((value, index) => {
				const node = recordValue(value, `workflow node ${index}`);
				const agentRef = node.agentRef === undefined ? undefined : recordValue(node.agentRef, `workflow node ${index}.agentRef`);
				const strings = (candidate: unknown, name: string): string[] | undefined => candidate === undefined ? undefined : optionalStringArray(candidate, name);
				return {
					id: requiredString(node.id, "node.id"),
					dependsOn: strings(node.dependsOn, "node.dependsOn"),
					taskId: node.taskId === undefined ? undefined : requiredString(node.taskId, "node.taskId"),
					title: node.title === undefined ? undefined : requiredString(node.title, "node.title"),
					objective: node.objective === undefined ? undefined : requiredString(node.objective, "node.objective"),
					capability: node.capability === undefined ? undefined : requiredString(node.capability, "node.capability"),
					projectId: node.projectId === undefined ? undefined : requiredString(node.projectId, "node.projectId"),
					roomId: node.roomId === undefined ? undefined : requiredString(node.roomId, "node.roomId"),
					contextRefs: strings(node.contextRefs, "node.contextRefs"),
					dataScopes: strings(node.dataScopes, "node.dataScopes"),
					artifactTypes: strings(node.artifactTypes, "node.artifactTypes"),
					capabilityInput: node.capabilityInput === undefined ? undefined : recordValue(node.capabilityInput, "node.capabilityInput"),
					agentRef: agentRef === undefined ? undefined : { type: enumValue(agentRef.type, "node.agentRef.type", ["expert", "personal-buddy", "organization-buddy", "external-buddy"] as const), id: requiredString(agentRef.id, "node.agentRef.id") },
					crossNetwork: node.crossNetwork === undefined ? undefined : Boolean(node.crossNetwork),
					sideEffectIntentId: node.sideEffectIntentId === undefined ? undefined : requiredString(node.sideEffectIntentId, "node.sideEffectIntentId"),
					sideEffectFingerprint: node.sideEffectFingerprint === undefined ? undefined : requiredString(node.sideEffectFingerprint, "node.sideEffectFingerprint"),
				};
			});
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.proposeWorkflow({ title: requiredString(input.title, "title"), mode: enumValue(input.mode, "mode", ["personal", "organization"] as const), projectId: input.projectId === undefined ? undefined : requiredString(input.projectId, "projectId"), nodes });
		});
		ipcMain.handle("collaboration:workflow-execute", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "workflow execute payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.executeWorkflow(requiredString(input.workflowId, "workflowId"));
		});
		ipcMain.handle("collaboration:workflow-status", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "workflow status payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.workflowStatus(requiredString(input.workflowId, "workflowId"));
		});
		ipcMain.handle("collaboration:workflow-control", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "workflow control payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.controlWorkflow({
				workflowId: requiredString(input.workflowId, "workflowId"),
				action: enumValue(input.action, "action", ["pause", "resume", "cancel", "takeover", "revision"] as const),
				reason: input.reason === undefined ? undefined : requiredString(input.reason, "reason"),
			});
		});
		ipcMain.handle("collaboration:ack-inbox", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration inbox ack payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.ackInbox(requiredString(input.eventId, "eventId"));
		});
		ipcMain.handle("collaboration:organization-member", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration organization member payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.addOrganizationMember({
				id: requiredString(input.id, "id"),
				handle: requiredString(input.handle, "handle"),
				displayName: requiredString(input.displayName, "displayName"),
				ownerUserId: requiredString(input.ownerUserId, "ownerUserId"),
				role: input.role === undefined ? undefined : enumValue(input.role, "role", ["owner", "admin", "member", "auditor"] as const),
			});
		});
		ipcMain.handle("collaboration:organization-member-remove", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration organization member removal payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.removeOrganizationMember({ memberId: requiredString(input.memberId, "memberId") });
		});
		ipcMain.handle("collaboration:delegation-grant", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration delegation payload");
			const strings = (value: unknown, name: string): string[] => {
				if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${name} must be an array of strings`);
				return value as string[];
			};
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.grantOrganizationDelegation({
				granteeId: requiredString(input.granteeId, "granteeId"),
				taskId: input.taskId === undefined ? undefined : requiredString(input.taskId, "taskId"),
				roomId: input.roomId === undefined ? undefined : requiredString(input.roomId, "roomId"),
				allowedCapabilities: strings(input.allowedCapabilities, "allowedCapabilities"),
				allowedDataScopes: strings(input.allowedDataScopes, "allowedDataScopes"),
				expiresAt: requiredString(input.expiresAt, "expiresAt"),
			});
		});
		ipcMain.handle("collaboration:room-member-add", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration room member payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.addOrganizationRoomMember({
				roomId: requiredString(input.roomId, "roomId"),
				principalId: requiredString(input.principalId, "principalId"),
				role: input.role === undefined ? undefined : enumValue(input.role, "role", ["member", "observer", "agent"] as const),
			});
		});
		ipcMain.handle("collaboration:room-member-remove", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration room member removal payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.removeOrganizationRoomMember({
				roomId: requiredString(input.roomId, "roomId"),
				principalId: requiredString(input.principalId, "principalId"),
			});
		});
		ipcMain.handle("collaboration:approval-request", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration approval request payload");
			if (!Array.isArray(input.actions) || !input.actions.every((item) => typeof item === "string")) throw new Error("actions must be an array of strings");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.requestApproval({
				taskId: requiredString(input.taskId, "taskId"),
				actions: input.actions as string[],
				reason: requiredString(input.reason, "reason"),
			});
		});
		ipcMain.handle("collaboration:delegation-revoke", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration delegation revoke payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.revokeOrganizationDelegation(requiredString(input.delegationId, "delegationId"));
		});
		ipcMain.handle("collaboration:approval-decide", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration approval payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.decideApproval({
				approvalId: requiredString(input.approvalId, "approvalId"),
				approved: requiredBoolean(input.approved, "approved"),
				reason: input.reason === undefined ? undefined : requiredString(input.reason, "reason"),
			});
		});
		ipcMain.handle("collaboration:side-effect-create", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "side-effect intent payload");
			const runtime = (await import("../collaboration/collaboration-runtime")).collaborationRuntime;
			return runtime.createSideEffectIntent({
				capability: requiredString(input.capability, "capability"),
				action: requiredString(input.action, "action"),
				summary: requiredString(input.summary, "summary"),
				fingerprint: requiredString(input.fingerprint, "fingerprint"),
				resourceId: input.resourceId === undefined ? undefined : requiredString(input.resourceId, "resourceId"),
				taskId: input.taskId === undefined ? undefined : requiredString(input.taskId, "taskId"),
				expiresAt: input.expiresAt === undefined ? undefined : requiredString(input.expiresAt, "expiresAt"),
				approvedByUser: input.approvedByUser === undefined ? undefined : requiredBoolean(input.approvedByUser, "approvedByUser"),
			});
		});
		ipcMain.handle("collaboration:side-effect-approve", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "side-effect approval payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.approveSideEffectIntent(requiredString(input.intentId, "intentId"));
		});
		ipcMain.handle("collaboration:side-effect-complete", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "side-effect completion payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.completeSideEffectIntent(requiredString(input.intentId, "intentId"), input.receipt === undefined ? undefined : requiredString(input.receipt, "receipt"));
		});
		ipcMain.handle("collaboration:side-effect-cancel", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "side-effect cancellation payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.cancelSideEffectIntent(requiredString(input.intentId, "intentId"), input.reason === undefined ? undefined : requiredString(input.reason, "reason"));
		});
		ipcMain.handle("collaboration:task-control", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration task control payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.controlTask({
				taskId: requiredString(input.taskId, "taskId"),
				action: enumValue(input.action, "action", ["pause", "resume", "revoke", "takeover", "revision"] as const),
				reason: input.reason === undefined ? undefined : requiredString(input.reason, "reason"),
			});
		});
		ipcMain.handle("collaboration:network-peer", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration network peer payload");
			const identity = recordValue(input.identity, "identity");
			const capabilities = Array.isArray(input.capabilities) ? input.capabilities : [];
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.registerNetworkPeer({
				identity: {
					id: requiredString(identity.id, "identity.id"),
					handle: requiredString(identity.handle, "identity.handle"),
					displayName: requiredString(identity.displayName, "identity.displayName"),
					ownerUserId: requiredString(identity.ownerUserId, "identity.ownerUserId"),
					organizationId: identity.organizationId === undefined ? undefined : requiredString(identity.organizationId, "identity.organizationId"),
					...(identity.publicKeyRef === undefined ? {} : { publicKeyRef: requiredString(identity.publicKeyRef, "identity.publicKeyRef") }),
					trustLevel: enumValue(identity.trustLevel, "identity.trustLevel", ["local", "org", "known_peer", "public"] as const),
					status: enumValue(identity.status, "identity.status", ["offline", "idle", "working", "paused"] as const),
				},
					capabilities: capabilities as import("@openbuddy/collaboration-protocol").BuddyCapability[],
					agentCard: input.agentCard === undefined ? undefined : input.agentCard as import("@openbuddy/collaboration-protocol").BuddyAgentCard,
			});
		});
		ipcMain.handle("collaboration:network-trust", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration network trust payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.setNetworkPeerTrust(requiredString(input.peerId, "peerId"), enumValue(input.trust, "trust", ["pending", "known", "trusted", "blocked", "revoked"] as const));
		});
		ipcMain.handle("collaboration:network-trust-root-add", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration trust root payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.addAgentCardTrustRoot(requiredString(input.publicKeyPem, "publicKeyPem"));
		});
		ipcMain.handle("collaboration:network-trust-root-revoke", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration trust root revoke payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.revokeAgentCardTrustRoot(requiredString(input.keyRef, "keyRef"));
		});
		ipcMain.handle("collaboration:network-offer", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration network offer payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.networkPublishOffer({
				providerId: requiredString(input.providerId, "providerId"), capabilityId: requiredString(input.capabilityId, "capabilityId"), title: requiredString(input.title, "title"), description: requiredString(input.description, "description"),
				acceptedDataScopes: requiredStringArray(input.acceptedDataScopes, "acceptedDataScopes"), acceptedArtifactTypes: requiredStringArray(input.acceptedArtifactTypes, "acceptedArtifactTypes"), approval: enumValue(input.approval, "approval", ["never", "before_external_commit", "always"] as const), validUntil: requiredString(input.validUntil, "validUntil"), visibility: enumValue(input.visibility, "visibility", ["known_peers", "directory"] as const),
			});
		});
		ipcMain.handle("collaboration:network-proposal", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration network proposal payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.networkProposeService({ capabilityId: requiredString(input.capabilityId, "capabilityId"), objective: requiredString(input.objective, "objective"), dataScopes: requiredStringArray(input.dataScopes, "dataScopes"), ...(input.allowedActions === undefined ? {} : { allowedActions: requiredStringArray(input.allowedActions, "allowedActions") }), artifactTypes: requiredStringArray(input.artifactTypes, "artifactTypes"), expiresAt: requiredString(input.expiresAt, "expiresAt") });
		});
		ipcMain.handle("collaboration:network-negotiate", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration capability negotiation payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.networkNegotiateCapability({ offerId: requiredString(input.offerId, "offerId"), proposalId: requiredString(input.proposalId, "proposalId"), providerId: requiredString(input.providerId, "providerId") });
		});
		ipcMain.handle("collaboration:network-agreement-revoke", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration agreement revoke payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.networkRevokeCapabilityAgreement(requiredString(input.agreementId, "agreementId"), requiredString(input.reason, "reason"));
		});
		ipcMain.handle("collaboration:network-bid", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration network bid payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.networkSubmitBid({ offerId: requiredString(input.offerId, "offerId"), proposalId: requiredString(input.proposalId, "proposalId"), providerId: requiredString(input.providerId, "providerId"), message: requiredString(input.message, "message"), acceptedDataScopes: requiredStringArray(input.acceptedDataScopes, "acceptedDataScopes"), validUntil: requiredString(input.validUntil, "validUntil") });
		});
		ipcMain.handle("collaboration:network-award", async (_event, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "collaboration network award payload");
			return (await import("../collaboration/collaboration-runtime")).collaborationRuntime.networkAwardBid(requiredString(input.bidId, "bidId"));
		});
		ipcMain.handle("collaboration:network-retry", async () => (await import("../collaboration/collaboration-runtime")).collaborationRuntime.retryPendingNetworkDeliveries());
	async function syncCollaborationCapabilityCards(): Promise<Awaited<ReturnType<typeof agentHost.resourceInventory>>> {
		const { collaborationRuntime } = await import("../collaboration/collaboration-runtime");
		const resources = await agentHost.resourceInventory();
		collaborationRuntime.setCapabilityCards([
			...resources.skills.map((entry: any) => ({ id: `pi-skill:${entry.name}`, name: entry.name, source: "pi-skill" as const, visibility: "local" as const, status: "available" as const, contract: { input: "context-refs" as const, output: "artifact-or-message" as const, approval: "before-external-commit" as const } })),
			...resources.extensions.map((entry: any) => ({ id: `pi-extension:${entry.id}`, name: entry.name, source: "pi-extension" as const, visibility: entry.sourceScope === "project" ? "organization" as const : "local" as const, status: entry.health === "failed" ? "degraded" as const : "available" as const, contract: { input: "context-refs" as const, output: "artifact-or-message" as const, approval: "before-external-commit" as const } })),
			...resources.prompts.map((entry: any) => ({ id: `prompt:${entry.name}`, name: entry.name, source: "prompt" as const, visibility: "local" as const, status: "available" as const, contract: { input: "context-refs" as const, output: "artifact-or-message" as const, approval: "before-external-commit" as const } })),
		]);
		return resources;
	}
}
