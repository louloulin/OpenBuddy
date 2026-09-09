/**
 * host-modules/deepseek/cordis-runtime.ts — DeepSeek Cordis runtime.
 *
 * Phase 8.3 Batch A 收尾: 从 agent-host.ts 抽出 Region 1b (lines 1336-1657),
 * 围绕 DeepSeek Cordis runtime + bundle helpers (deepSeekCoreRuntimeEntries /
 * normalizeDeepSeekRuntimeEntry / filterPublishedCoreBundle / allowDeepSeekCordisInvocation
 * / createDeepSeekPiToolPlugin / syncDeepSeekCordisRuntime / isDeepSeekCorePackage /
 * currentSessionProjection)。
 *
 * 设计:
 *   - DEEPSEEK_CORE_PACKAGE_NAMES + deepSeekCordisInvocationMethods 是 module-level
 *     const, 只被本模块的 isDeepSeekCorePackage / allowDeepSeekCordisInvocation 使用,
 *     跟随函数搬过来
 *   - state / emitPluginEvent / prompt / abort / listSessions / listSubagentChildren /
 *     promptSubagent / interruptSubagent / listWorkspaces / currentSessionProjection /
 *     piHome 通过环形 import 自 ../../agent-host 注入 — 已由 lifecycle.ts:9-11 +
 *     harness-cursors.ts:23 验证可行
 *   - 来自 profile/* + deepseek/* + @openbuddy/plugin-host 的工具/类型 import 走
 *     相对路径 (../../../deepseek/...、../../../@openbuddy/plugin-host)
 */
import { join } from "node:path";

import { type PluginBundle, type PluginEntryOptions, DeepSeekCordisRuntime, type DeepSeekCordisPluginEntry, type DeepSeekCordisRuntimeSnapshot } from "@openbuddy/plugin-host";

import type { AgentHostState } from "../_state-shape";
import { createDefaultAgentHostState } from "../_default-state";

/**
 * Phase 8.3 Architectural Refactor: deepseek/cordis-runtime 反向依赖消除。
 *
 * 修复前: state / emitPluginEvent / prompt / abort / listSessions /
 *         listSubagentChildren / promptSubagent / interruptSubagent /
 *         piHome / profileArtifactModuleUrl 通过 `from "../../agent-host"`
 *         反向依赖 agent-host.ts。
 * 修复后: 运行时依赖通过 installDeepSeekCordisRuntime() 注入,模块仅 import 类型。
 */

let state: AgentHostState = createDefaultAgentHostState();
let emitPluginEvent: (type: string, payload: unknown) => void = () => undefined;
let promptFn: any = async () => undefined;
let abortFn: any = () => undefined;
let listSessions: (cwd: string) => Promise<readonly unknown[]> = async () => [];
let listSubagentChildren: (parentSessionId: string) => Promise<readonly unknown[]> = async () => [];
let promptSubagent: (
	parentSessionId: string,
	childSessionId: string,
	parts: readonly unknown[],
) => Promise<unknown> = async () => undefined;
let interruptSubagent: (parentSessionId: string, childSessionId: string) => Promise<unknown> = async () => undefined;
let piHome: () => string = () => process.env.PI_CODING_AGENT_DIR ?? process.env.PI_HOME ?? process.cwd();
let profileArtifactModuleUrl: (id: string) => string = (id) => id;

export function installDeepSeekCordisRuntime(deps: {
	state: AgentHostState;
	emitPluginEvent: (type: string, payload: unknown) => void;
	prompt: (text: string) => Promise<unknown>;
	abort: () => Promise<unknown> | unknown;
	listSessions: (cwd: string) => Promise<readonly unknown[]>;
	listSubagentChildren: (parentSessionId: string) => Promise<readonly unknown[]>;
	promptSubagent: (
		parentSessionId: string,
		childSessionId: string,
		parts: readonly unknown[],
	) => Promise<unknown>;
	interruptSubagent: (parentSessionId: string, childSessionId: string) => Promise<unknown>;
	piHome: () => string;
	profileArtifactModuleUrl: (id: string) => string;
}): void {
	if (deps.state) state = deps.state;
	if (deps.emitPluginEvent) emitPluginEvent = deps.emitPluginEvent;
	if (deps.prompt) promptFn = deps.prompt;
	if (deps.abort) abortFn = deps.abort;
	if (deps.listSessions) listSessions = deps.listSessions;
	if (deps.listSubagentChildren) listSubagentChildren = deps.listSubagentChildren;
	if (deps.promptSubagent) promptSubagent = deps.promptSubagent;
	if (deps.interruptSubagent) interruptSubagent = deps.interruptSubagent;
	if (deps.piHome) piHome = deps.piHome;
	if (deps.profileArtifactModuleUrl) profileArtifactModuleUrl = deps.profileArtifactModuleUrl;
}
import { listWorkspaces } from "../workbench-scope";
import { SubprocessRuntime, SandboxPolicyService, SandboxRuntime } from "../../../deepseek/subprocess-runtime";
// Phase L.4 inlined `createDeepSeekExecutionAdapter` (renamed
// `createDshExecutionAdapter`) and `DEEPSEEK_EXECUTION_PACKAGES` from
// `electron/main/deepseek/deepseek-execution-adapters.ts` (now deleted)
// directly into this file, so no import from that path is needed.
// `provideDeepSeekExecutionServices` was also retired by L.4.
import { resolveDeepSeekRuntimeModule } from "../../../deepseek/deepseek-runtime";
import { artifactPackageJsonByName } from "../profile/paths";
import { createProfileArtifactResolvers } from "../../profile-artifact-resolution";
import * as OpenBuddyCordis from "@openbuddy/cordis";
// Phase L.1 — DSH Pi bridge implementations moved in from
// `electron/main/deepseek/deepseek-pi-bridge.ts` and
// `electron/main/deepseek/deepseek-pi-capabilities.ts` (both deleted).
// They had exactly one consumer (this file) and one protocol-constant
// consumer (`dsh-bridge-helpers.ts`); keeping them here lets us delete
// the two top-level files and remove a layer of indirection between
// the Cordis runtime wiring and PI.
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { Model } from "@earendil-works/pi-ai";
import { DEEPSEEK_PI_CAPABILITIES } from "../dsh-bridge-helpers";

// ---------------------------------------------------------------------------
// Phase L.1 — Pi bridge surface (relocated from deepseek-pi-bridge.ts)
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

export type DeepSeekPiCapabilityName = "session" | "web" | "subagent";

export type DeepSeekPiCapabilityMethodMap = {
	session: "get" | "list" | "listWorkspaces";
	web: "status" | "search" | "fetch";
	subagent: "list" | "prompt" | "interrupt";
};

export type DeepSeekPiCapabilityInvocationContext = {
	signal: AbortSignal;
	requestId?: string;
	caller?: string;
};

export type DeepSeekPiCapabilityRuntime = {
	capabilities: Readonly<Record<DeepSeekPiCapabilityName, readonly string[]>>;
	invoke: (capability: DeepSeekPiCapabilityName, method: string, args?: unknown, context?: Partial<DeepSeekPiCapabilityInvocationContext>) => Promise<unknown>;
};

export interface DeepSeekPiBridgeRuntime {
	getSession: () => { sessionId: string; cwd?: string; modelId?: string } | undefined;
	listPersistedSessions: (cwd: string) => Promise<readonly unknown[]>;
	getProviders: () => readonly { id: string; name: string }[];
	getModels: (provider?: string) => readonly Model<any>[];
	getModel: (provider: string, model: string) => Model<any> | undefined;
	getCurrentModel: () => Model<any> | undefined;
	listTools: () => readonly { name: string; label?: string; description?: string }[];
	executeTool: (name: string, argumentsValue: unknown, signal?: AbortSignal) => Promise<unknown>;
	prompt: (text: string) => Promise<void>;
	abort: () => Promise<void>;
	capability?: DeepSeekPiCapabilityRuntime;
}

export interface DeepSeekPiBridge {
	runtime: "pi";
	capabilities: Readonly<Record<DeepSeekPiCapabilityName, readonly string[]>>;
	get: (id?: string) => JsonRecord | undefined;
	listSessions: () => JsonRecord[];
	listPersistedSessions: (cwd?: string) => Promise<readonly unknown[]>;
	listProviders: () => readonly { id: string; name: string }[];
	listModels: (provider?: string) => JsonRecord[];
	complete: (options: { prompt?: string; system?: string; provider?: string; model?: string }) => Promise<JsonRecord>;
	listTools: () => JsonRecord[];
	executeTool: (name: string, argumentsValue?: unknown) => Promise<unknown>;
	prompt: (text: string) => Promise<JsonRecord>;
	abort: () => Promise<JsonRecord>;
	invokeCapability: (capability: DeepSeekPiCapabilityName, method: string, args?: unknown, context?: Partial<DeepSeekPiCapabilityInvocationContext>) => Promise<unknown>;
}

export type DeepSeekGenerateOptions = {
	provider?: unknown;
	model?: unknown;
	messages?: unknown;
	system?: unknown;
	tools?: unknown;
	temperature?: unknown;
	maxTokens?: unknown;
	signal?: unknown;
	sessionId?: unknown;
};

export type DeepSeekPiStream = (model: Model<any>, context: any, options?: any) => AsyncIterable<any>;

// ---------------------------------------------------------------------------
// Phase L.1 — Pi capability facade surface (relocated from
// deepseek-pi-capabilities.ts). The capability runtime validates JSON-safe
// arguments, dispatches to typed handlers, and emits audit entries. The
// `web` handler is optional because OpenBuddy dropped the bespoke web
// search backend in favour of `pi-web-access`.
// ---------------------------------------------------------------------------

export type DeepSeekPiCapabilityHandlers = {
	session: {
		get: (context: DeepSeekPiCapabilityInvocationContext) => unknown;
		list: (cwd: string, context: DeepSeekPiCapabilityInvocationContext) => Promise<unknown>;
		listWorkspaces: (context: DeepSeekPiCapabilityInvocationContext) => Promise<unknown>;
	};
	web?: {
		status: (context: DeepSeekPiCapabilityInvocationContext) => Promise<unknown>;
		search: (query: string, maxResults: number | undefined, context: DeepSeekPiCapabilityInvocationContext) => Promise<unknown>;
		fetch: (url: string, context: DeepSeekPiCapabilityInvocationContext) => Promise<unknown>;
	};
	subagent: {
		list: (parentSessionId: string, context: DeepSeekPiCapabilityInvocationContext) => Promise<unknown>;
		prompt: (parentSessionId: string, childSessionId: string, text: string, context: DeepSeekPiCapabilityInvocationContext) => Promise<unknown>;
		interrupt: (parentSessionId: string, childSessionId: string, context: DeepSeekPiCapabilityInvocationContext) => Promise<unknown>;
	};
};

export type DeepSeekPiCapabilityAudit = {
	capability: DeepSeekPiCapabilityName;
	method: string;
	outcome: "success" | "failure";
	durationMs: number;
	requestId?: string;
	caller?: string;
};

// ---------------------------------------------------------------------------
// Phase L.1 — Pi bridge + capability + interceptor implementations.
// Code below is a verbatim relocation of the contents of
// `electron/main/deepseek/deepseek-pi-bridge.ts` (349 LOC) +
// `electron/main/deepseek/deepseek-pi-capabilities.ts` (198 LOC).
// All `function` exports keep the same names and signatures so the
// call sites in `syncDeepSeekCordisRuntime` below need no change.
// ---------------------------------------------------------------------------

function bridgeRecord(value: unknown): JsonRecord {
	return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function bridgeContentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return content == null ? "" : String(content);
	return content.map((part) => {
		if (typeof part === "string") return part;
		const item = bridgeRecord(part);
		if (item.type === "text" && typeof item.text === "string") return item.text;
		if (typeof item.content === "string") return item.content;
		return "";
	}).join("");
}

function bridgePiContent(content: unknown): unknown {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return bridgeContentText(content);
	return content.map((part) => {
		const item = bridgeRecord(part);
		if (item.type === "text" && typeof item.text === "string") return { type: "text", text: item.text };
		if (item.type === "reasoning" && typeof item.text === "string") return { type: "thinking", thinking: item.text };
		if (item.type === "tool-call") {
			return {
				type: "toolCall",
				id: String(item.id ?? "dsh-tool"),
				name: String(item.name ?? "tool"),
				arguments: bridgeParseArguments(item.arguments),
			};
		}
		return { type: "text", text: bridgeContentText(part) };
	});
}

function bridgeParseArguments(value: unknown): JsonRecord {
	if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonRecord : {};
		} catch {
			return {};
		}
	}
	return {};
}

function bridgeToPiMessages(messages: unknown, model: Model<any>): unknown[] {
	if (!Array.isArray(messages)) return [];
	return messages.filter((raw) => bridgeRecord(raw).role !== "system").map((raw) => {
		const message = bridgeRecord(raw);
		const role = message.role;
		const timestamp = typeof message.timestamp === "number" ? message.timestamp : Date.now();
		if (role === "tool-result" || role === "tool") {
			return {
				role: "toolResult",
				toolCallId: String(message.toolCallId ?? message.callId ?? "dsh-tool"),
				toolName: String(message.toolName ?? "tool"),
				content: [{ type: "text", text: bridgeContentText(message.content) }],
				isError: Boolean(message.isError),
				timestamp,
			};
		}
		if (role === "assistant") {
			return {
				role: "assistant",
				content: bridgePiContent(message.content),
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp,
			};
		}
		return { role: "user", content: bridgePiContent(message.content), timestamp };
	});
}

function bridgeToolCallFromPartial(event: JsonRecord): JsonRecord {
	const partial = bridgeRecord(event.partial);
	const content = Array.isArray(partial.content) ? partial.content : [];
	return bridgeRecord(content[Number(event.contentIndex)]);
}

function bridgeUsageFromMessage(message: unknown): JsonRecord {
	const usage = bridgeRecord(bridgeRecord(message).usage);
	return {
		inputTokens: Number(usage.input ?? 0),
		outputTokens: Number(usage.output ?? 0),
		...(usage.cacheRead === undefined ? {} : { cacheReadTokens: Number(usage.cacheRead) }),
		...(usage.cacheWrite === undefined ? {} : { cacheWriteTokens: Number(usage.cacheWrite) }),
		...(usage.reasoning === undefined ? {} : { reasoningTokens: Number(usage.reasoning) }),
	};
}

function bridgeFinishReason(reason: unknown): JsonRecord {
	if (reason === "toolUse") return { kind: "tool-calls" };
	if (reason === "length") return { kind: "max-tokens" };
	return { kind: "stop" };
}

export function createDeepSeekPiBridge(runtime: DeepSeekPiBridgeRuntime): DeepSeekPiBridge {
	const capabilities = runtime.capability?.capabilities ?? DEEPSEEK_PI_CAPABILITIES;
	const invokeCapability = async (capability: DeepSeekPiCapabilityName, method: string, args?: unknown, context?: Partial<DeepSeekPiCapabilityInvocationContext>): Promise<unknown> => {
		const methods = capabilities[capability];
		if (!methods?.includes(method)) throw new Error(`pi bridge: capability method is unavailable: ${capability}/${method}`);
		if (!runtime.capability) throw new Error("pi bridge: capability facade is unavailable");
		return context === undefined
			? runtime.capability.invoke(capability, method, args)
			: runtime.capability.invoke(capability, method, args, context);
	};
	return {
		runtime: "pi",
		capabilities,
		get: (id) => {
			const session = runtime.getSession();
			if (!session || (id && id !== session.sessionId)) return undefined;
			return { sessionId: session.sessionId, ...(session.cwd ? { cwd: session.cwd } : {}), ...(session.modelId ? { modelId: session.modelId } : {}) };
		},
		listSessions: () => {
			const session = runtime.getSession();
			return session ? [{ sessionId: session.sessionId, ...(session.cwd ? { cwd: session.cwd } : {}), ...(session.modelId ? { modelId: session.modelId } : {}) }] : [];
		},
		listPersistedSessions: (cwd) => runtime.listPersistedSessions(cwd ?? process.cwd()),
		listProviders: () => runtime.getProviders(),
		listModels: (provider) => runtime.getModels(provider).map((model) => ({
			id: model.id,
			name: model.name,
			provider: model.provider,
			api: model.api,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			reasoning: model.reasoning,
		})),
		complete: async (options) => {
			const model = options.provider && options.model
				? runtime.getModel(options.provider, options.model)
				: runtime.getCurrentModel();
			if (!model) throw new Error("pi bridge: no active model is configured");
			const chunks: string[] = [];
			for await (const event of streamSimple(model, {
				systemPrompt: options.system,
				messages: [{ role: "user", content: options.prompt ?? "", timestamp: Date.now() }],
			})) {
				if (event.type === "text_delta") chunks.push(event.delta);
			}
			return { text: chunks.join(""), provider: model.provider, model: model.id };
		},
		listTools: () => runtime.listTools().map((tool) => ({ name: tool.name, ...(tool.label ? { label: tool.label } : {}), ...(tool.description ? { description: tool.description } : {}) })),
		executeTool: (name, argumentsValue) => runtime.executeTool(name, argumentsValue),
		prompt: async (text) => { await runtime.prompt(text); return { sessionId: runtime.getSession()?.sessionId }; },
		abort: async () => { await runtime.abort(); return { ok: true }; },
		invokeCapability,
	};
}

export function createDeepSeekPiLlmInterceptor(
	runtime: Pick<DeepSeekPiBridgeRuntime, "getModel">,
	stream: DeepSeekPiStream = streamSimple,
): (options: DeepSeekGenerateOptions, next: () => AsyncIterable<unknown>) => AsyncIterable<unknown> {
	return (options, next) => {
		const provider = typeof options.provider === "string" ? options.provider : undefined;
		const modelId = typeof options.model === "string" ? options.model : undefined;
		const model = provider && modelId ? runtime.getModel(provider, modelId) : undefined;
		if (!model) return next();
		const context = {
			systemPrompt: typeof options.system === "string" ? options.system : undefined,
			messages: bridgeToPiMessages(options.messages, model),
			tools: Array.isArray(options.tools) ? options.tools.map((tool) => {
				const item = bridgeRecord(tool);
				return { name: String(item.name ?? "tool"), description: String(item.description ?? ""), parameters: item.parameters ?? {} };
			}) : undefined,
		};
		const streamOptions = {
			temperature: typeof options.temperature === "number" ? options.temperature : undefined,
			maxTokens: typeof options.maxTokens === "number" ? options.maxTokens : undefined,
			signal: options.signal && typeof options.signal === "object" && "aborted" in options.signal
				? options.signal
				: undefined,
			sessionId: typeof options.sessionId === "string" ? options.sessionId : undefined,
		};
		return bridgeMapPiStream(stream(model, context, streamOptions));
	};
}

export function createDeepSeekPiToolInterceptor(
	runtime: Pick<DeepSeekPiBridgeRuntime, "listTools" | "executeTool">,
): (execution: JsonRecord, next: () => Promise<unknown>) => Promise<unknown> {
	const names = () => new Set(runtime.listTools().map((tool) => tool.name));
	return async (execution, next) => {
		const name = typeof execution.name === "string" ? execution.name : undefined;
		if (!name || !names().has(name)) return next();
		try {
			const result = bridgeRecord(await runtime.executeTool(name, execution.arguments, execution.signal as AbortSignal | undefined));
			const content = Array.isArray(result.content)
				? result.content.map((part) => {
					const item = bridgeRecord(part);
					return item.type === "text" && typeof item.text === "string"
						? { type: "text", text: item.text }
						: { type: "text", text: bridgeContentText(part) };
				})
				: [{ type: "text", text: JSON.stringify(result.details ?? result) }];
			return {
				isError: false,
				value: result.details ?? null,
				content,
			};
		} catch (error) {
			return {
				isError: true,
				error: { message: error instanceof Error ? error.message : String(error) },
				content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
			};
		}
	};
}

async function* bridgeMapPiStream(source: AsyncIterable<JsonRecord>): AsyncIterable<JsonRecord> {
	for await (const raw of source) {
		const event = bridgeRecord(raw);
		switch (event.type) {
			case "text_start":
				yield { type: "block-start", index: Number(event.contentIndex ?? 0), blockType: "text" };
				break;
			case "text_delta":
				yield { type: "text-delta", index: Number(event.contentIndex ?? 0), text: String(event.delta ?? "") };
				break;
			case "text_end":
				yield { type: "block-end", index: Number(event.contentIndex ?? 0), block: { type: "text", text: String(event.content ?? "") } };
				break;
			case "thinking_start":
				yield { type: "block-start", index: Number(event.contentIndex ?? 0), blockType: "reasoning" };
				break;
			case "thinking_delta":
				yield { type: "reasoning-delta", index: Number(event.contentIndex ?? 0), text: String(event.delta ?? "") };
				break;
			case "thinking_end":
				yield { type: "block-end", index: Number(event.contentIndex ?? 0), block: { type: "reasoning", text: String(event.content ?? "") } };
				break;
			case "toolcall_start": {
				const call = bridgeToolCallFromPartial(event);
				yield { type: "block-start", index: Number(event.contentIndex ?? 0), blockType: "tool-call" };
				yield { type: "tool-call-delta", index: Number(event.contentIndex ?? 0), id: String(call.id ?? ""), name: String(call.name ?? ""), argumentsDelta: "" };
				break;
			}
			case "toolcall_delta": {
				const call = bridgeToolCallFromPartial(event);
				yield { type: "tool-call-delta", index: Number(event.contentIndex ?? 0), id: String(call.id ?? ""), name: typeof call.name === "string" ? call.name : undefined, argumentsDelta: String(event.delta ?? "") };
				break;
			}
			case "toolcall_end": {
				const call = bridgeRecord(event.toolCall);
				yield { type: "block-end", index: Number(event.contentIndex ?? 0), block: { type: "tool-call", id: String(call.id ?? ""), name: String(call.name ?? ""), arguments: JSON.stringify(call.arguments ?? {}) } };
				break;
			}
			case "done":
				yield { type: "usage", usage: bridgeUsageFromMessage(event.message) };
				yield { type: "finish", reason: bridgeFinishReason(event.reason) };
				break;
			case "error": {
				const aborted = event.reason === "aborted";
				yield { type: "finish", reason: { kind: aborted ? "aborted" : "error", failure: { code: aborted ? "ABORTED" : "PI_PROVIDER_ERROR", message: String(event.errorMessage ?? "Pi provider error") } } };
				break;
			}
			default:
				break;
		}
	}
}

// ---------------------------------------------------------------------------
// Phase L.1 — Pi capability runtime implementation.
// ---------------------------------------------------------------------------

function capabilityIsJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (!value || typeof value !== "object") return false;
	if (ancestors.has(value)) return false;
	ancestors.add(value);
	try {
		if (Array.isArray(value)) return value.every((item) => capabilityIsJsonValue(item, ancestors));
		if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
		return Object.values(value as JsonRecord).every((item) => capabilityIsJsonValue(item, ancestors));
	} finally {
		ancestors.delete(value);
	}
}

function capabilityAssertJsonResult(value: unknown, capability: string, method: string): unknown {
	if (!capabilityIsJsonValue(value)) throw new Error(`pi bridge: ${capability}.${method} returned a non-JSON-safe value`);
	return value;
}

function capabilityArgumentsRecord(value: unknown, capability: string, method: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value) || !capabilityIsJsonValue(value)) {
		throw new Error(`pi bridge: ${capability}.${method} arguments must be JSON-safe object`);
	}
	return value as JsonRecord;
}

function capabilityOptionalString(args: JsonRecord, key: string): string | undefined {
	if (args[key] === undefined) return undefined;
	if (typeof args[key] !== "string" || !args[key].trim()) throw new Error(`pi bridge: ${key} must be a non-empty string`);
	return args[key];
}

function capabilityRequiredString(args: JsonRecord, key: string): string {
	const value = capabilityOptionalString(args, key);
	if (!value) throw new Error(`pi bridge: ${key} is required`);
	return value;
}

function capabilityOptionalNumber(args: JsonRecord, key: string): number | undefined {
	if (args[key] === undefined) return undefined;
	if (typeof args[key] !== "number" || !Number.isFinite(args[key])) throw new Error(`pi bridge: ${key} must be a finite number`);
	return args[key];
}

function capabilityEnsureKeys(args: JsonRecord, allowed: readonly string[], capability: string, method: string): void {
	const allowedSet = new Set(allowed);
	const unknown = Object.keys(args).find((key) => !allowedSet.has(key));
	if (unknown) throw new Error(`pi bridge: ${capability}.${method} does not accept ${unknown}`);
}

function capabilityIsCapabilityName(value: unknown): value is DeepSeekPiCapabilityName {
	return value === "session" || value === "web" || value === "subagent";
}

function capabilityAbortError(): Error {
	return Object.assign(new Error("Pi capability invocation was cancelled"), { name: "AbortError", code: "cancelled" });
}

function capabilityCreateContext(input?: Partial<DeepSeekPiCapabilityInvocationContext>): DeepSeekPiCapabilityInvocationContext {
	const controller = new AbortController();
	if (input?.signal?.aborted) controller.abort(input.signal.reason);
	else input?.signal?.addEventListener("abort", () => controller.abort(input.signal?.reason), { once: true });
	return { signal: controller.signal, ...(input?.requestId ? { requestId: input.requestId } : {}), ...(input?.caller ? { caller: input.caller } : {}) };
}

async function capabilityWithTimeout<T>(task: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeoutMs: number): Promise<T> {
	if (parent.aborted) throw capabilityAbortError();
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("pi bridge: timeout must be a positive safe integer");
	const timeout = new AbortController();
	const onAbort = () => timeout.abort(parent.reason);
	parent.addEventListener("abort", onAbort, { once: true });
	const timer = setTimeout(() => timeout.abort(new Error("Pi capability invocation timed out")), timeoutMs);
	try {
		return await Promise.race([
			task(timeout.signal),
			new Promise<T>((_, reject) => timeout.signal.addEventListener("abort", () => reject(timeout.signal.reason instanceof Error ? timeout.signal.reason : capabilityAbortError()), { once: true })),
		]);
	} finally {
		clearTimeout(timer);
		parent.removeEventListener("abort", onAbort);
	}
}

export function createDeepSeekPiCapabilityRuntime(
	handlers: DeepSeekPiCapabilityHandlers,
	options: { onAudit?: (entry: DeepSeekPiCapabilityAudit) => void; timeoutMs?: number } = {},
): DeepSeekPiCapabilityRuntime {
	return {
		capabilities: DEEPSEEK_PI_CAPABILITIES,
		invoke: async (capability: DeepSeekPiCapabilityName, method: string, rawArgs?: unknown, inputContext?: Partial<DeepSeekPiCapabilityInvocationContext>): Promise<unknown> => {
			const context = capabilityCreateContext(inputContext);
			const startedAt = Date.now();
			const audit = (outcome: "success" | "failure") => options.onAudit?.({ capability, method, outcome, durationMs: Math.max(0, Date.now() - startedAt), ...(context.requestId ? { requestId: context.requestId } : {}), ...(context.caller ? { caller: context.caller } : {}) });
			try {
				if (!capabilityIsCapabilityName(capability)) throw new Error(`pi bridge: capability is unavailable: ${String(capability)}`);
				const args = capabilityArgumentsRecord(rawArgs ?? {}, capability, method);
				if (!(DEEPSEEK_PI_CAPABILITIES[capability] as readonly string[]).includes(method)) throw new Error(`pi bridge: capability method is unavailable: ${capability}/${method}`);
				if (capability === "session") {
					if (method === "get") {
						capabilityEnsureKeys(args, [], capability, method);
						const result = capabilityAssertJsonResult(handlers.session.get(context), capability, method);
						audit("success");
						return result;
					}
					if (method === "list") {
						capabilityEnsureKeys(args, ["cwd"], capability, method);
						const result = capabilityAssertJsonResult(await capabilityWithTimeout((signal) => handlers.session.list(capabilityOptionalString(args, "cwd") ?? process.cwd(), { ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
						audit("success");
						return result;
					}
					capabilityEnsureKeys(args, [], capability, method);
					const result = capabilityAssertJsonResult(await capabilityWithTimeout((signal) => handlers.session.listWorkspaces({ ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
					audit("success");
					return result;
				}
				if (capability === "web") {
					if (!handlers.web) throw new Error("pi bridge: web capability is unavailable (use pi-web-access)");
					if (method === "status") {
						capabilityEnsureKeys(args, [], capability, method);
						const result = capabilityAssertJsonResult(await capabilityWithTimeout((signal) => handlers.web!.status({ ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
						audit("success");
						return result;
					}
					if (method === "search") {
						capabilityEnsureKeys(args, ["query", "maxResults"], capability, method);
						const result = capabilityAssertJsonResult(await capabilityWithTimeout((signal) => handlers.web!.search(capabilityRequiredString(args, "query"), capabilityOptionalNumber(args, "maxResults"), { ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
						audit("success");
						return result;
					}
					capabilityEnsureKeys(args, ["url"], capability, method);
					const result = capabilityAssertJsonResult(await capabilityWithTimeout((signal) => handlers.web!.fetch(capabilityRequiredString(args, "url"), { ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
					audit("success");
					return result;
				}
				if (method === "list") {
					capabilityEnsureKeys(args, ["parentSessionId"], capability, method);
					const result = capabilityAssertJsonResult(await capabilityWithTimeout((signal) => handlers.subagent.list(capabilityRequiredString(args, "parentSessionId"), { ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
					audit("success");
					return result;
				}
				capabilityEnsureKeys(args, ["parentSessionId", "childSessionId", "text"], capability, method);
				const parentSessionId = capabilityRequiredString(args, "parentSessionId");
				const childSessionId = capabilityRequiredString(args, "childSessionId");
				const result = capabilityAssertJsonResult(await capabilityWithTimeout((signal) => method === "interrupt"
					? handlers.subagent.interrupt(parentSessionId, childSessionId, { ...context, signal })
					: handlers.subagent.prompt(parentSessionId, childSessionId, capabilityRequiredString(args, "text"), { ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
				audit("success");
				return result;
			} catch (error) {
				audit("failure");
				throw error;
			}
		},
	};
}

// --- Bundles / entries ------------------------------------------------------

// Phase L.4: inlined from deepseek-execution-adapters (now deleted).
// The three sandbox subprocess packages are still exposed as Cordis plugins
// for DSH-compat profile compatibility, but the adapter shim is dead weight
// in a PI-first world — we mount the services directly on the bootstrap
// context, then route any DSH plugin loader that asks for these packages
// through `importer` with a one-liner plugin stub.
const DEEPSEEK_EXECUTION_PACKAGES = new Set([
	"@deepseek-ai/dsh-subprocess-local",
	"@deepseek-ai/dsh-sandbox-local",
	"@deepseek-ai/dsh-sandbox-policy",
]);

interface DeepSeekExecutionServices {
	subprocess: SubprocessRuntime;
	sandboxPolicy: SandboxPolicyService;
	sandbox: SandboxRuntime;
}

function createDshExecutionAdapter(packageName: string, services: DeepSeekExecutionServices) {
	if (!DEEPSEEK_EXECUTION_PACKAGES.has(packageName)) return undefined;
	const moduleName = packageName.replace(/^@deepseek-ai\//u, "");
	return {
		name: packageName,
		package: moduleName,
		async apply(context: { provide?: (name: string, value: unknown) => unknown }): Promise<() => Promise<void>> {
			const disposers: Array<() => unknown> = [];
			for (const [key, value] of [
				["subprocess", services.subprocess],
				["sandboxPolicy", services.sandboxPolicy],
				["sandbox", services.sandbox],
			] as const) {
				const restore = context.provide?.(key, value);
				if (typeof restore === "function") disposers.push(restore as () => unknown);
			}
			return async () => {
				for (const dispose of disposers.reverse()) await dispose();
			};
		},
	};
}

const DEEPSEEK_CORE_PACKAGE_NAMES = new Set([
	"@deepseek-ai/dsh-typert-registry",
	"@deepseek-ai/dsh-system-prompt",
	"@deepseek-ai/dsh-llm",
	"@deepseek-ai/dsh-session",
	"@deepseek-ai/dsh-agent",
	"@deepseek-ai/dsh-tools",
	"@deepseek-ai/dsh-subagent",
	"@deepseek-ai/dsh-web",
]);

const deepSeekCordisInvocationMethods: Readonly<Record<string, readonly string[]>> = {
	pi: ["get", "listSessions", "listPersistedSessions", "listProviders", "listModels", "complete", "listTools", "executeTool", "prompt", "abort", "invokeCapability"],
	typert: ["get", "list", "getPackage", "listPackages", "toJSONSchema", "revision"],
	systemPrompt: ["list", "sections", "render"],
	llm: ["listProviders", "listModels", "resolveModelInfo", "discoverModels", "complete"],
	sessions: ["get", "list", "create", "load", "listPersisted", "history", "info", "usage", "selectModel"],
	session: ["get", "list", "create", "load", "listPersisted", "history", "info", "usage", "selectModel"],
	agents: ["get", "list", "currentInitiator"],
	tools: ["schemas", "execute"],
	subagents: ["list", "getProvider", "run"],
	web: ["search", "fetch", "status"],
};

function isDeepSeekCorePackage(name: string): boolean {
	return DEEPSEEK_CORE_PACKAGE_NAMES.has(name);
}

function allowDeepSeekCordisInvocation(service: string, method: string): boolean {
	return deepSeekCordisInvocationMethods[service]?.includes(method) ?? false;
}

function normalizeDeepSeekRuntimeEntry<T extends { id: string; name: string; config?: unknown }>(entry: T): T {
	if (entry.name === "@deepseek-ai/cordis-plugin-hmr" && (!entry.config || typeof entry.config !== "object" || !("root" in entry.config))) {
		return { ...entry, config: { root: ["."] } };
	}
	if (entry.name === "@deepseek-ai/dsh-session-persistence-jsonl" && (!entry.config || typeof entry.config !== "object" || !("root" in entry.config))) {
		return { ...entry, config: { root: join(piHome(), "sessions") } };
	}
	if ((entry.id === "tool-fs-search" || entry.id === "openbuddy-dsh-tool-fs-search")
		&& (!entry.config || typeof entry.config !== "object" || !("sampleOverCapGlobResults" in entry.config))) {
		return { ...entry, config: { sampleOverCapGlobResults: false } };
	}
	if ((entry.id === "agent-default-model" || entry.id === "openbuddy-dsh-agent-default-model")
		&& (!entry.config || typeof entry.config !== "object"
			|| typeof (entry.config as { provider?: unknown }).provider !== "string"
			|| !(entry.config as { model?: unknown }).model
			|| typeof (entry.config as { model?: unknown }).model !== "string")) {
		return { ...entry, config: { provider: "pi", model: "default" } };
	}
	if ((entry.id === "tool-subagent" || entry.id === "openbuddy-dsh-tool-subagent")
		&& (!entry.config || typeof entry.config !== "object" || typeof (entry.config as { provider?: unknown }).provider !== "string")) {
		return { ...entry, config: { provider: "spawn", toolName: "subagent", backgroundMode: "continuable" } };
	}
	return entry;
}

function deepSeekCoreRuntimeEntries(profileEntries: readonly { id: string; name: string; config?: unknown; disabled?: boolean }[] = []): Array<{ id: string; name: string; config?: unknown; disabled?: boolean }> {
	const coreIds = new Set(["typert", "systemPrompt", "llm", "session", "agent", "tools", "subagent", "web"]);
	const core = [
		["typert", "@deepseek-ai/dsh-typert-registry"],
		["systemPrompt", "@deepseek-ai/dsh-system-prompt"],
		["llm", "@deepseek-ai/dsh-llm"],
		["session", "@deepseek-ai/dsh-session"],
		["agent", "@deepseek-ai/dsh-agent"],
		["tools", "@deepseek-ai/dsh-tools"],
		["subagent", "@deepseek-ai/dsh-subagent"],
		["web", "@deepseek-ai/dsh-web"],
	].map(([id, name]) => ({ id, name }));
	const extra = profileEntries
		.filter((entry) => !coreIds.has(entry.id) && !isDeepSeekCorePackage(entry.name))
		.filter((entry) => entry.name.startsWith("@deepseek-ai/") || entry.name.startsWith("@cordisjs/"))
		.map((entry) => normalizeDeepSeekRuntimeEntry({ ...entry }));
	const merged = new Map<string, { id: string; name: string; config?: unknown; disabled?: boolean }>();
	for (const entry of [...core, ...extra]) merged.set(entry.id, entry);
	return [...merged.values()];
}

function filterPublishedCoreBundle(bundle: PluginBundle): PluginBundle {
	const coreIds = new Set(["typert", "systemPrompt", "llm", "session", "agent", "tools", "subagent", "web"]);
	const normalizeEntry = (entry: PluginEntryOptions): PluginEntryOptions => {
		if (entry.id === "hmr" && (!entry.config || typeof entry.config !== "object" || !("root" in entry.config))) {
			return { ...entry, config: { root: ["."] } };
		}
		if (entry.id === "session-persistence-jsonl" && (!entry.config || typeof entry.config !== "object" || !("root" in entry.config))) {
			return { ...entry, config: { root: join(piHome(), "sessions") } };
		}
		if ((entry.id === "tool-fs-search" || entry.id === "openbuddy-dsh-tool-fs-search")
			&& (!entry.config || typeof entry.config !== "object" || !("sampleOverCapGlobResults" in entry.config))) {
			return { ...entry, config: { sampleOverCapGlobResults: false } };
		}
		return entry;
	};
	const entries = bundle.entries.filter((entry) => !coreIds.has(entry.id) && !isDeepSeekCorePackage(entry.name)).map(normalizeEntry);
	const patches = (bundle.patches ?? []).map((layer) => layer.flatMap((patch) => {
		if (patch.insert !== undefined) {
			const inserts = Array.isArray(patch.insert) ? patch.insert : [patch.insert];
			const filtered = inserts.filter((entry) => !coreIds.has(entry.id) && !isDeepSeekCorePackage(entry.name));
			if (!filtered.length) return [];
			return [{ ...patch, insert: Array.isArray(patch.insert) ? filtered.map(normalizeEntry) : normalizeEntry(filtered[0]!) }];
		}
		if ((patch.id !== undefined && coreIds.has(patch.id)) || (patch.name !== undefined && isDeepSeekCorePackage(patch.name))) {
			return [];
		}
		if (patch.id === "hmr" && patch.config === undefined) return [{ ...patch, config: { root: ["."] } }];
		if (patch.id === "session-persistence-jsonl" && patch.config === undefined) return [{ ...patch, config: { root: join(piHome(), "sessions") } }];
		if (patch.id === "tool-fs-search" && patch.config === undefined) return [{ ...patch, config: { sampleOverCapGlobResults: false } }];
		if (patch.id === "tool-subagent" && patch.config === undefined) {
			return [{ ...patch, config: { provider: "spawn", toolName: "subagent", backgroundMode: "continuable" } }];
		}
		return [patch];
	}));
	return { entries, patches };
}

// --- Runtime wiring ------------------------------------------------------

function currentSessionProjection(): Record<string, unknown> | undefined {
	const session = state.session;
	if (!session) return undefined;
	return {
		sessionId: session.sessionId,
		...(state.cwd ? { cwd: state.cwd } : {}),
		...(state.model?.id ? { modelId: state.model.id } : {}),
	};
}

function createDeepSeekPiToolPlugin(runtime: DeepSeekPiBridgeRuntime): (context: unknown) => void | (() => void | Promise<void>) {
	return (context) => {
		const target = context as { get?: (name: string, strict?: boolean) => unknown };
		const tools = target.get?.("tools") as {
			register?: (definition: unknown) => () => void;
			get?: (name: string) => unknown;
		} | undefined;
		if (!tools?.register) return undefined;
		const register = tools.register;
		let disposers: Array<() => void> = [];
		const sync = (): void => {
			for (const dispose of disposers.reverse()) dispose();
			disposers = [];
			for (const tool of state.toolRegistry.list()) {
				if (typeof tools.get === "function" && tools.get(tool.name) !== undefined) continue;
				try {
					const dispose = register({
						name: tool.name,
						description: tool.description,
						parameters: tool.parameters,
						output: {
							schema: {},
							render: (_args: unknown, value: unknown) => [{ type: "text", text: JSON.stringify(value) ?? String(value) }],
						},
						execute: async (args: unknown, exec: { signal: AbortSignal }) => {
							const result = await runtime.executeTool(tool.name, args, exec.signal);
							return result && typeof result === "object" && "details" in result
								? (result as { details: unknown }).details
								: result;
						},
					});
					if (typeof dispose === "function") disposers.push(dispose);
				} catch (error) {
					console.warn(`[openbuddy] failed to register Pi tool in DeepSeek registry: ${tool.name}`, error);
				}
			}
		};
		sync();
		state.deepSeekPiToolSync = sync;
		return () => {
			if (state.deepSeekPiToolSync === sync) state.deepSeekPiToolSync = null;
			for (const dispose of disposers.reverse()) dispose();
			disposers = [];
		};
	};
}

async function syncDeepSeekCordisRuntime(entries: readonly { id: string; name: string; config?: unknown; disabled?: boolean }[]): Promise<void> {
	const cwd = state.cwd ?? process.cwd();
	const packageJsonByName = await artifactPackageJsonByName(state.profilePackagePaths, state.cwd);
	if (!packageJsonByName.has("@deepseek-ai/dsh-base")) {
		if (state.deepSeekCordisRuntime) {
			state.deepSeekCordisSnapshot = await state.deepSeekCordisRuntime.dispose();
			state.deepSeekCordisRuntime = null;
		}
		state.deepSeekCordisSnapshot = null;
		return;
	}
	const cordisPackageJson = packageJsonByName.get("@deepseek-ai/cordis");
	if (!cordisPackageJson) {
		if (state.deepSeekCordisRuntime) {
			state.deepSeekCordisSnapshot = await state.deepSeekCordisRuntime.dispose();
			state.deepSeekCordisRuntime = null;
		}
		state.deepSeekCordisSnapshot = null;
		return;
	}
	const resolvers = createProfileArtifactResolvers({
		packageJsonByName,
		profilePackageJson: state.profilePackageJson,
	});
	const importer = async (specifier: string): Promise<unknown> => {
		// Phase L.3: the legacy `resolveDeepSeekModule` is gone, but the
		// slim DSH runtime alias surface (`resolveDeepSeekRuntimeModule`
		// in `deepseek-runtime.ts`) survives so the cordis runtime can
		// still resolve `@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-session`
		// / ... to their local service shims without a node_modules entry.
		if (specifier === "@deepseek-ai/cordis" || specifier === "@cordisjs/core") return OpenBuddyCordis;
		const runtimeAlias = resolveDeepSeekRuntimeModule(specifier);
		if (runtimeAlias !== undefined) return runtimeAlias;
		const packageJson = packageJsonByName.get(specifier) ?? await resolvers.resolvePackageJson(specifier);
		packageJsonByName.set(specifier, packageJson);
		return import(/* @vite-ignore */ profileArtifactModuleUrl(await resolvers.resolveModule(specifier, packageJson)));
	};
	const cordisModule = await importer("@deepseek-ai/cordis");
	const runtimeEntries: DeepSeekCordisPluginEntry[] = [];
	for (const entry of entries) {
		if (resolveDeepSeekRuntimeModule(entry.name) !== undefined) {
			runtimeEntries.push(entry as DeepSeekCordisPluginEntry);
			continue;
		}
		try {
			const packageJson = await resolvers.resolvePackageJson(entry.name);
			await resolvers.resolveModule(entry.name, packageJson);
			runtimeEntries.push(entry as DeepSeekCordisPluginEntry);
		} catch {
			/* skip entries whose modules cannot be resolved */
		}
	}
	const executionServices = {
		subprocess: state.subprocessRuntime ?? new SubprocessRuntime(),
		sandboxPolicy: state.context?.get("sandboxPolicy") as SandboxPolicyService ?? new SandboxPolicyService({ workspaceRoot: cwd }),
		sandbox: state.context?.get("sandbox") as SandboxRuntime ?? new SandboxRuntime(),
		owned: false,
	};
	const piBridgeRuntime: DeepSeekPiBridgeRuntime = {
		getSession: () => {
			const session = state.session;
			return session ? { sessionId: session.sessionId, cwd: state.cwd ?? undefined, modelId: state.model?.id } : undefined;
		},
		listPersistedSessions: (cwd) => listSessions(cwd).then((items) => items),
		getProviders: () => state.modelRuntime?.getProviders().map((provider) => ({ id: provider.id, name: provider.name })) ?? [],
		getModels: (provider) => state.modelRuntime?.getModels(provider) ?? [],
		getModel: (provider, model) => state.modelRuntime?.getModel(provider, model),
		getCurrentModel: () => state.model,
		listTools: () => state.toolRegistry.list().map((tool) => ({ name: tool.name, label: tool.label, description: tool.description })),
		executeTool: async (name, argumentsValue, signal) => {
			const tool = state.toolRegistry.list().find((candidate) => candidate.name === name);
			if (!tool) throw new Error(`pi bridge: tool is unavailable: ${name}`);
			const session = state.session;
			if (!session) throw new Error("pi bridge: AgentSession is not ready");
			const result = await tool.execute(
				`deepseek-cordis:${name}:${Date.now().toString(36)}`,
				argumentsValue,
				signal,
				undefined,
				session.extensionRunner.createContext(),
			);
			return { content: result.content, details: result.details, ...(result.usage ? { usage: result.usage } : {}) };
		},
		prompt: promptFn,
		abort: abortFn,
		capability: createDeepSeekPiCapabilityRuntime({
			session: {
				get: () => currentSessionProjection(),
				list: (cwd, _context) => listSessions(cwd),
				listWorkspaces: (_context) => listWorkspaces(),
			},
			subagent: {
				list: (parentSessionId, _context) => listSubagentChildren(parentSessionId),
				prompt: (parentSessionId, childSessionId, text, _context) => promptSubagent(parentSessionId, childSessionId, [{ type: "text", text }]),
				interrupt: (parentSessionId, childSessionId, _context) => interruptSubagent(parentSessionId, childSessionId),
			},
		}, {
			onAudit: (entry) => emitPluginEvent("deepseek-cordis/pi-capability", entry),
		}),
	};
	const nextRuntime = new DeepSeekCordisRuntime({
		cordisModule,
		importer: async (specifier) => {
			const executionAdapter = DEEPSEEK_EXECUTION_PACKAGES.has(specifier)
				? createDshExecutionAdapter(specifier, executionServices)
				: undefined;
			if (executionAdapter) return { default: executionAdapter };
			return importer(specifier);
		},
		bootstrap: (context) => {
			const target = context as {
				provide?: (name: string, value: unknown) => unknown;
				on?: (name: string, listener: (...args: any[]) => unknown, options?: unknown) => () => unknown;
			};
			if (typeof target.provide !== "function") throw new Error("deepseek-cordis: Context.provide is unavailable for Pi bridge");
			const disposers: Array<() => unknown> = [];
			for (const [key, value] of [
				["subprocess", executionServices.subprocess],
				["sandboxPolicy", executionServices.sandboxPolicy],
				["sandbox", executionServices.sandbox],
			] as const) {
				const restore = target.provide?.(key, value);
				if (typeof restore === "function") disposers.push(restore as () => unknown);
			}
			const provided = target.provide("pi", createDeepSeekPiBridge(piBridgeRuntime));
			if (typeof provided === "function") disposers.push(provided as () => unknown);
			const sessionsProvided = target.provide("sessions", {
				list: () => piBridgeRuntime.listPersistedSessions(cwd),
			});
			if (typeof sessionsProvided === "function") disposers.push(sessionsProvided as () => unknown);
			if (typeof target.on === "function") {
				const disposeLlm = target.on("llm/stream", createDeepSeekPiLlmInterceptor(piBridgeRuntime), { prepend: true });
				if (typeof disposeLlm === "function") disposers.push(disposeLlm);
				const disposeTools = target.on("tools/execute", createDeepSeekPiToolInterceptor(piBridgeRuntime), { prepend: true });
				if (typeof disposeTools === "function") disposers.push(disposeTools);
			}
			return async () => {
				for (const dispose of disposers.reverse()) await dispose();
			};
		},
		onPluginActive: (context, entry) => entry.name === "@deepseek-ai/dsh-tools"
			? createDeepSeekPiToolPlugin(piBridgeRuntime)(context)
			: undefined,
		allowInvocation: allowDeepSeekCordisInvocation,
		onEvent: (type, payload) => emitPluginEvent(`deepseek-cordis/${type}`, payload),
	});
	let nextSnapshot: DeepSeekCordisRuntimeSnapshot;
	try {
		nextSnapshot = await nextRuntime.load(runtimeEntries);
	} catch (error) {
		await nextRuntime.dispose().catch((disposeError) => {
			console.warn("[openbuddy] failed to dispose rejected DeepSeek Cordis runtime", disposeError);
		});
		throw error;
	}
	const previousRuntime = state.deepSeekCordisRuntime;
	state.deepSeekCordisRuntime = nextRuntime;
	state.deepSeekCordisSnapshot = nextSnapshot;
	state.deepSeekPiToolSync?.();
	await previousRuntime?.dispose();
	emitPluginEvent("deepseek-cordis/snapshot", state.deepSeekCordisSnapshot);
}

export {
	createDeepSeekPiToolPlugin,
	syncDeepSeekCordisRuntime,
	deepSeekCoreRuntimeEntries,
	normalizeDeepSeekRuntimeEntry,
	filterPublishedCoreBundle,
	allowDeepSeekCordisInvocation,
	isDeepSeekCorePackage,
	currentSessionProjection,
};