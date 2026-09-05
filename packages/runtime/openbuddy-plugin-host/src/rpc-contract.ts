/**
 * DeepSeek Harness-compatible RPC contract shared by Main, Renderer and
 * plugin remotes.  Transport adapters may carry these values over IPC,
 * HTTP, WebSocket or an in-process call; the logical contract is identical.
 */

export type RpcId = string & { readonly __brand: "rpc-id" };

export function RpcId(value: string): RpcId {
	if (!value.trim()) throw new Error("rpc id must be a non-empty string");
	return value as RpcId;
}

export function createRpcId(prefix = "openbuddy"): RpcId {
	return RpcId(`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
}

export type RpcIssue = {
	path: readonly (string | number)[];
	message: string;
};

export type RpcErrorCode =
  | "bad-request"
  | "ambiguous-endpoint"
  | "binding-invalid"
  | "cancelled"
  | "connection-lost"
  | "context-failed"
  | "context-not-found"
  | "context-unavailable"
  | "definition-unavailable"
	| "session-not-found"
	| "workspace-not-found"
	| "workspace-invalid-path"
	| "workspace-move-invalid"
	| "workspace-name-conflict"
	| "agent-busy"
	| "command-error"
	| "unknown-command"
	| "remote-invalid"
	| "endpoint-not-registered"
	| "method-unavailable"
	| "service-unavailable"
	| "context-unavailable"
	| "context-not-found"
	| "context-failed"
	| "invocation-unavailable"
	| "lookup-unavailable"
	| "lookup-not-found"
  | "arguments-invalid"
  | "input-invalid"
  | "invocation-unavailable"
  | "lookup-failed"
  | "lookup-not-found"
  | "lookup-unavailable"
  | "package-invalid"
  | "provider-mismatch"
  | "result-invalid"
  | "signature-invalid"
  | "rpc-uncertain"
	| "rpc-revision-conflict"
	| "provider_unavailable"
	| "confirmation_required"
	| "invalid_input"
	| "operation_failed"
	| "operation_not_supported"
	| "recovery-claim-conflict"
	| "recovery-authority-invalid"
	| "recovery-token-invalid"
	| "recovery-state-invalid"
	| "SESSION_QUERY_ABORTED"
	| "SESSION_QUERY_INVALID_CURSOR"
	| "SESSION_QUERY_INVALID_FILTER"
	| "SESSION_QUERY_INVALID_LIMIT"
	| "SESSION_QUERY_INVALID_QUERY"
	| "SESSION_QUERY_INVALID_WINDOW"
	| "SESSION_QUERY_EVENT_NOT_FOUND"
	| "SESSION_QUERY_SESSION_NOT_FOUND"
	| "SESSION_QUERY_WORKSPACE_NOT_FOUND"
	| "SESSION_QUERY_WORKSPACE_AUTHORIZATION_UNAVAILABLE"
  | "SESSION_QUERY_INVALID_SURFACE"
  | "SESSION_QUERY_INVALID_LINEAGE"
  | "SESSION_QUERY_STALE_CURSOR"
	| "internal";

export type RpcErrorDetails = {
	issues?: readonly RpcIssue[];
	endpoint?: string;
	field?: string;
	[key: string]: unknown;
};

export type RpcError = {
	code: RpcErrorCode;
	message: string;
	details: RpcErrorDetails;
};

export type RpcResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: RpcError };

export interface RpcRequest<P> {
	rpcId: RpcId;
	payload: P;
}

export interface RpcResponse<T> {
	rpcId: RpcId;
	result: RpcResult<T>;
}

export interface ClientRequest {
	type: "client-request";
	rpcId: RpcId;
	method: string;
	payload: unknown;
}

export const replayableRpcMethods = [
  "host.describe",
  "typert.catalog",
	"plugin.snapshot",
	"session.list",
	"session.search",
	"session.history",
	"session.surface",
	"session.traceEvent",
	"session.readEvent",
	"workspace.list",
	"llm.providers",
	"llm.models",
] as const;

export function isReplayableRpcMethod(method: string): boolean {
	return (replayableRpcMethods as readonly string[]).includes(method);
}

function stableRpcValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableRpcValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => [key, stableRpcValue(entry)]));
}

export function rpcRequestFingerprint(request: Pick<ClientRequest, "method" | "payload">): string {
	return JSON.stringify({ method: request.method, payload: stableRpcValue(request.payload) });
}

export interface ServerResponse {
	type: "server-response";
	rpcId: RpcId;
	result: RpcResult<unknown>;
}

export interface ServerRequest {
	type: "server-request";
	rpcId: RpcId;
	method: string;
	payload: unknown;
}

export interface ClientResponse {
	type: "client-response";
	rpcId: RpcId;
	result: RpcResult<unknown>;
}

export type RpcMessage = ClientRequest | ServerResponse | ServerRequest | ClientResponse;

export type RpcReceipt =
	| { accepted: true }
	| { accepted: false; reason: "not-pending" | "bad-response" };

export type RpcMethodMap = Record<string, { request: unknown; response: unknown }>;

export interface OpenBuddyRpcMethodMap extends RpcMethodMap {
	"host.describe": { request: Record<string, never>; response: { product: string; runtime: string; pluginHost: string } };
	"host.pickDirectory": { request: Record<string, never>; response: { path: string | null } };
	"host.listDirectory": { request: { path?: string }; response: { path: string; home: string; crumbs: readonly unknown[]; entries: readonly unknown[]; truncated: boolean } };
	"host.createDirectory": { request: { path: string; name: string }; response: { path: string } };
	"host.openPath": { request: { path: string }; response: { opened: true } };
	"typert.catalog": { request: Record<string, never>; response: { packages: readonly unknown[]; diagnostics: readonly unknown[] } };
	"plugin.snapshot": { request: Record<string, never>; response: unknown };
	"deepseek-cordis.snapshot": { request: Record<string, never>; response: unknown };
	"deepseek-pi.describe": { request: Record<string, never>; response: { protocol: "openbuddy.pi.v1"; runtime: "pi"; capabilities: Record<string, readonly string[]> } };
	"deepseek-cordis.invoke": { request: { service: string; method: string; args?: readonly unknown[] | Record<string, unknown>; parameters?: readonly string[] }; response: unknown };
	"session.list": { request: { cwd?: string }; response: { items: readonly unknown[] } };
	"session.search": { request: { query: string; cwd?: string; limit?: number }; response: { items: readonly unknown[]; hasMore: boolean } };
	"session.fork": { request: { sessionId: string; cwd?: string; atSeq?: number; increaseTitle?: boolean }; response: { sessionId: string } };
	"session.rename": { request: { sessionId: string; title: string; cwd?: string }; response: { title: string; seq?: number } };
	"session.create": { request: { workspaceId?: string; cwd?: string; modelId?: string }; response: { sessionId?: string; sessionFile?: string; cwd: string } };
	"session.history": { request: { sessionId: string; beforeSeq?: number; maxMessages?: number }; response: { entries: readonly unknown[]; hasMore: boolean; projections?: { asOfSeq: number; values: Readonly<Record<string, unknown>> } } };
	"subagent.list": { request: { parentSessionId: string }; response: { entries: readonly unknown[]; parentAvailable: boolean } };
	"subagent.history": { request: { parentSessionId: string; childSessionId: string; mode: "one-shot" | "continuable"; beforeSeq?: number; maxMessages?: number }; response: { events: readonly unknown[]; hasMore: boolean; projections?: unknown } };
	"subagent.prompt": { request: { parentSessionId: string; childSessionId: string; mode: "continuable"; content: readonly unknown[]; clientTimeZone?: string }; response: { messageId: string } };
	"subagent.interrupt": { request: { parentSessionId: string; childSessionId: string; mode: "continuable" }; response: { accepted: true } };
	"session.attachment": { request: { sessionId: string; attachmentId: string }; response: { attachment: unknown; data: string } };
	"session.updateQueue": { request: { sessionId: string; itemId: string; action: unknown }; response: { accepted: true } };
	"agent.event-log": { request: { sessionId?: string; sinceSequence?: number; limit?: number }; response: readonly unknown[] };
	"session.surface": { request: { sessionId: string }; response: unknown };
	"session.traceEvent": { request: { sessionId: string; seq: number }; response: unknown };
	"session.readEvent": { request: { sessionId: string; seq: number; before?: number; after?: number }; response: unknown };
	"session.prompt": { request: { sessionId: string; text?: string; content?: readonly unknown[]; mode?: "queue" | "steer" }; response: { accepted: true; itemId?: string } };
	"session.cancel": { request: { sessionId: string }; response: unknown };
	"session.selectModel": { request: { sessionId: string; modelId: string }; response: unknown };
	"capability.email": { request: { action: string; [key: string]: unknown }; response: unknown };
	"capability.collaboration": { request: { action: "snapshot" | "propose-task" | "ack-inbox"; [key: string]: unknown }; response: unknown };
	"capability.plugins": { request: { action: "list" | "inventory" | "readiness" | "reload" | "set-enabled"; [key: string]: unknown }; response: unknown };
	"capability.collaboration-admin": { request: { action: string; [key: string]: unknown }; response: unknown };
	"capability.clipboard": { request: { action: "read" | "write"; text?: string }; response: string | { written: true } };
	"llm.providers": { request: Record<string, never>; response: { providers: readonly unknown[] } };
	"llm.models": { request: Record<string, never>; response: { groups: readonly unknown[]; failures: readonly unknown[] } };
	"workspace.list": { request: Record<string, never>; response: { items: readonly unknown[] } };
	"workspace.create": { request: { path: string; title?: string }; response: { workspace: unknown; created: boolean } };
	"workspace.rename": { request: { workspaceId: string; title: string }; response: { workspace: unknown } };
	"workspace.delete": { request: { workspaceId: string }; response: { deleted: boolean } };
	"workspace.insertBefore": { request: { workspaceId: string; beforeWorkspaceId?: string }; response: { workspaceIds: readonly string[] } };
	"workspace.insertSessionBefore": { request: { workspaceId: string; sessionId: string; beforeSessionId?: string }; response: { workspace: unknown } };
	"workspace.archiveSession": { request: { sessionId: string; archived?: boolean }; response: { archivedSessionIds: readonly string[] } };
	"recovery.list": { request: Record<string, never>; response: { intents: readonly unknown[] } };
	"recovery.claim": { request: { rpcId: string; claimant: string }; response: unknown };
	"recovery.resolve": { request: { rpcId: string; token: string; action: "committed" | "aborted" }; response: unknown };
	"remote.invoke": { request: Record<string, unknown>; response: unknown };
	"session.event": { request: unknown; response: { accepted: true } };
	"plugin.event": { request: unknown; response: { accepted: true } };
	"session.permission": { request: unknown; response: { optionId?: string; cancelled?: boolean } };
	"session.question": { request: unknown; response: { answers?: Record<string, string | string[]>; annotations?: Record<string, { preview?: string; notes?: string }>; cancelled?: boolean } };
}

export type RpcMethod = keyof RpcMethodMap & string;

export type RpcHandler<M extends RpcMethodMap, K extends keyof M & string> = (payload: M[K]["request"]) => M[K]["response"] | Promise<M[K]["response"]>;

export class RpcMethodRegistry<M extends RpcMethodMap = OpenBuddyRpcMethodMap> {
	private readonly handlers = new Map<string, (payload: unknown) => unknown | Promise<unknown>>();

	register<K extends keyof M & string>(method: K, handler: RpcHandler<M, K>): () => void {
		if (!method.trim()) throw new Error("RPC method must be non-empty");
		if (this.handlers.has(method)) throw new Error(`RPC method is already registered: ${method}`);
		this.handlers.set(method, handler as (payload: unknown) => unknown | Promise<unknown>);
		return () => { if (this.handlers.get(method) === handler) this.handlers.delete(method); };
	}

	async dispatch(message: ServerRequest): Promise<ClientResponse> {
		const handler = this.handlers.get(message.method);
		const result = handler
			? await Promise.resolve().then(() => handler(message.payload)).then(rpcValue, (error) => rpcError(error))
			: rpcError({ message: `RPC method is unavailable: ${message.method}` }, "method-unavailable", { method: message.method });
		return { type: "client-response", rpcId: message.rpcId, result };
	}
}

export type RpcTransport = (message: RpcMessage) => void | Promise<void>;

export class RpcProtocolError extends Error {
	readonly code: RpcErrorCode = "bad-request";
	readonly details: RpcErrorDetails;

	constructor(message: string, details: RpcErrorDetails = {}) {
		super(message);
		this.name = "RpcProtocolError";
		this.details = details;
	}
}

function validationIssue(path: string, message: string): RpcIssue {
	return { path: path ? path.split(".") : [], message };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/**
 * Validate the stable OpenBuddy/DeepSeek request surface before dispatch.
 * Dynamic `remote.invoke` and unknown connection endpoints intentionally stay
 * open for generated Harness plugins; only the built-in typed methods use this
 * strict wire boundary.
 */
export function validateRpcRequestPayload(method: string, payload: unknown): void {
	const fields: Record<string, readonly string[]> = {
		"host.describe": [],
		"host.pickDirectory": [],
		"host.listDirectory": ["path"],
		"host.createDirectory": ["path", "name"],
		"host.openPath": ["path"],
		"typert.catalog": [],
		"plugin.snapshot": [],
		"deepseek-pi.describe": [],
		"session.list": ["cwd"],
		"session.search": ["query", "cwd", "limit"],
		"session.fork": ["sessionId", "cwd", "atSeq", "increaseTitle"],
		"session.rename": ["sessionId", "title", "cwd"],
		"session.create": ["workspaceId", "cwd", "modelId"],
		"agent.event-log": ["sessionId", "sinceSequence", "limit"],
		"agent.extensions-reload": [],
		"pi.extensions.reload": [],
		"session.history": ["sessionId", "beforeSeq", "maxMessages"],
		"subagent.list": ["parentSessionId"],
		"subagent.history": ["parentSessionId", "childSessionId", "mode", "beforeSeq", "maxMessages"],
		"subagent.prompt": ["parentSessionId", "childSessionId", "mode", "content", "clientTimeZone"],
		"subagent.interrupt": ["parentSessionId", "childSessionId", "mode"],
		"session.attachment": ["sessionId", "attachmentId"],
		"session.updateQueue": ["sessionId", "itemId", "action"],
		"session.surface": ["sessionId"],
		"session.traceEvent": ["sessionId", "seq"],
		"session.readEvent": ["sessionId", "seq", "before", "after"],
		"session.prompt": ["sessionId", "text", "content", "mode"],
		"session.cancel": ["sessionId"],
		"session.selectModel": ["sessionId", "modelId"],
		"capability.email": ["action", "accountId", "threadId", "threadIds", "messageDate", "kind", "labelId", "value", "dryRun", "sampleLimit", "confirmed", "to", "cc", "bcc", "subject", "body", "attachments", "draftId", "confirmationToken", "scheduledAt", "scheduleId", "planId", "ruleId", "name", "enabled", "condition", "operations", "expiresInMs", "analysisId", "actionIndexes", "rationale", "query", "folder", "unread", "hasAttachment", "limit", "cursor", "tags", "tagMatch", "from", "until", "since", "senderEmail", "policy", "channelId", "message", "description", "remindAt", "projectId", "messageId", "attachmentId", "destinationDir", "confidence", "summary", "facts", "actions", "risks", "replyDraft", "meetingProposal", "linkedDraftId", "linkedReminderId", "linkedReminderIds", "linkedTaskControlId", "linkedTaskIds", "linkedProjectTaskIds", "linkedCalendarTaskId", "linkedCalendarEventId", "review", "reviewNote"],
		"capability.collaboration": ["action", "title", "objective", "capability", "roomId", "eventId"],
		"capability.plugins": ["action", "id", "enabled"],
		"capability.collaboration-admin": ["action", "mode", "title", "objective", "capability", "projectId", "id", "handle", "displayName", "ownerUserId", "role", "roomId", "principalId", "granteeId", "taskId", "allowedCapabilities", "allowedDataScopes", "expiresAt", "delegationId", "actions", "reason", "approvalId", "approved", "control", "workflowId", "nodes", "identity", "capabilities", "agentCard", "peerId", "trust", "publicKeyPem", "keyRef", "providerId", "capabilityId", "description", "acceptedDataScopes", "acceptedArtifactTypes", "approval", "validUntil", "visibility", "offerId", "proposalId", "message", "bidId", "sender", "skillId", "contextId", "contextRefs", "dataScopes", "allowedActions", "artifactTypes", "nonce", "traceId", "capabilityToken", "recipient"],
		"capability.clipboard": ["action", "text"],
		"llm.providers": [],
		"llm.models": [],
		"workspace.list": [],
		"workspace.create": ["path", "title"],
		"workspace.rename": ["workspaceId", "title"],
		"workspace.delete": ["workspaceId"],
		"workspace.insertBefore": ["workspaceId", "beforeWorkspaceId"],
		"workspace.insertSessionBefore": ["workspaceId", "sessionId", "beforeSessionId"],
		"workspace.archiveSession": ["sessionId", "archived"],
		"recovery.list": [],
		"recovery.claim": ["rpcId", "claimant"],
		"recovery.resolve": ["rpcId", "token", "action"],
	};
	const allowed = fields[method];
	if (allowed === undefined) return;
	const issues: RpcIssue[] = [];
	if (!isPlainRecord(payload)) {
		throw new RpcProtocolError("RPC payload must be a plain object", { issues: [validationIssue("", "must be a plain object")] });
	}
	const allowedSet = new Set(allowed);
	for (const key of Object.keys(payload)) {
		if (!allowedSet.has(key)) issues.push(validationIssue(key, "unknown field"));
	}
	const requiredStrings: Record<string, readonly string[]> = {
		"recovery.claim": ["rpcId", "claimant"],
		"recovery.resolve": ["rpcId", "token", "action"],
		"host.createDirectory": ["path", "name"],
		"host.openPath": ["path"],
		"session.search": ["query"],
		"session.fork": ["sessionId"],
		"session.rename": ["sessionId", "title"],
		"session.history": ["sessionId"],
		"subagent.list": ["parentSessionId"],
		"subagent.history": ["parentSessionId", "childSessionId", "mode"],
		"subagent.prompt": ["parentSessionId", "childSessionId", "mode"],
		"subagent.interrupt": ["parentSessionId", "childSessionId", "mode"],
		"session.attachment": ["sessionId", "attachmentId"],
		"session.updateQueue": ["sessionId", "itemId"],
		"session.surface": ["sessionId"],
		"session.traceEvent": ["sessionId"],
		"session.readEvent": ["sessionId"],
		"session.prompt": ["sessionId"],
		"session.cancel": ["sessionId"],
		"session.selectModel": ["sessionId", "modelId"],
		"workspace.create": ["path"],
		"workspace.rename": ["workspaceId", "title"],
		"workspace.delete": ["workspaceId"],
		"workspace.insertBefore": ["workspaceId"],
		"workspace.insertSessionBefore": ["workspaceId", "sessionId"],
		"workspace.archiveSession": ["sessionId"],
	};
	for (const key of requiredStrings[method] ?? []) {
		if (typeof payload[key] !== "string" || payload[key].trim() === "") issues.push(validationIssue(key, "must be a non-empty string"));
	}
	const optionalStrings: Record<string, readonly string[]> = {
		"session.list": ["cwd"],
		"session.create": ["cwd", "modelId"],
		"session.search": ["cwd"],
		"session.fork": ["cwd"],
		"session.rename": ["cwd"],
		"workspace.create": ["title"],
		"workspace.rename": [],
		"workspace.insertBefore": ["beforeWorkspaceId"],
		"workspace.insertSessionBefore": ["beforeSessionId"],
		"workspace.archiveSession": [],
		"agent.event-log": ["sessionId"],
	};
	for (const key of optionalStrings[method] ?? []) {
		if (payload[key] !== undefined && (typeof payload[key] !== "string" || payload[key].trim() === "")) issues.push(validationIssue(key, "must be a non-empty string when provided"));
	}
	if (method === "session.history") {
		for (const key of ["beforeSeq", "maxMessages"] as const) {
			if (payload[key] !== undefined && (!Number.isSafeInteger(payload[key]) || (payload[key] as number) < 0)) issues.push(validationIssue(key, "must be a non-negative safe integer when provided"));
		}
		if (payload.maxMessages !== undefined && (!Number.isSafeInteger(payload.maxMessages) || (payload.maxMessages as number) < 1)) issues.push(validationIssue("maxMessages", "must be a positive safe integer when provided"));
	}
	if (method === "subagent.history") {
		for (const key of ["beforeSeq", "maxMessages"] as const) {
			if (payload[key] !== undefined && (!Number.isSafeInteger(payload[key]) || (payload[key] as number) < 0)) issues.push(validationIssue(key, "must be a non-negative safe integer when provided"));
		}
		if (payload.maxMessages !== undefined && (!Number.isSafeInteger(payload.maxMessages) || (payload.maxMessages as number) < 1)) issues.push(validationIssue("maxMessages", "must be a positive safe integer when provided"));
	}
	if ((method === "subagent.history" || method === "subagent.prompt" || method === "subagent.interrupt") && payload.mode !== "one-shot" && payload.mode !== "continuable") issues.push(validationIssue("mode", "must be one-shot or continuable"));
	if (method === "subagent.prompt") {
		if (payload.mode !== "continuable") issues.push(validationIssue("mode", "must be continuable"));
		if (!Array.isArray(payload.content) || payload.content.length === 0) issues.push(validationIssue("content", "must be a non-empty array"));
	}
	if (method === "subagent.interrupt" && payload.mode !== "continuable") issues.push(validationIssue("mode", "must be continuable"));
	if (method === "session.updateQueue") {
		if (!isPlainRecord(payload.action) || !["edit", "remove", "steer"].includes(payload.action.kind as string)) {
			issues.push(validationIssue("action.kind", "must be edit, remove, or steer"));
		} else if (payload.action.kind === "edit" && (!Array.isArray(payload.action.content) || payload.action.content.length === 0)) {
			issues.push(validationIssue("action.content", "must be a non-empty content array for edit"));
		}
	}
	if (method === "session.fork" && payload.atSeq !== undefined && (!Number.isSafeInteger(payload.atSeq) || (payload.atSeq as number) < 0)) {
		issues.push(validationIssue("atSeq", "must be a non-negative safe integer when provided"));
	}
	if (method === "session.fork" && payload.increaseTitle !== undefined && typeof payload.increaseTitle !== "boolean") {
		issues.push(validationIssue("increaseTitle", "must be boolean when provided"));
	}
	if (method === "agent.event-log") {
		for (const key of ["sinceSequence", "limit"] as const) {
			if (payload[key] !== undefined && (!Number.isSafeInteger(payload[key]) || (payload[key] as number) < 0)) issues.push(validationIssue(key, "must be a non-negative safe integer when provided"));
		}
	}
	if (method === "session.search" && payload.limit !== undefined && (!Number.isSafeInteger(payload.limit) || (payload.limit as number) < 1)) {
		issues.push(validationIssue("limit", "must be a positive safe integer when provided"));
	}
	if (method === "workspace.archiveSession" && payload.archived !== undefined && typeof payload.archived !== "boolean") {
		issues.push(validationIssue("archived", "must be boolean when provided"));
	}
	if (method === "session.prompt" && payload.mode !== undefined && payload.mode !== "queue" && payload.mode !== "steer") {
		issues.push(validationIssue("mode", "must be queue or steer when provided"));
	}
	if (method === "session.prompt") {
		const hasText = typeof payload.text === "string" && payload.text.trim() !== "";
		const hasContent = Array.isArray(payload.content) && payload.content.length > 0;
		if (!hasText && !hasContent) issues.push(validationIssue("content", "must include non-empty text or content"));
		if (payload.text !== undefined && (typeof payload.text !== "string" || payload.text.trim() === "")) issues.push(validationIssue("text", "must be non-empty when provided"));
		if (Array.isArray(payload.content)) {
			for (const [index, part] of payload.content.entries()) {
				if (!isPlainRecord(part) || (part.type !== "text" && part.type !== "image")) {
					issues.push(validationIssue(`content.${index}`, "must be a text or image part"));
					continue;
				}
				if (part.type === "text" && (typeof part.text !== "string" || part.text.trim() === "")) issues.push(validationIssue(`content.${index}.text`, "must be a non-empty string"));
				if (part.type === "image" && (typeof part.mediaType !== "string" || !part.mediaType.trim() || typeof part.data !== "string" || !part.data.trim())) issues.push(validationIssue(`content.${index}`, "image requires non-empty mediaType and data"));
			}
		}
	}
	if (method === "host.createDirectory" && (payload.name === "." || payload.name === ".." || /[\\/]/.test(payload.name as string))) {
		issues.push(validationIssue("name", "must be a single non-blank path segment"));
	}
	if (method === "session.traceEvent" || method === "session.readEvent") {
		for (const key of ["seq", "before", "after"] as const) {
			if (payload[key] !== undefined && (!Number.isSafeInteger(payload[key]) || (payload[key] as number) < 0)) issues.push(validationIssue(key, "must be a non-negative safe integer when provided"));
		}
	}
	if (issues.length > 0) throw new RpcProtocolError("RPC payload failed validation", { issues });
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function parseRpcMessage(value: unknown): RpcMessage {
	const message = objectValue(value);
	if (!message || typeof message.type !== "string" || typeof message.rpcId !== "string" || !message.rpcId.trim()) {
		throw new RpcProtocolError("RPC message must contain a non-empty type and rpcId");
	}
	const rpcId = RpcId(message.rpcId);
	if (message.type === "client-request" || message.type === "server-request") {
		if (typeof message.method !== "string" || !message.method.trim() || !("payload" in message)) {
			throw new RpcProtocolError(`${message.type} must contain method and payload`);
		}
		return { type: message.type, rpcId, method: message.method, payload: message.payload };
	}
	if (message.type === "server-response" || message.type === "client-response") {
		if (!isRpcResult(message.result)) throw new RpcProtocolError(`${message.type} must contain a valid result`);
		return { type: message.type, rpcId, result: message.result };
	}
	throw new RpcProtocolError(`unknown RPC message type: ${message.type}`);
}

export function isRpcMessage(value: unknown): value is RpcMessage {
	try {
		parseRpcMessage(value);
		return true;
	} catch {
		return false;
	}
}

type PendingCall = {
	resolve: (result: RpcResult<unknown>) => void;
	timer: ReturnType<typeof setTimeout>;
	cleanup: () => void;
};

export class PendingRpcChannel {
	private readonly pending = new Map<RpcId, PendingCall>();
	private readonly handlers = new Map<string, (payload: unknown) => unknown | Promise<unknown>>();
	private readonly serverRequestResults = new Map<RpcId, Promise<RpcResult<unknown>>>();
	private readonly completedServerResponses = new Map<RpcId, { result: RpcResult<unknown>; timer: ReturnType<typeof setTimeout> }>();

	constructor(private readonly send: RpcTransport, private readonly timeoutMs = 30_000) {
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("RPC timeout must be a positive integer");
	}

	on(method: string, handler: (payload: unknown) => unknown | Promise<unknown>): () => void {
		if (!method.trim()) throw new Error("RPC method must be non-empty");
		if (this.handlers.has(method)) throw new Error(`RPC method is already registered: ${method}`);
		this.handlers.set(method, handler);
		return () => { if (this.handlers.get(method) === handler) this.handlers.delete(method); };
	}

	request(method: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult<unknown>> {
		if (!method.trim()) return Promise.resolve(rpcError(new RpcProtocolError("RPC request method must be non-empty"), "bad-request"));
		if (signal?.aborted) return Promise.resolve(rpcError(Object.assign(new Error("RPC request was cancelled"), { code: "cancelled" }), "cancelled"));
		const rpcId = createRpcId("rpc");
		return new Promise<RpcResult<unknown>>((resolve) => {
			let abort: (() => void) | undefined;
			const cleanup = () => {
				if (abort) signal?.removeEventListener("abort", abort);
			};
			const timer = setTimeout(() => {
				const pending = this.pending.get(rpcId);
				if (!pending) return;
				this.pending.delete(rpcId);
				pending.cleanup();
				resolve(rpcError(new Error(`RPC request timed out: ${method}`), "internal", { method }));
			}, this.timeoutMs);
			this.pending.set(rpcId, { resolve, timer, cleanup });
			abort = () => {
				const pending = this.pending.get(rpcId);
				if (!pending) return;
				clearTimeout(pending.timer);
				this.pending.delete(rpcId);
				pending.cleanup();
				resolve(rpcError(Object.assign(new Error("RPC request was cancelled"), { code: "cancelled" }), "cancelled", { method }));
			};
			signal?.addEventListener("abort", abort, { once: true });
			void Promise.resolve(this.send({ type: "client-request", rpcId, method, payload })).catch((error) => {
				const pending = this.pending.get(rpcId);
				if (!pending) return;
				clearTimeout(pending.timer);
				this.pending.delete(rpcId);
				pending.cleanup();
				resolve(rpcError(error, "internal", { method }));
			});
		});
	}

	async receive(value: unknown): Promise<RpcReceipt> {
		let message: RpcMessage;
		try { message = parseRpcMessage(value); } catch { return { accepted: false, reason: "bad-response" }; }
		if (message.type === "server-response") {
			const pending = this.pending.get(message.rpcId);
			if (!pending) return { accepted: false, reason: "not-pending" };
			clearTimeout(pending.timer);
			this.pending.delete(message.rpcId);
			pending.cleanup();
			pending.resolve(message.result);
			return { accepted: true };
		}
		if (message.type !== "server-request") return { accepted: false, reason: "bad-response" };
		const completed = this.completedServerResponses.get(message.rpcId);
		if (completed) {
			await this.send({ type: "client-response", rpcId: message.rpcId, result: completed.result });
			return { accepted: true };
		}
		let resultPromise = this.serverRequestResults.get(message.rpcId);
		if (!resultPromise) {
			const handler = this.handlers.get(message.method);
			const handlerResult = handler
				? Promise.resolve().then(() => handler(message.payload)).then(rpcValue, (error) => rpcError(error))
				: Promise.resolve(rpcError({ message: `RPC method is unavailable: ${message.method}` }, "method-unavailable", { method: message.method }));
			resultPromise = new Promise<RpcResult<unknown>>((resolve) => {
				let settled = false;
				const timer = setTimeout(() => {
					if (settled) return;
					settled = true;
					resolve(rpcError(new Error(`RPC server request timed out: ${message.method}`), "internal", { method: message.method }));
				}, this.timeoutMs);
				timer.unref?.();
				void handlerResult.then((result) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					resolve(result);
				});
			});
			this.serverRequestResults.set(message.rpcId, resultPromise);
			void resultPromise.then((result) => {
				this.serverRequestResults.delete(message.rpcId);
				const timer = setTimeout(() => this.completedServerResponses.delete(message.rpcId), this.timeoutMs);
				timer.unref?.();
				this.completedServerResponses.set(message.rpcId, { result, timer });
			});
		}
		const result = await resultPromise;
		await this.send({ type: "client-response", rpcId: message.rpcId, result });
		return { accepted: true };
	}

	dispose(): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.cleanup();
			pending.resolve(rpcError(new Error("RPC channel disposed"), "internal"));
		}
		this.pending.clear();
		for (const response of this.completedServerResponses.values()) clearTimeout(response.timer);
		this.completedServerResponses.clear();
		this.serverRequestResults.clear();
		this.handlers.clear();
	}
}

export function rpcValue<T>(value: T): RpcResult<T> {
	return { ok: true, value };
}

export function rpcError<T = never>(error: unknown, fallbackCode: RpcErrorCode = "internal", details: Record<string, unknown> = {}): RpcResult<T> {
	const value = error as { code?: unknown; message?: unknown; endpoint?: unknown; field?: unknown; details?: unknown };
	const code = typeof value?.code === "string" && isRpcErrorCode(value.code) ? value.code : fallbackCode;
	const errorDetails = isPlainRecord(value?.details) ? value.details : {};
	return {
		ok: false,
		error: {
			code,
			message: error instanceof Error ? error.message : typeof value?.message === "string" ? value.message : String(error),
			details: {
				...errorDetails,
				...details,
				...(typeof value?.endpoint === "string" ? { endpoint: value.endpoint } : {}),
				...(typeof value?.field === "string" ? { field: value.field } : {}),
			},
		},
	};
}

export function isRpcErrorCode(value: string): value is RpcErrorCode {
	return new Set<RpcErrorCode>([
		"bad-request", "ambiguous-endpoint", "binding-invalid", "cancelled", "connection-lost", "context-failed", "context-not-found", "context-unavailable", "definition-unavailable",
		"session-not-found", "workspace-not-found", "workspace-invalid-path",
		"workspace-move-invalid", "workspace-name-conflict", "agent-busy", "command-error", "unknown-command",
		"remote-invalid", "endpoint-not-registered", "method-unavailable", "service-unavailable",
		"invocation-unavailable", "lookup-failed", "lookup-not-found", "lookup-unavailable", "arguments-invalid", "input-invalid", "package-invalid",
		"provider-mismatch", "result-invalid", "signature-invalid", "rpc-uncertain", "rpc-revision-conflict",
		"provider_unavailable", "confirmation_required", "invalid_input", "operation_failed", "operation_not_supported",
		"recovery-claim-conflict", "recovery-authority-invalid", "recovery-token-invalid", "recovery-state-invalid",
		"SESSION_QUERY_ABORTED", "SESSION_QUERY_INVALID_CURSOR", "SESSION_QUERY_INVALID_FILTER",
		"SESSION_QUERY_INVALID_LIMIT", "SESSION_QUERY_INVALID_QUERY", "SESSION_QUERY_SESSION_NOT_FOUND",
		"SESSION_QUERY_INVALID_WINDOW", "SESSION_QUERY_EVENT_NOT_FOUND",
		"SESSION_QUERY_WORKSPACE_NOT_FOUND", "SESSION_QUERY_WORKSPACE_AUTHORIZATION_UNAVAILABLE", "internal",
		"SESSION_QUERY_INVALID_SURFACE", "SESSION_QUERY_INVALID_LINEAGE", "SESSION_QUERY_STALE_CURSOR",
	]).has(value as RpcErrorCode);
}

export function isRpcResult(value: unknown): value is RpcResult<unknown> {
	if (!value || typeof value !== "object") return false;
	const result = value as { ok?: unknown; error?: unknown };
	if (result.ok === true) return "value" in result;
	if (result.ok !== false || !result.error || typeof result.error !== "object") return false;
	const error = result.error as { code?: unknown; message?: unknown; details?: unknown };
	return typeof error.code === "string" && typeof error.message === "string" && Boolean(error.details && typeof error.details === "object");
}

export function asRpcResult(value: unknown): RpcResult<unknown> {
	return isRpcResult(value) ? value : rpcValue(value);
}

export function serverResponse<T>(rpcId: RpcId | string, result: RpcResult<T>): RpcResponse<T> {
	return { rpcId: typeof rpcId === "string" ? RpcId(rpcId) : rpcId, result };
}
