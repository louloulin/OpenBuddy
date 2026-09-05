import { Context, OpenBuddyService, symbols } from "@openbuddy/cordis";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { parseRemoteCodec, type HarnessPlugin, type RemoteCodec, type TypertHostContribution } from "@openbuddy/plugin-host";
import { emitPiSessionEvent } from "../agent/pi-event-bridge";
import { lifecycleEntry, lifecycleEvent, hashLifecycleSecret, lifecycleRevisionFromEntries, OPENBUDDY_LIFECYCLE_CUSTOM_TYPE } from "@openbuddy/core-session/lifecycle";

type PiRuntime = {
  getSession: () => PiSession | null;
  getModel: () => Model<any> | undefined;
  prompt: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  onEvent: (handler: (event: unknown) => void) => () => void;
};

export type DeepSeekTypertRegistryChange = {
  kind: "local" | "remote" | "lookup" | "host-context" | "client-context" | "package" | "transaction";
  key: string;
  operation: "added" | "removed" | "changed";
  package?: string;
  face?: "host";
  endpoints?: string[];
  schemas?: string[];
  packages?: string[];
  revision: number;
};

type DeepSeekLookupDefinition = {
  key: string;
  parameter: string;
  wire: string;
  hostTypeSymbol: string;
  wireTypeSymbol: string;
};

type DeepSeekLookupProvider = Omit<DeepSeekLookupDefinition, "key"> & {
  resolve: (value: unknown) => unknown | Promise<unknown>;
};

type DeepSeekHostContextProvider = {
  wire: string;
  wireTypeSymbol: string;
  resolve: (value: unknown) => Context | undefined | Promise<Context | undefined>;
};

type AgentHostRuntime = {
  getSessionId?: () => string | undefined;
  prompt: (text: string) => Promise<void>;
  steer?: (text: string) => Promise<void>;
  followUp?: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  newSession?: (cwd: string) => Promise<{ sessionId?: string; sessionFile?: string; cwd: string }>;
  loadSession?: (sessionId: string, cwd: string) => Promise<void>;
  listSessions?: (cwd: string) => Promise<unknown[]>;
	listAllSessions?: () => Promise<unknown[]>;
	listSessionInfos?: () => Promise<Array<{
		id: string;
		cwd?: string;
		title?: string;
		name?: string;
		timestamp?: string;
		parentSessionId?: string;
		path?: string;
		created?: string;
		modified?: string;
		createdAt?: number;
		messageCount?: number;
		firstMessage?: string;
		allMessagesText?: string;
	}>>;
	listSessionHeaders?: () => Promise<Array<{ id: string; cwd?: string; title?: string; name?: string; parentSessionId?: string; createdAt?: number; created?: string; timestamp?: string }>>;
	readSessionHeader?: (sessionId: string) => Promise<{ id?: string; cwd?: string; title?: string; name?: string; timestamp?: string; parentSessionId?: string }>;
	readSessionEntries?: (sessionId: string) => Promise<unknown[]>;
	readSessionRaw?: (sessionId: string) => Promise<{ path: string; content: string; header: Record<string, unknown> } | undefined>;
	readSessionRevision?: (sessionId: string) => Promise<{ path: string; revision: string; entryCount: number } | undefined>;
	appendSessionEntry?: (sessionId: string, customType: string, data: unknown) => Promise<string>;
	appendSessionEntries?: (sessionId: string, entries: Array<{ customType: string; data: unknown }>, options?: { expectedRevision?: number; expectedSourceRevision?: string; allowPreparation?: boolean }) => Promise<{ entryIds: string[]; sourceRevision: string; entryCount: number }>;
	createPersistedSession?: (meta: { id: string; cwd?: string; parentSession?: string }) => Promise<{ sessionId: string; sessionFile?: string; cwd: string }>;
  reserveAgent?: (sessionId: string, operation: "create" | "resume") => Promise<{ token: string; heartbeatMs?: number; renew?: () => Promise<void> | void; release: () => Promise<void> | void }>;
  reservePreparation?: (sessionId: string) => Promise<{ token: string; heartbeatMs?: number; renew?: () => Promise<void> | void; release: () => Promise<void> | void }>;
  listWorkspaces?: () => Promise<unknown[]>;
  sessionInfo?: (sessionId: string) => unknown;
  sessionUsage?: (sessionId: string) => unknown;
  setModel?: (modelId: string) => Promise<void>;
  createAgent?: (options: {
    sessionId: string;
    cwd?: string;
    parentSession?: string;
    provider?: string;
    model?: string;
    maxTokens?: number;
    seed?: readonly unknown[];
    toolHooks?: DeepSeekPiToolHooks;
    signal?: AbortSignal;
  }) => Promise<DeepSeekPiAgentRuntime>;
  resumeAgent?: (options: {
    sessionId: string;
    provider?: string;
    model?: string;
    maxTokens?: number;
    toolHooks?: DeepSeekPiToolHooks;
    signal?: AbortSignal;
  }) => Promise<DeepSeekPiAgentRuntime>;
};

const DEEPSEEK_REPAIR_CUSTOM_TYPE = "deepseek/session-repair";

type DeepSeekRepairMarker = {
	version: 1;
	operation: "begin" | "commit";
	repairId: string;
	sourceRevision?: string;
	entryCount: number;
	createdAt: number;
};

export type DeepSeekToolExecution = {
  agent: unknown;
  toolCallId: string;
  toolName: string;
  args: unknown;
  signal: AbortSignal | undefined;
};

export type DeepSeekToolDecision = { kind: "allow" } | { kind: "reject"; message?: string };

export type DeepSeekPiToolHooks = {
  preExecute?: (execution: DeepSeekToolExecution) => Promise<DeepSeekToolDecision>;
  execute?: (execution: DeepSeekToolExecution, next: () => Promise<unknown>) => Promise<unknown>;
  postExecute?: (execution: DeepSeekToolExecution, result: unknown) => Promise<unknown>;
  result?: (execution: DeepSeekToolExecution, result: unknown) => Promise<void> | void;
};

export type DeepSeekPiAgentRuntime = {
  sessionId: string;
  cwd?: string;
  modelId?: string;
  setModel?: (provider: string, model: string) => Promise<void>;
  setToolAgent?: (agent: unknown) => void;
  setToolHooks?: (hooks: DeepSeekPiToolHooks | undefined) => void;
  messages: unknown[];
  isStreaming: boolean;
  prompt: (text: string) => Promise<void>;
  steer: (text: string) => Promise<void>;
  followUp: (text: string) => Promise<void>;
  inject: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  waitForIdle: () => Promise<void>;
  subscribe: (listener: (event: unknown) => void) => () => void;
  getEntries?: () => readonly unknown[];
  appendCustomEntry?: (customType: string, data?: unknown) => string;
  dispose: () => Promise<void>;
};

type WorkspaceAuthorizationSnapshot = {
	workspaceId: string;
	revision: number;
	sessionIds: readonly string[];
};

type PiSession = {
  sessionId: string;
  cwd?: string;
  model?: Model<any>;
  messages: unknown[];
  isStreaming?: boolean;
  getAllTools?: () => Array<{ name: string; description?: string; parameters?: unknown }>;
  prompt: (text: string) => Promise<void>;
  steer: (text: string) => Promise<void>;
  followUp: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  subscribe: (listener: (event: unknown) => void) => () => void;
};

type RuntimeContext = Context & {
	get(name: string): any;
};

export type DeepSeekConnectionAuthority = "trusted-host" | "loopback";

export type DeepSeekConnectionDispatchContext = {
	authority: DeepSeekConnectionAuthority;
	/** Stable caller identity used for recovery claims and audit correlation. */
	caller?: string;
};

export type DeepSeekConnectionHandler = (
	endpoint: string,
	payload: unknown,
	signal: AbortSignal,
) => Promise<unknown>;

export type DeepSeekConnectionHandlerOptions = {
	authority: DeepSeekConnectionAuthority;
};

type DeepSeekConnectionRoute = {
	channel: string;
	match: (endpoint: string) => boolean;
	handler: DeepSeekConnectionHandler;
	options: DeepSeekConnectionHandlerOptions;
};

function assertConnectionChannel(channel: string): void {
	if (!/^\/[A-Za-z0-9._~-]+$/.test(channel) || channel === "/api") {
		throw new Error(`dsh-client-connection: invalid or reserved channel ${JSON.stringify(channel)}`);
	}
}

function authorityAllowed(route: DeepSeekConnectionRoute, request: DeepSeekConnectionDispatchContext): boolean {
	return route.options.authority === "trusted-host" || request.authority === "loopback";
}

/** Pi-backed Host half of the DeepSeek Connection RPC contract. */
export class DeepSeekHostConnectionService extends OpenBuddyService {
	static override provide = "connection";

	private readonly routes = new Map<string, DeepSeekConnectionRoute>();
	private sharedInterceptor: DeepSeekConnectionRoute | undefined;

	readonly rpc = {
		handle: (
			channel: string,
			handler: DeepSeekConnectionHandler,
			options: DeepSeekConnectionHandlerOptions,
		): (() => Promise<void>) => {
			assertConnectionChannel(channel);
			if (typeof handler !== "function") throw new Error("dsh-client-connection: handler must be a function");
			if (this.routes.has(channel)) throw new Error(`dsh-client-connection: channel is already registered: ${channel}`);
			const route: DeepSeekConnectionRoute = { channel, match: () => true, handler, options };
			const effect = this.ctx.effect(() => {
				this.routes.set(channel, route);
				return () => { if (this.routes.get(channel) === route) this.routes.delete(channel); };
			}, `dsh-client-connection: ${channel} rpc channel`) as unknown;
			return async () => {
				if (typeof effect === "function") effect();
				else if (effect && typeof effect === "object" && "dispose" in effect && typeof (effect as { dispose?: unknown }).dispose === "function") (effect as { dispose: () => void }).dispose();
			};
		},
		intercept: (
			channel: "/api",
			matches: (endpoint: string) => boolean,
			handler: DeepSeekConnectionHandler,
			options: DeepSeekConnectionHandlerOptions,
		): (() => Promise<void>) => {
			if (channel !== "/api") throw new Error("dsh-client-connection: only /api supports interception");
			if (typeof matches !== "function" || typeof handler !== "function") throw new Error("dsh-client-connection: invalid interceptor");
			if (this.sharedInterceptor) throw new Error("dsh-client-connection: /api interceptor is already registered");
			const route: DeepSeekConnectionRoute = { channel, match: matches, handler, options };
			const effect = this.ctx.effect(() => {
				this.sharedInterceptor = route;
				return () => { if (this.sharedInterceptor === route) this.sharedInterceptor = undefined; };
			}, "dsh-client-connection: /api interceptor") as unknown;
			return async () => {
				if (typeof effect === "function") effect();
				else if (effect && typeof effect === "object" && "dispose" in effect && typeof (effect as { dispose?: unknown }).dispose === "function") (effect as { dispose: () => void }).dispose();
			};
		},
	};

	constructor(ctx: Context) {
		super(ctx, "connection");
	}

	async dispatch(
		method: string,
		payload: unknown,
		signal: AbortSignal,
		request: DeepSeekConnectionDispatchContext,
	): Promise<{ handled: boolean; value?: unknown }> {
		const shared = this.sharedInterceptor;
		if (shared?.match(method)) {
			if (!authorityAllowed(shared, request)) throw Object.assign(new Error("dsh-client-connection: loopback authority required"), { code: "forbidden" });
			return { handled: true, value: await shared.handler(method, payload, signal) };
		}
		for (const route of this.routes.values()) {
			const prefix = `${route.channel.slice(1)}/`;
			if (!method.startsWith(prefix)) continue;
			const endpoint = method.slice(prefix.length);
			if (!endpoint || !route.match(endpoint)) continue;
			if (!authorityAllowed(route, request)) throw Object.assign(new Error("dsh-client-connection: loopback authority required"), { code: "forbidden" });
			return { handled: true, value: await route.handler(endpoint, payload, signal) };
		}
		return { handled: false };
	}
}

type DeepSeekMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: unknown;
  [key: string]: unknown;
};

type DeepSeekModel = {
  provider: string;
  id: string;
  name: string;
  context?: { contextWindow: number };
  defaultMaxTokens?: number;
  inputModalities?: readonly string[];
};

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const value = part as { type?: unknown; text?: unknown; content?: unknown };
    if (value.type === "text" && typeof value.text === "string") return value.text;
    return typeof value.content === "string" ? value.content : "";
  }).join("");
}

function toPiMessages(messages: readonly DeepSeekMessage[]): any[] {
  return messages.filter((message) => message.role !== "system").map((message) => {
    if (message.role === "tool") {
      return {
        role: "toolResult",
        toolCallId: String(message.toolCallId ?? message.callId ?? "dsh-tool"),
        toolName: String(message.toolName ?? "tool"),
        content: [{ type: "text", text: textContent(message.content) }],
        isError: Boolean(message.isError),
        timestamp: Date.now(),
      };
    }
    return {
      role: message.role,
      content: message.role === "assistant" ? [{ type: "text", text: textContent(message.content) }] : textContent(message.content),
      timestamp: typeof message.timestamp === "number" ? message.timestamp : Date.now(),
    };
  });
}

function modelInfo(model: Model<any>): DeepSeekModel {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name,
    context: { contextWindow: model.contextWindow },
    defaultMaxTokens: model.maxTokens,
    inputModalities: [...model.input],
  };
}

function modelId(provider: unknown, model: unknown): string {
  if (typeof provider !== "string" || !provider) throw new Error("dsh-llm: provider is required");
  if (typeof model !== "string" || !model) throw new Error("dsh-llm: model is required");
  return `${provider}/${model}`;
}

export class DeepSeekTypertService extends OpenBuddyService {
  static override provide = "typert";
  readonly contexts: {
    registerClient: (key: string, binder: { identity: (context: Context) => unknown }) => () => void;
    registerHost: (key: string, provider: DeepSeekHostContextProvider) => () => void;
    configureHost: (key: string, resolver: (value: unknown) => Context | undefined | Promise<Context | undefined>) => () => void;
    getClient: (key: string) => { identity: (context: Context) => unknown } | undefined;
    getHost: (key: string) => DeepSeekHostContextProvider | undefined;
    subscribe: (listener: (change: { kind: "host-context" | "client-context"; key: string }) => void) => () => void;
  };
  readonly lookups: {
    register: (key: string, provider: DeepSeekLookupProvider) => () => void;
    configure: (key: string, resolver: (value: unknown) => unknown | Promise<unknown>) => () => void;
    get: (key: string) => DeepSeekLookupProvider | undefined;
    definitions: () => DeepSeekLookupDefinition[];
    keys: () => string[];
    subscribe: (listener: (change: { kind: "lookup"; key: string }) => void) => () => void;
  };
  readonly remotes: {
    register: (contribution: unknown) => () => unknown;
    unregister: (packageName: unknown) => unknown;
    get: (endpoint: string) => unknown;
    list: () => unknown[];
  };
  readonly local: {
    get: (endpoint: string) => unknown;
    hasSeen: (endpoint: string) => boolean;
    list: () => unknown[];
    subscribe: (listener: (change: { kind: "local"; key: string }) => void) => () => void;
  };
  readonly register: (contribution: unknown) => () => void;
  readonly get: (key: string) => { package: string; face: "host"; key: string; name: string; schema: object } | undefined;
  readonly resolve: (key: string) => { package: string; face: "host"; key: string; name: string; schema: object };
  readonly list: (filter?: { package?: string; face?: "host" }) => Array<{ package: string; face: "host"; key: string; name: string; schema: object }>;
  readonly getPackage: (packageName: string, face?: "host") => { package: string; face: "host"; key: string; model: Record<string, unknown>; invocations: unknown[] } | undefined;
  readonly listPackages: (filter?: { package?: string; face?: "host" }) => Array<{ package: string; face: "host"; key: string; model: Record<string, unknown>; invocations: unknown[] }>;
  readonly toJSONSchema: (key: string, params?: Record<string, unknown>) => Record<string, unknown>;
  readonly revision: () => number;
  readonly subscribe: (listener: (change: DeepSeekTypertRegistryChange) => void) => () => void;
  readonly beginTransaction: () => { commit: () => void; rollback: () => void };

  constructor(ctx: Context) {
    super(ctx, "typert");
    const managed = (dispose: () => void, label: string): (() => void) => {
      const effect = ctx.effect(() => dispose, label) as unknown;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        if (typeof effect === "function") effect();
        else if (effect && typeof effect === "object" && "dispose" in effect && typeof effect.dispose === "function") effect.dispose();
      };
    };
    const providers = new Map<string, DeepSeekLookupProvider>();
    const lookupResolvers = new Map<string, { resolve: (value: unknown) => unknown | Promise<unknown> }>();
    const lookupDefinitions = new Map<string, DeepSeekLookupDefinition>();
    const lookupListeners = new Set<(change: { kind: "lookup"; key: string }) => void>();
    type HostRecord = TypertHostContribution & { key: string };
    const contributions = new Map<string, HostRecord>();
    const schemas = new Map<string, { package: string; face: "host"; key: string; name: string; schema: object }>();
    const localDescriptors = new Map<string, unknown>();
    const localSeen = new Set<string>();
    const localListeners = new Set<(change: { kind: "local"; key: string }) => void>();
    const contextListeners = new Set<(change: { kind: "host-context" | "client-context"; key: string }) => void>();
    const registryListeners = new Set<(change: DeepSeekTypertRegistryChange) => void>();
    let registryRevision = 0;
    let transactionDepth = 0;
    let transactionChanged = false;
    const emitRegistry = (change: Omit<DeepSeekTypertRegistryChange, "revision">): void => {
      if (transactionDepth > 0) {
        transactionChanged = true;
        return;
      }
      const next = { ...change, revision: ++registryRevision };
      for (const listener of [...registryListeners]) {
        try { listener(next); } catch { /* isolate registry observers */ }
      }
    };
    const emitTransaction = (): void => {
      if (!transactionChanged) return;
      transactionChanged = false;
      const next = {
        kind: "transaction",
        key: "registry",
        operation: "changed",
        packages: [...contributions.values()].map((entry) => entry.package),
        revision: ++registryRevision,
      } satisfies DeepSeekTypertRegistryChange;
      for (const listener of [...registryListeners]) {
        try { listener(next); } catch { /* isolate registry observers */ }
      }
    };
    const emitLocal = (key: string): void => {
      const change = { kind: "local" as const, key };
      for (const listener of [...localListeners]) {
        try { listener(change); } catch { /* isolate registry observers */ }
      }
    };
    const clientContexts = new Map<string, { identity: (context: Context) => unknown }>();
    const hostContexts = new Map<string, DeepSeekHostContextProvider>();
    const hostContextResolvers = new Map<string, (value: unknown) => Context | undefined | Promise<Context | undefined>>();
    const register = <T>(table: Map<string, T>, key: string, value: T, kind: string): (() => void) => {
      if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) throw new Error(`dsh-typert: ${kind} key is invalid: ${key}`);
      if (table.has(key)) throw new Error(`dsh-typert: ${kind} provider is already registered: ${key}`);
      table.set(key, value);
      let active = true;
      return managed(() => {
        if (!active) return;
        active = false;
        if (table.get(key) === value) table.delete(key);
      }, `dsh-typert.${kind}(${JSON.stringify(key)})`);
    };
    this.contexts = {
      registerClient: (key, binder) => {
        if (!binder || typeof binder.identity !== "function") throw new Error(`dsh-typert: client context provider is invalid: ${key}`);
        const dispose = register(clientContexts, key, binder, "client context");
        contextListeners.forEach((listener) => { try { listener({ kind: "client-context", key }); } catch {} });
        emitRegistry({ kind: "client-context", key, operation: "added" });
        return managed(() => { dispose(); contextListeners.forEach((listener) => { try { listener({ kind: "client-context", key }); } catch {} }); emitRegistry({ kind: "client-context", key, operation: "removed" }); }, `dsh-typert.contexts.registerClient(${JSON.stringify(key)})`);
      },
      registerHost: (key, provider) => {
        if (!provider || typeof provider.resolve !== "function") throw new Error(`dsh-typert: host context provider is invalid: ${key}`);
        if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) throw new Error(`dsh-typert: host context key is invalid: ${key}`);
        if (typeof provider.wire !== "string" || !provider.wire) throw new Error(`dsh-typert: host context wire is required: ${key}`);
        if (typeof provider.wireTypeSymbol !== "string" || !provider.wireTypeSymbol) throw new Error(`dsh-typert: host context wire type symbol is required: ${key}`);
        if (hostContexts.has(key)) throw new Error(`dsh-typert: host context provider is already registered: ${key}`);
        hostContexts.set(key, provider);
        contextListeners.forEach((listener) => { try { listener({ kind: "host-context", key }); } catch {} });
        emitRegistry({ kind: "host-context", key, operation: "added" });
        return managed(() => { if (hostContexts.get(key) === provider) hostContexts.delete(key); contextListeners.forEach((listener) => { try { listener({ kind: "host-context", key }); } catch {} }); emitRegistry({ kind: "host-context", key, operation: "removed" }); }, `dsh-typert.contexts.registerHost(${JSON.stringify(key)})`);
      },
      configureHost: (key, resolver) => {
        if (typeof resolver !== "function") throw new Error(`dsh-typert: host context resolver is invalid: ${key}`);
        if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) throw new Error(`dsh-typert: host context key is invalid: ${key}`);
        if (hostContextResolvers.has(key)) throw new Error(`dsh-typert: host context resolver is already configured: ${key}`);
        hostContextResolvers.set(key, resolver);
        contextListeners.forEach((listener) => { try { listener({ kind: "host-context", key }); } catch {} });
        emitRegistry({ kind: "host-context", key, operation: "added" });
        return managed(() => { if (hostContextResolvers.get(key) === resolver) hostContextResolvers.delete(key); contextListeners.forEach((listener) => { try { listener({ kind: "host-context", key }); } catch {} }); emitRegistry({ kind: "host-context", key, operation: "removed" }); }, `dsh-typert.contexts.configureHost(${JSON.stringify(key)})`);
      },
      getClient: (key) => clientContexts.get(key),
      getHost: (key) => {
        const provider = hostContexts.get(key);
        const resolver = hostContextResolvers.get(key);
        if (!provider) return undefined;
        if (!resolver) return provider;
        return {
          wire: provider.wire,
          wireTypeSymbol: provider.wireTypeSymbol,
          resolve: resolver,
        };
      },
      subscribe: (listener) => {
        contextListeners.add(listener);
        return managed(() => contextListeners.delete(listener), "dsh-typert.contexts.subscribe");
      },
    };
    this.lookups = {
      register: (key, provider) => {
        if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) throw new Error(`dsh-typert: lookup key is invalid: ${key}`);
        if (!provider || typeof provider.resolve !== "function") throw new Error(`dsh-typert: lookup provider is invalid: ${key}`);
        if (typeof provider.parameter !== "string" || !provider.parameter) throw new Error(`dsh-typert: lookup parameter is required: ${key}`);
        if (typeof provider.wire !== "string" || !provider.wire) throw new Error(`dsh-typert: lookup wire is required: ${key}`);
        if (typeof provider.hostTypeSymbol !== "string" || !provider.hostTypeSymbol) throw new Error(`dsh-typert: lookup host type symbol is required: ${key}`);
        if (typeof provider.wireTypeSymbol !== "string" || !provider.wireTypeSymbol) throw new Error(`dsh-typert: lookup wire type symbol is required: ${key}`);
        if (providers.has(key)) throw new Error(`dsh-typert: lookup provider is already registered: ${key}`);
        const definition: DeepSeekLookupDefinition = {
          key,
          parameter: provider.parameter,
          wire: provider.wire,
          hostTypeSymbol: provider.hostTypeSymbol,
          wireTypeSymbol: provider.wireTypeSymbol,
        };
        const known = lookupDefinitions.get(key);
        if (known && (known.parameter !== definition.parameter
          || known.wire !== definition.wire
          || known.hostTypeSymbol !== definition.hostTypeSymbol
          || known.wireTypeSymbol !== definition.wireTypeSymbol)) {
          throw new Error(`dsh-typert: lookup ${JSON.stringify(key)} changed its wire declaration during this registry lifetime`);
        }
        lookupDefinitions.set(key, definition);
        providers.set(key, provider);
        lookupListeners.forEach((listener) => { try { listener({ kind: "lookup", key }); } catch {} });
        emitRegistry({ kind: "lookup", key, operation: "added" });
        let active = true;
        return managed(() => {
          if (!active) return;
          active = false;
          if (providers.get(key) === provider) providers.delete(key);
          lookupListeners.forEach((listener) => { try { listener({ kind: "lookup", key }); } catch {} });
          emitRegistry({ kind: "lookup", key, operation: "removed" });
        }, `dsh-typert.lookups.register(${JSON.stringify(key)})`);
      },
      configure: (key, resolver) => {
        if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) throw new Error(`dsh-typert: lookup key is invalid: ${key}`);
        if (typeof resolver !== "function") throw new Error(`dsh-typert: lookup resolver is invalid: ${key}`);
        if (lookupResolvers.has(key)) throw new Error(`dsh-typert: lookup resolver is already configured: ${key}`);
        const configured = { resolve: resolver };
        lookupResolvers.set(key, configured);
        lookupListeners.forEach((listener) => { try { listener({ kind: "lookup", key }); } catch {} });
        emitRegistry({ kind: "lookup", key, operation: "added" });
        return managed(() => { if (lookupResolvers.get(key) === configured) lookupResolvers.delete(key); lookupListeners.forEach((listener) => { try { listener({ kind: "lookup", key }); } catch {} }); emitRegistry({ kind: "lookup", key, operation: "removed" }); }, `dsh-typert.lookups.configure(${JSON.stringify(key)})`);
      },
      get: (key) => {
        const provider = providers.get(key);
        const resolver = lookupResolvers.get(key);
        if (!provider && !resolver) return undefined;
        if (!resolver && provider) return provider;
        if (!provider) return undefined;
        return {
          ...provider,
          resolve: resolver!.resolve,
        };
      },
      definitions: () => [...lookupDefinitions.values()],
      keys: () => [...providers.keys()],
      subscribe: (listener) => {
        lookupListeners.add(listener);
        return managed(() => lookupListeners.delete(listener), "dsh-typert.lookups.subscribe");
      },
    };
    const remote = ctx.get("dshRemote") as {
      register: (contribution: unknown) => () => unknown;
      unregister: (packageName: unknown) => unknown;
      list: () => string[];
      get?: (endpoint: string) => unknown;
      descriptors?: () => unknown[];
    } | undefined;
    const fallback: NonNullable<typeof remote> = {
      register: () => () => undefined,
      unregister: () => ({ package: "", removed: false }),
      list: () => [] as string[],
    };
    const active = remote ?? fallback;
    this.remotes = {
      register: (contribution) => active.register(contribution),
      unregister: (packageName) => active.unregister(packageName),
      get: (endpoint) => active.get?.(endpoint) ?? active.descriptors?.().find((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const item = entry as { namespace?: unknown; method?: unknown };
        return `${String(item.namespace)}/${String(item.method)}` === endpoint;
      }),
      list: () => active.descriptors?.() ?? active.list() as unknown[],
    };
    const validateContribution = (value: unknown): TypertHostContribution => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("dsh-typert: contribution must be an object");
      const contribution = value as TypertHostContribution;
      if (typeof contribution.package !== "string" || !contribution.package) throw new Error("dsh-typert: contribution.package is required");
      if (contribution.face !== "host") throw new Error(`dsh-typert: ${contribution.package} contribution.face must be host`);
      if (!Array.isArray(contribution.schemas) || !Array.isArray(contribution.invocations)
        || !contribution.model || typeof contribution.model !== "object") {
        throw new Error(`dsh-typert: ${contribution.package} contribution is invalid`);
      }
      for (const [index, schema] of contribution.schemas.entries()) {
        if (!schema || typeof schema !== "object" || typeof schema.name !== "string" || !schema.name
          || !schema.schema || typeof schema.schema !== "object") {
          throw new Error(`dsh-typert: ${contribution.package} schema[${index}] is invalid`);
        }
        if (schemas.has(`${contribution.package}#${schema.name}`)) throw new Error(`dsh-typert: schema is already registered: ${contribution.package}#${schema.name}`);
      }
      return contribution;
    };
    this.register = (value) => {
      const contribution = validateContribution(value);
      const key = `${contribution.package}#host`;
      if (contributions.has(key)) throw new Error(`dsh-typert: package is already registered: ${contribution.package}`);
      const schemaKeys = new Set<string>();
      const invocationEndpoints = new Set<string>();
      for (const item of contribution.schemas) {
        const schemaKey = `${contribution.package}#${item.name}`;
        if (schemaKeys.has(schemaKey) || schemas.has(schemaKey)) throw new Error(`dsh-typert: schema is already registered: ${schemaKey}`);
        schemaKeys.add(schemaKey);
      }
      for (const invocation of contribution.invocations) {
        if (!invocation || typeof invocation !== "object") throw new Error(`dsh-typert: ${contribution.package} invocation is invalid`);
        const item = invocation as { namespace?: unknown; method?: unknown; id?: unknown };
        if (typeof item.namespace !== "string" || typeof item.method !== "string" || typeof item.id !== "string") {
          throw new Error(`dsh-typert: ${contribution.package} invocation is invalid`);
        }
        const endpoint = `${item.namespace}/${item.method}`;
        if (invocationEndpoints.has(endpoint) || localDescriptors.has(endpoint)) throw new Error(`dsh-typert: local endpoint is already registered: ${endpoint}`);
        invocationEndpoints.add(endpoint);
      }
      const record: HostRecord = { ...contribution, key };
      contributions.set(key, record);
      for (const item of contribution.schemas) {
        const schemaKey = `${contribution.package}#${item.name}`;
        schemas.set(schemaKey, { package: contribution.package, face: "host", key: schemaKey, name: item.name, schema: item.schema });
      }
      for (const invocation of contribution.invocations) {
        const item = invocation as { namespace: string; method: string };
        const endpoint = `${item.namespace}/${item.method}`;
        localDescriptors.set(endpoint, invocation);
        localSeen.add(endpoint);
        emitLocal(endpoint);
      }
      emitRegistry({
        kind: "package",
        key,
        operation: "added",
        package: contribution.package,
        face: "host",
        endpoints: contribution.invocations.map((item) => `${(item as { namespace: string }).namespace}/${(item as { method: string }).method}`),
        schemas: contribution.schemas.map((item) => `${contribution.package}#${item.name}`),
      });
      let active = true;
      return managed(() => {
        if (!active) return;
        active = false;
        if (contributions.get(key) !== record) return;
        contributions.delete(key);
        for (const item of contribution.schemas) schemas.delete(`${contribution.package}#${item.name}`);
        for (const invocation of contribution.invocations) {
          const item = invocation as { namespace: string; method: string };
          const endpoint = `${item.namespace}/${item.method}`;
          if (localDescriptors.get(endpoint) === invocation) {
            localDescriptors.delete(endpoint);
            emitLocal(endpoint);
          }
        }
        emitRegistry({
          kind: "package",
          key,
          operation: "removed",
          package: contribution.package,
          face: "host",
          endpoints: contribution.invocations.map((item) => `${(item as { namespace: string }).namespace}/${(item as { method: string }).method}`),
          schemas: contribution.schemas.map((item) => `${contribution.package}#${item.name}`),
        });
      }, `dsh-typert.register(${JSON.stringify(contribution.package)})`);
    };
    this.local = {
      get: (endpoint) => localDescriptors.get(endpoint),
      hasSeen: (endpoint) => localSeen.has(endpoint),
      list: () => [...localDescriptors.values()],
      subscribe: (listener) => {
        localListeners.add(listener);
        return () => localListeners.delete(listener);
      },
    };
    this.get = (key) => schemas.get(key);
    this.resolve = (key) => {
      const schema = schemas.get(key);
      if (!schema) throw new Error(`dsh-typert: schema is not registered: ${key}`);
      return schema;
    };
    this.list = (filter = {}) => [...schemas.values()]
      .filter((schema) => (filter.package === undefined || schema.package === filter.package))
      .map((schema) => ({ ...schema }));
    this.getPackage = (packageName) => {
      const contribution = contributions.get(`${packageName}#host`);
      return contribution ? { package: contribution.package, face: "host" as const, key: contribution.key, model: contribution.model, invocations: [...contribution.invocations] } : undefined;
    };
    this.listPackages = (filter = {}) => [...contributions.values()]
      .filter((contribution) => filter.package === undefined || contribution.package === filter.package)
      .map((contribution) => ({ package: contribution.package, face: "host" as const, key: contribution.key, model: contribution.model, invocations: contribution.invocations }));
    this.toJSONSchema = (key, params = {}) => {
      const schema = schemas.get(key)?.schema as { toJSONSchema?: (options?: Record<string, unknown>) => unknown; _zod?: { toJSONSchema?: (options?: Record<string, unknown>) => unknown } } | undefined;
      if (!schema) throw new Error(`dsh-typert: schema is not registered: ${key}`);
      if (typeof schema.toJSONSchema === "function") return schema.toJSONSchema(params) as Record<string, unknown>;
      if (typeof schema._zod?.toJSONSchema === "function") return schema._zod.toJSONSchema(params) as Record<string, unknown>;
      throw new Error(`dsh-typert: schema cannot be projected to JSON Schema: ${key}`);
    };
    this.revision = () => registryRevision;
    this.subscribe = (listener) => {
      registryListeners.add(listener);
      return () => registryListeners.delete(listener);
    };
    this.beginTransaction = () => {
      transactionDepth += 1;
      let active = true;
      const finish = (commit: boolean): void => {
        if (!active) return;
        active = false;
        transactionDepth = Math.max(0, transactionDepth - 1);
        if (!commit && transactionDepth === 0) transactionChanged = false;
        if (transactionDepth === 0 && commit) emitTransaction();
      };
      return { commit: () => finish(true), rollback: () => finish(false) };
    };
  }
}

export class DeepSeekTypertLoaderService extends OpenBuddyService {
  static override provide = "typertLoader";
  static inject = ["typert"];

  constructor(ctx: Context) {
    super(ctx, "typertLoader");
  }
}

export class DeepSeekTypertGatewayService extends OpenBuddyService {
  static override provide = "typertGateway";
  static inject = ["typert", "typertLoader", "connection"];

  readonly invoke: (request: unknown) => Promise<unknown>;

  constructor(ctx: Context) {
    super(ctx, "typertGateway");
    const connection = ctx.get("connection") as { rpc?: { intercept?: (channel: "/api", matches: (endpoint: string) => boolean, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>, options: { authority: "trusted-host" }) => (() => Promise<void>) } } | undefined;
    const intercept = connection?.rpc?.intercept;
    if (intercept) {
      const dispose = intercept.call(connection.rpc, "/api", (endpoint) => this.claimsEndpoint(ctx, endpoint), async (endpoint, payload, signal) => this.invoke({
        namespace: endpoint.slice(0, endpoint.indexOf("/")),
        method: endpoint.slice(endpoint.indexOf("/") + 1),
        args: payload && typeof payload === "object" && !Array.isArray(payload) && "args" in payload
          ? (payload as { args: unknown }).args
          : payload,
        signal,
      }), { authority: "trusted-host" });
      ctx.effect(() => () => { void dispose(); }, "dsh-api-gateway: connection interceptor");
    }
    this.invoke = async (request: unknown) => {
      if (!request || typeof request !== "object" || Array.isArray(request)) {
        throw Object.assign(new Error("dsh-api-gateway: invocation request must be an object"), { code: "input-invalid" });
      }
      const value = request as Record<string, unknown>;
      const requestKeys = Object.keys(value);
      const unexpected = requestKeys.find((key) => !["package", "namespace", "method", "args", "signal"].includes(key));
      if (unexpected) {
        throw Object.assign(new Error(`dsh-api-gateway: unexpected request field ${unexpected}`), { code: "input-invalid", field: unexpected });
      }
      const namespace = value.namespace;
      const method = value.method;
      if (typeof namespace !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(namespace)
        || typeof method !== "string" || !/^[A-Za-z0-9_$.-]{1,80}$/.test(method)) {
        throw Object.assign(new Error("dsh-api-gateway: namespace and method are invalid"), { code: "input-invalid" });
      }
      const args = value.args === undefined ? {} : value.args;
      if (!args || typeof args !== "object" || Array.isArray(args) || Object.getPrototypeOf(args) !== Object.prototype) {
        throw Object.assign(new Error(`dsh-api-gateway: ${namespace}/${method} requires named arguments`), { code: "arguments-invalid" });
      }
      const signal = value.signal as AbortSignal | undefined;
      if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) {
        throw Object.assign(new Error(`dsh-api-gateway: ${namespace}/${method} has an invalid cancellation signal`), { code: "input-invalid", field: "signal" });
      }
      if (signal instanceof AbortSignal && signal.aborted) {
        throw Object.assign(new Error(`dsh-api-gateway: ${namespace}/${method} was cancelled`), { code: "cancelled" });
      }
      const typert = ctx.get("typert") as { local?: { get?: (endpoint: string) => unknown; hasSeen?: (endpoint: string) => boolean } } | undefined;
      const endpoint = `${namespace}/${method}`;
      const strictDescriptor = typert?.local?.get?.(endpoint) as GatewayInvocationDescriptor | undefined;
      if (strictDescriptor === undefined && typert?.local?.hasSeen?.(endpoint)) {
        throw Object.assign(new Error(`dsh-api-gateway: strict definition was withdrawn for ${endpoint}`), { code: "definition-unavailable", endpoint });
      }
      if (strictDescriptor !== undefined && typeof value.package === "string") {
        const packages = typert as { listPackages?: (filter?: { face?: "host" }) => Array<{ package?: string; invocations?: unknown[] }> };
        const owners = packages.listPackages?.({ face: "host" })?.filter((entry) => entry.invocations?.some((invocation) => {
          if (!invocation || typeof invocation !== "object") return false;
          const item = invocation as { namespace?: unknown; method?: unknown };
          return item.namespace === namespace && item.method === method;
        })).map((entry) => entry.package).filter((packageName): packageName is string => typeof packageName === "string") ?? [];
        if (owners.length > 0 && !owners.includes(value.package)) {
          throw Object.assign(new Error(`dsh-api-gateway: strict definition belongs to a different package for ${endpoint}`), { code: "provider-mismatch", endpoint, package: value.package, owners });
        }
      }
      if (isGatewayInvocationDescriptor(strictDescriptor)) {
        return this.invokeStrict(ctx, strictDescriptor, value, endpoint, signal);
      }
      const remote = ctx.get("dshRemote") as { invoke?: (request: unknown) => Promise<unknown> } | undefined;
      if (!remote?.invoke) throw Object.assign(new Error("dsh-api-gateway: Host Remote registry is not available"), { code: "service-unavailable" });
      const controller = signal instanceof AbortSignal ? new AbortController() : undefined;
      const onAbort = () => controller?.abort();
      signal?.addEventListener?.("abort", onAbort, { once: true });
      try {
        return await remote.invoke({
          ...(typeof value.package === "string" ? { package: value.package } : {}),
          namespace,
          method,
          args,
          ...(controller ? { signal: controller.signal } : {}),
        });
      } finally {
        signal?.removeEventListener?.("abort", onAbort);
      }
    };
  }

  private claimsEndpoint(ctx: Context, endpoint: string): boolean {
    const typert = ctx.get("typert") as { local?: { get?: (key: string) => unknown; hasSeen?: (key: string) => boolean } } | undefined;
    return typert?.local?.get?.(endpoint) !== undefined || typert?.local?.hasSeen?.(endpoint) === true;
  }

  private async invokeStrict(ctx: Context, descriptor: GatewayInvocationDescriptor, request: Record<string, unknown>, endpoint: string, signal: AbortSignal | undefined): Promise<unknown> {
    const args = request.args as Record<string, unknown>;
    const expected = new Set(descriptor.parameters.map((parameter) => parameter.wire));
    const contextInvocation = descriptor.invocation?.kind === "context" ? descriptor.invocation : undefined;
    if (contextInvocation?.wire) expected.add(contextInvocation.wire);
    const extra = Object.keys(args).filter((key) => !expected.has(key));
    const missing = descriptor.parameters.find((parameter) => !parameter.acceptsUndefined
      && parameter.codec?.mode !== "src-json"
      && !Object.hasOwn(args, parameter.wire));
    if (extra.length || missing) throw gatewayError("arguments-invalid", endpoint, "arguments do not match the strict definition", missing?.wire ?? extra[0]);
    if (signal?.aborted) throw gatewayError("cancelled", endpoint, "invocation was cancelled");

    let receiverContext: Context = ctx;
    if (contextInvocation) {
      const typert = ctx.get("typert") as { contexts?: { getHost?: (key: string) => { wire?: string; wireTypeSymbol?: string; resolve: (value: unknown) => Context | undefined | Promise<Context | undefined> } | undefined } } | undefined;
      const provider = typert?.contexts?.getHost?.(contextInvocation.context);
      if (!provider) throw gatewayError("context-unavailable", endpoint, "context provider is unavailable", contextInvocation.wire);
      if (provider.wire !== contextInvocation.wire
        || (contextInvocation.codec?.mode === "strict" && provider.wireTypeSymbol !== contextInvocation.codec.typeSymbol)) {
        throw gatewayError("provider-mismatch", endpoint, "context provider does not match its strict definition", contextInvocation.wire);
      }
      const identity = decodeGatewayValue(contextInvocation.codec, args[contextInvocation.wire], endpoint, contextInvocation.wire);
      try {
        const resolved = await provider.resolve(identity) as Context | undefined;
        if (!resolved) throw gatewayError("context-not-found", endpoint, "context identity was not found", contextInvocation.wire);
        receiverContext = resolved;
      } catch (error) {
        if (error instanceof Error && "code" in error && (error as { code?: unknown }).code === "context-not-found") throw error;
        throw gatewayError("context-failed", endpoint, "context provider failed", contextInvocation.wire, error);
      }
    }
    const service = receiverContext.get(descriptor.service) as Record<string, unknown> | undefined;
    if (!service) throw gatewayError("service-unavailable", endpoint, "service is unavailable");
    validateGatewayServiceBinding(service, descriptor, endpoint);
    const method = service[descriptor.implementation ?? descriptor.method];
    if (typeof method !== "function") throw gatewayError("method-unavailable", endpoint, "service method is unavailable");
    const typert = ctx.get("typert") as { lookups?: { get?: (key: string) => { wire?: string; wireTypeSymbol?: string; resolve: (value: unknown) => unknown | Promise<unknown> } | undefined } } | undefined;
    const parameters: unknown[] = [];
    for (const parameter of descriptor.parameters) {
      const decoded = decodeGatewayValue(parameter.codec, args[parameter.wire], endpoint, parameter.wire);
      if (parameter.source === "lookup") {
        const provider = parameter.lookup ? typert?.lookups?.get?.(parameter.lookup) : undefined;
        if (!provider) throw gatewayError("lookup-unavailable", endpoint, "lookup provider is unavailable", parameter.wire);
        if ((provider.wire !== undefined && provider.wire !== parameter.wire)
          || (parameter.codec?.mode === "strict" && provider.wireTypeSymbol !== parameter.codec.typeSymbol)) {
          throw gatewayError("provider-mismatch", endpoint, "lookup provider does not match its strict definition", parameter.wire);
        }
        let resolved: unknown;
        try {
          resolved = await provider.resolve(decoded);
        } catch (cause) {
          throw gatewayError("lookup-failed", endpoint, "lookup provider failed", parameter.wire, cause);
        }
        if (resolved === undefined) throw gatewayError("lookup-not-found", endpoint, "lookup value was not found", parameter.wire);
        parameters.push(resolved);
      } else {
        parameters.push(decoded);
      }
    }
    if (descriptor.cancellation) parameters.push(signal ?? new AbortController().signal);
    let result: unknown;
    try {
      result = await Reflect.apply(method, service, parameters);
    } catch (error) {
      if (signal?.aborted) throw gatewayError("cancelled", endpoint, "invocation was cancelled", undefined, error);
      throw error;
    }
    return decodeGatewayValue(descriptor.result, result, endpoint, "result", "result-invalid");
  }
}

type GatewayInvocationDescriptor = {
  id?: string;
  namespace: string;
  method: string;
  service: string;
  implementation?: string;
  invocation?: { kind: "direct" } | { kind: "context"; context: string; wire: string; codec?: RemoteCodec };
  scope?: { context: string; wire: string };
  parameters: Array<{ wire: string; source?: "json" | "lookup"; lookup?: string; acceptsUndefined?: boolean; codec?: RemoteCodec }>;
  cancellation?: boolean | { parameter: "signal" };
  result?: RemoteCodec;
};

function isGatewayInvocationDescriptor(value: unknown): value is GatewayInvocationDescriptor {
  return Boolean(value && typeof value === "object" && typeof (value as { service?: unknown }).service === "string"
    && typeof (value as { namespace?: unknown }).namespace === "string"
    && typeof (value as { method?: unknown }).method === "string"
    && Array.isArray((value as { parameters?: unknown }).parameters)
    && (!((value as { invocation?: unknown }).invocation) || (value as { invocation?: { kind?: unknown } }).invocation?.kind === "direct" || (value as { invocation?: { kind?: unknown } }).invocation?.kind === "context"));
}

function gatewayError(code: string, endpoint: string, message: string, field?: string, cause?: unknown): Error {
  return Object.assign(new Error(`dsh-api-gateway: ${endpoint}: ${message}`), { code, endpoint, ...(field ? { field } : {}), ...(cause ? { cause } : {}) });
}

function validateGatewayServiceBinding(
  service: Record<string, unknown>,
  descriptor: GatewayInvocationDescriptor,
  endpoint: string,
): void {
  const original = (service as Record<PropertyKey, unknown>)[symbols.original] as Record<string, unknown> | undefined;
  const target = original && typeof original === "object" ? original : service;
  const binding = target.typertRemote;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw gatewayError("binding-invalid", endpoint, "service has no typertRemote binding", "service");
  }
  const value = binding as { service?: unknown; serviceKey?: unknown; namespace?: unknown };
  if (value.service !== target
    || value.serviceKey !== descriptor.service
    || value.namespace !== descriptor.namespace) {
    throw gatewayError("binding-invalid", endpoint, "service typertRemote binding does not match its strict definition", "service");
  }
}

function decodeGatewayValue(codec: RemoteCodec | undefined, value: unknown, endpoint: string, field: string, code: "input-invalid" | "result-invalid" = "input-invalid"): unknown {
  try {
    const decoded = parseRemoteCodec(codec, value, `${endpoint}.${field}`);
    if (decoded !== undefined) assertGatewayJsonValue(decoded, new Set());
    return decoded;
  } catch (cause) {
    throw gatewayError(code, endpoint, "value does not match its strict codec or JSON boundary", field, cause);
  }
}

function assertGatewayJsonValue(value: unknown, ancestors: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new TypeError("non-finite number is not JSON-safe");
  }
  if (!value || (typeof value !== "object" && typeof value !== "function")) throw new TypeError(`${typeof value} is not JSON-safe`);
  if (ancestors.has(value)) throw new TypeError("cyclic value is not JSON-safe");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0 || Object.keys(value).length !== value.length) throw new TypeError("sparse or decorated array is not JSON-safe");
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError("sparse array is not JSON-safe");
        assertGatewayJsonValue(value[index], ancestors);
      }
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("non-plain object is not JSON-safe");
    if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("symbol property is not JSON-safe");
    for (const key of Reflect.ownKeys(value)) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || !property.enumerable || !("value" in property)) throw new TypeError("non-data property is not JSON-safe");
      assertGatewayJsonValue(property.value, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

export class DeepSeekLlmService extends OpenBuddyService {
  static override provide = "llm";
  private readonly context: RuntimeContext;
  private readonly discovery = new Map<string, (request: unknown) => Promise<readonly unknown[]>>();

  constructor(ctx: Context) {
    super(ctx, "llm");
    this.context = ctx as RuntimeContext;
  }

  private runtime(): ModelRuntime {
    const runtime = this.context.get("modelRuntime") as ModelRuntime | undefined;
    if (!runtime) throw new Error("dsh-llm: Pi model runtime is not ready");
    return runtime;
  }

  listProviders(): Array<{ id: string; name: string }> {
    return this.runtime().getProviders().map((provider) => ({ id: provider.id, name: provider.name }));
  }

  listModels(provider?: string): DeepSeekModel[] {
    return this.runtime().getModels(provider).map(modelInfo);
  }

  resolveModelInfo(provider: string, model: string): DeepSeekModel {
    const found = this.runtime().getModel(provider, model);
    if (!found) throw new Error(`dsh-llm: model not found: ${modelId(provider, model)}`);
    return modelInfo(found);
  }

  registerModelDiscovery(namespace: string, discover: (request: unknown) => Promise<readonly unknown[]>): () => void {
    this.discovery.set(namespace, discover);
    return () => this.discovery.delete(namespace);
  }

  async discoverModels(namespace: string, request: unknown): Promise<readonly unknown[]> {
    const discover = this.discovery.get(namespace);
    if (!discover) throw new Error(`dsh-llm: no model discovery registered for ${namespace}`);
    return discover(request);
  }

  stream(options: {
    provider: string;
    model: string;
    messages: DeepSeekMessage[];
    system?: string;
    tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    sessionId?: string;
  }): AsyncIterable<Record<string, unknown>> {
    const model = this.runtime().getModel(options.provider, options.model);
    if (!model) throw new Error(`dsh-llm: model not found: ${modelId(options.provider, options.model)}`);
    const source = streamSimple(model, {
      systemPrompt: options.system,
      messages: toPiMessages(options.messages),
      tools: options.tools?.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) as any,
    }, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      signal: options.signal,
      sessionId: options.sessionId,
    });
    return this.toDeepSeekStream(source);
  }

  async complete(options: Parameters<DeepSeekLlmService["stream"]>[0]): Promise<Record<string, unknown>> {
    let text = "";
    let final: Record<string, unknown> = {};
    for await (const chunk of this.stream(options)) {
      final = chunk;
      if (chunk.type === "text-delta") text += String(chunk.text ?? "");
    }
    return { ...final, text, content: text };
  }

  private async *toDeepSeekStream(source: AsyncIterable<any>): AsyncIterable<Record<string, unknown>> {
    let index = 0;
    for await (const event of source) {
      if (event.type === "text_delta") {
        yield { type: "text-delta", index, text: event.delta };
      } else if (event.type === "thinking_delta") {
        yield { type: "reasoning-delta", index, text: event.delta };
      } else if (event.type === "done") {
        yield { type: "finish", reason: { kind: event.message?.stopReason === "aborted" ? "aborted" : event.message?.stopReason === "error" ? "error" : "stop" } };
      } else if (event.type === "error") {
        yield { type: "finish", reason: { kind: event.error?.stopReason === "aborted" ? "aborted" : "error", failure: { code: "PI_PROVIDER_ERROR", message: String(event.error?.errorMessage ?? "Pi provider error") } } };
      }
      index += 1;
    }
  }
}

type SessionFacade = {
  id: string;
  sessionId: string;
  cwd?: string;
  messages: unknown[];
  prompt: (text: string) => Promise<void>;
  steer: (text: string) => Promise<void>;
  followUp: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  subscribe: (listener: (event: unknown) => void) => () => void;
};

type DeepSeekInboxTarget = "next-turn" | "next-step";

type DeepSeekInboxMessage = {
  id: string;
  role: "user";
  content: [{ type: "text"; text: string }];
  timestamp: number;
  [key: string]: unknown;
};

type DeepSeekAgentEventEntry = {
  type: "custom";
  customType?: "deepseek/agent-event";
  data?: {
    version?: number;
    type?: string;
    data?: unknown;
  };
};

type DeepSeekAgentRequestEntry = {
  type: "custom";
  customType?: "deepseek/agent-request";
  data?: {
    version?: number;
    provider?: unknown;
    model?: unknown;
    maxTokens?: unknown;
    maxRetries?: unknown;
  };
};

type DeepSeekAgentSetupEntry = {
  type: "custom";
  customType?: "deepseek/agent-setup";
  data?: {
    version?: number;
    operation?: "begin" | "commit" | "rollback";
    revision?: unknown;
    lifecycleSource?: "startup" | "resume";
    reason?: unknown;
    recoveredRevision?: unknown;
  };
};

type DeepSeekAgentRequestErrorEntry = {
  type: "custom";
  customType?: "deepseek/agent-request-error";
  data?: {
    version?: number;
    turn?: unknown;
    step?: unknown;
    attempt?: unknown;
    failure?: unknown;
    action?: unknown;
  };
};

type DeepSeekInboxEntry = {
  type: "deepseek/agent-inbox";
  data?: {
    version?: number;
    operation?: "append" | "prepend" | "replace" | "remove" | "clear" | "claim";
    target?: DeepSeekInboxTarget;
    start?: number;
    message?: DeepSeekInboxMessage;
    messageId?: string;
    replacement?: DeepSeekInboxMessage;
    claimedIds?: string[];
  };
};

type DeepSeekAgentOptions = {
  provider?: string;
  model?: string;
  maxTokens?: number;
  maxRetries?: number;
};

type DeepSeekAgentSetup = (context: Context) => void | (() => void) | Promise<void | (() => void)>;

type DeepSeekAgentCreateOptions = {
  sessionId: string;
  meta?: {
    cwd?: string;
    parentSession?: string;
    seedLength?: number;
    origin?: "subagent";
    delegationDepth?: number;
    agentPreset?: string;
  };
  seed?: readonly unknown[];
  agentOptions?: DeepSeekAgentOptions;
  signal?: AbortSignal;
  setup?: DeepSeekAgentSetup;
};

type DeepSeekAgentResumeOptions = {
  resumeSessionId: string;
  agentOptions?: DeepSeekAgentOptions;
  signal?: AbortSignal;
  setup?: DeepSeekAgentSetup;
};

type DeepSeekAgentView = SessionFacade & {
  id: string;
  options: DeepSeekAgentOptions;
  readonly modelId?: string;
  session: SessionFacade;
  inbox: {
    readonly nextTurn: readonly DeepSeekInboxMessage[];
    readonly nextStep: readonly DeepSeekInboxMessage[];
    readonly hasPending: boolean;
    clear: () => void;
    append: (target: DeepSeekInboxTarget, message: DeepSeekInboxMessage) => void;
    prepend: (target: DeepSeekInboxTarget, message: DeepSeekInboxMessage) => void;
    replace: (messageId: string, message: DeepSeekInboxMessage) => boolean;
    remove: (messageId: string) => boolean;
  };
  readonly status: "idle" | "running";
  readonly ctx: Context;
  cancel: (cause?: unknown) => void;
  whenIdle: () => Promise<void>;
  runMaintenance: <T>(task: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  send: (message: unknown, target: "next-turn" | "next-step", wakeup: boolean) => void;
  followup: (message: unknown) => void;
  inject: (message: unknown) => void;
};

type DeepSeekAgentHandle = {
  agent: DeepSeekAgentView;
  dispose: () => Promise<void>;
};

type DeepSeekAgentFactory = {
  createAgent: (ownerCtx: Context, options: DeepSeekAgentCreateOptions) => Promise<DeepSeekAgentHandle>;
  resume: (ownerCtx: Context, options: DeepSeekAgentResumeOptions) => Promise<DeepSeekAgentHandle>;
  dispose: () => Promise<void>;
};

function textFromAgentMessage(message: unknown): string {
  if (typeof message === "string") return message;
  if (!message || typeof message !== "object") return "";
  const record = message as Record<string, unknown>;
  const content = record.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const value = part as Record<string, unknown>;
    return typeof value.text === "string" ? value.text : "";
  }).join("");
}

function textFromAgentMessages(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  const text = messages.map(textFromAgentMessage).filter(Boolean).join("\n\n");
  return text || undefined;
}

function jsonAgentValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(jsonAgentValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonAgentValue(item)]));
  }
  return String(value);
}

function createInboxMessage(message: unknown): DeepSeekInboxMessage {
  const text = textFromAgentMessage(message);
  if (!text) throw new Error("dsh-agent: inbox messages must contain text content");
  const record = message && typeof message === "object" ? message as Record<string, unknown> : {};
  return {
    ...record,
    id: typeof record.id === "string" && record.id ? record.id : randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    timestamp: typeof record.timestamp === "number" ? record.timestamp : Date.now(),
  };
}

function createAgentInbox(source: DeepSeekPiAgentRuntime): {
  nextTurn: DeepSeekInboxMessage[];
  nextStep: DeepSeekInboxMessage[];
  hasPending: boolean;
  clear: () => void;
  append: (target: DeepSeekInboxTarget, message: DeepSeekInboxMessage) => void;
  prepend: (target: DeepSeekInboxTarget, message: DeepSeekInboxMessage) => void;
  replace: (messageId: string, message: DeepSeekInboxMessage) => boolean;
  remove: (messageId: string) => boolean;
  claim: (target: DeepSeekInboxTarget) => DeepSeekInboxMessage[];
} {
  const state = { nextTurn: [] as DeepSeekInboxMessage[], nextStep: [] as DeepSeekInboxMessage[] };
  const entries = source.getEntries?.() ?? [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || (entry as { type?: unknown }).type !== "custom" || (entry as { customType?: unknown }).customType !== "deepseek/agent-inbox") continue;
    const data = (entry as DeepSeekInboxEntry).data;
    if (!data?.operation || !data.target && data.operation !== "clear") continue;
    const target = data.target === "next-step" ? state.nextStep : state.nextTurn;
    const message = data.message;
    if (data.operation === "append" && message) target.push(message);
    else if (data.operation === "prepend" && message) target.unshift(message);
    else if (data.operation === "replace" && data.messageId && data.replacement) {
      const index = [...state.nextTurn, ...state.nextStep].findIndex((item) => item.id === data.messageId);
      if (index >= 0) {
        const list = index < state.nextTurn.length ? state.nextTurn : state.nextStep;
        list[index < state.nextTurn.length ? index : index - state.nextTurn.length] = data.replacement;
      }
    } else if (data.operation === "remove" && data.messageId) {
      for (const list of [state.nextStep, state.nextTurn]) {
        const index = list.findIndex((item) => item.id === data.messageId);
        if (index >= 0) list.splice(index, 1);
      }
    } else if (data.operation === "clear") {
      state.nextStep.splice(0);
      state.nextTurn.splice(0);
    } else if (data.operation === "claim") {
      for (const messageId of data.claimedIds ?? []) {
        for (const list of [state.nextStep, state.nextTurn]) {
          const index = list.findIndex((item) => item.id === messageId);
          if (index >= 0) list.splice(index, 1);
        }
      }
    }
  }
  const persist = (data: Record<string, unknown>): void => {
    source.appendCustomEntry?.("deepseek/agent-inbox", { version: 1, ...data });
  };
  const listFor = (target: DeepSeekInboxTarget): DeepSeekInboxMessage[] => target === "next-step" ? state.nextStep : state.nextTurn;
  const append = (target: DeepSeekInboxTarget, message: DeepSeekInboxMessage): void => {
    const list = listFor(target);
    if ([...state.nextTurn, ...state.nextStep].some((item) => item.id === message.id)) throw new Error(`dsh-agent: inbox message "${message.id}" already exists`);
    persist({ operation: "append", target, message });
    list.push(message);
  };
  const prepend = (target: DeepSeekInboxTarget, message: DeepSeekInboxMessage): void => {
    const list = listFor(target);
    if ([...state.nextTurn, ...state.nextStep].some((item) => item.id === message.id)) throw new Error(`dsh-agent: inbox message "${message.id}" already exists`);
    persist({ operation: "prepend", target, message });
    list.unshift(message);
  };
  const remove = (messageId: string): boolean => {
    for (const [target, list] of [["next-step", state.nextStep], ["next-turn", state.nextTurn]] as const) {
      const index = list.findIndex((item) => item.id === messageId);
      if (index >= 0) {
        persist({ operation: "remove", target, messageId });
        list.splice(index, 1);
        return true;
      }
    }
    return false;
  };
  const replace = (messageId: string, message: DeepSeekInboxMessage): boolean => {
    if ([...state.nextTurn, ...state.nextStep].some((item) => item.id === message.id && item.id !== messageId)) throw new Error(`dsh-agent: inbox message "${message.id}" already exists`);
    for (const [target, list] of [["next-step", state.nextStep], ["next-turn", state.nextTurn]] as const) {
      const index = list.findIndex((item) => item.id === messageId);
      if (index >= 0) {
        persist({ operation: "replace", target, messageId, replacement: message });
        list[index] = message;
        return true;
      }
    }
    return false;
  };
  const clear = (): void => {
    if (!state.nextTurn.length && !state.nextStep.length) return;
    persist({ operation: "clear" });
    state.nextTurn.splice(0);
    state.nextStep.splice(0);
  };
  const claim = (target: DeepSeekInboxTarget): DeepSeekInboxMessage[] => {
    const claimed = [...state.nextStep, ...(target === "next-turn" ? state.nextTurn.slice(0, 1) : [])];
    if (claimed.length) {
      persist({ operation: "claim", target, claimedIds: claimed.map((message) => message.id) });
      state.nextStep.splice(0);
      if (target === "next-turn") state.nextTurn.splice(0, 1);
    }
    return claimed;
  };
  return { nextTurn: state.nextTurn, nextStep: state.nextStep, get hasPending() { return state.nextTurn.length > 0 || state.nextStep.length > 0; }, clear, append, prepend, replace, remove, claim };
}

function restoreAgentCoordinates(source: DeepSeekPiAgentRuntime): { turn: number; step: number } {
  let turn = 0;
  let step = 0;
  for (const entry of source.getEntries?.() ?? []) {
    if (!entry || typeof entry !== "object" || (entry as DeepSeekAgentEventEntry).type !== "custom") continue;
    const custom = entry as { customType?: unknown; data?: DeepSeekAgentEventEntry["data"] };
    if (custom.customType !== "deepseek/agent-event") continue;
    const data = custom.data;
    const payload = data?.data;
    if (!payload || typeof payload !== "object") continue;
    const record = payload as { turn?: unknown; step?: unknown };
    if (typeof record.turn === "number") turn = Math.max(turn, record.turn);
    if (typeof record.step === "number") step = Math.max(step, record.step);
  }
  return { turn, step };
}

function restoreAgentRequest(source: DeepSeekPiAgentRuntime): DeepSeekAgentOptions | undefined {
  let restored: DeepSeekAgentOptions | undefined;
  for (const entry of source.getEntries?.() ?? []) {
    if (!entry || typeof entry !== "object" || (entry as DeepSeekAgentRequestEntry).type !== "custom") continue;
    const custom = entry as DeepSeekAgentRequestEntry;
    if (custom.customType !== "deepseek/agent-request" || !custom.data || typeof custom.data !== "object") continue;
    const provider = typeof custom.data.provider === "string" && custom.data.provider.trim() ? custom.data.provider : undefined;
    const model = typeof custom.data.model === "string" && custom.data.model.trim() ? custom.data.model : undefined;
    const maxTokens = typeof custom.data.maxTokens === "number" && Number.isSafeInteger(custom.data.maxTokens) && custom.data.maxTokens > 0 ? custom.data.maxTokens : undefined;
    const maxRetries = typeof custom.data.maxRetries === "number" && Number.isSafeInteger(custom.data.maxRetries) && custom.data.maxRetries >= 0 ? Math.min(custom.data.maxRetries, 10) : undefined;
    if (provider && model) restored = { provider, model, ...(maxTokens === undefined ? {} : { maxTokens }), ...(maxRetries === undefined ? {} : { maxRetries }) };
  }
  return restored;
}

type AgentSetupTransaction = {
  operation: "begin" | "commit" | "rollback";
  revision: number;
  lifecycleSource?: "startup" | "resume";
};

function restoreAgentSetupTransaction(source: DeepSeekPiAgentRuntime): AgentSetupTransaction | undefined {
  let latest: AgentSetupTransaction | undefined;
  for (const entry of source.getEntries?.() ?? []) {
    if (!entry || typeof entry !== "object" || (entry as DeepSeekAgentSetupEntry).type !== "custom") continue;
    const custom = entry as DeepSeekAgentSetupEntry;
    if (custom.customType !== "deepseek/agent-setup" || !custom.data || typeof custom.data !== "object") continue;
    const revision = custom.data.revision;
    if (!Number.isSafeInteger(revision) || (revision as number) < 1) continue;
    const operation = custom.data.operation;
    if (operation !== "begin" && operation !== "commit" && operation !== "rollback") continue;
    latest = {
      operation,
      revision: revision as number,
      ...(custom.data.lifecycleSource === "startup" || custom.data.lifecycleSource === "resume" ? { lifecycleSource: custom.data.lifecycleSource } : {}),
    };
  }
  return latest;
}

function appendAgentSetupTransaction(
  source: DeepSeekPiAgentRuntime,
  operation: AgentSetupTransaction["operation"],
  lifecycleSource: "startup" | "resume",
  revision: number,
  extra: Record<string, unknown> = {},
): void {
  const data = jsonAgentValue({
    version: 1,
    operation,
    lifecycleSource,
    revision,
    ...extra,
  });
  source.appendCustomEntry?.("deepseek/agent-setup", data);
  const revisionFromLog = lifecycleRevisionFromEntries(source.getEntries?.() ?? []);
  source.appendCustomEntry?.(OPENBUDDY_LIFECYCLE_CUSTOM_TYPE, lifecycleEntry(lifecycleEvent({
    operation: "agent-setup",
    phase: operation,
    revision: revisionFromLog + 1,
    agentId: source.sessionId,
    sessionId: source.sessionId,
    ...(typeof extra.reason === "string" ? { reason: extra.reason } : {}),
    ...(typeof extra.recoveredRevision === "number" ? { recoveredRevision: extra.recoveredRevision } : {}),
  })));
}

function appendAgentLeaseLifecycle(
  source: DeepSeekPiAgentRuntime,
  phase: "begin" | "renew" | "release",
  token: string,
): void {
  const revision = lifecycleRevisionFromEntries(source.getEntries?.() ?? []) + 1;
  source.appendCustomEntry?.(OPENBUDDY_LIFECYCLE_CUSTOM_TYPE, lifecycleEntry(lifecycleEvent({
    operation: "agent-lease",
    phase,
    revision,
    agentId: source.sessionId,
    sessionId: source.sessionId,
    leaseTokenHash: hashLifecycleSecret(token),
  })));
}

const DEFAULT_AGENT_MAX_RETRIES = 2;

function normalizedAgentOptions(options: DeepSeekAgentOptions): DeepSeekAgentOptions {
  const maxRetries = options.maxRetries === undefined
    ? DEFAULT_AGENT_MAX_RETRIES
    : Number.isSafeInteger(options.maxRetries) && options.maxRetries >= 0
      ? Math.min(options.maxRetries, 10)
      : (() => { throw new Error("dsh-agent-loop: maxRetries must be a non-negative safe integer"); })();
  return { ...options, maxRetries };
}

type AgentRequestFailure = {
  code: string;
  message: string;
  kind: "provider" | "agent";
  retryable: boolean;
};

type AgentWaterfallNext<T> = () => Promise<T>;
type AgentRequestErrorAction = { kind: "retry" } | undefined;

function persistAgentRequestError(source: DeepSeekPiAgentRuntime, data: Record<string, unknown>): void {
  source.appendCustomEntry?.("deepseek/agent-request-error", jsonAgentValue({ version: 1, ...data }));
}

const agentScopeKey = Symbol("openbuddy.deepseek.agent.scope");
type AgentScopeToken = object;
const agentScopeParents = new WeakMap<AgentScopeToken, AgentScopeToken | undefined>();

type AgentScopeCarrier = {
  [symbols.filter]?: (listenerContext: Context) => boolean;
};

function createAgentScope(ownerContext: Context): { context: Context; carrier: AgentScopeCarrier } {
  const token: AgentScopeToken = {};
  const parent = (ownerContext as Context & { [agentScopeKey]?: AgentScopeToken })[agentScopeKey];
  agentScopeParents.set(token, parent);
  const context = ownerContext.extend({ [agentScopeKey]: token });
  const carrier: AgentScopeCarrier = {
    [symbols.filter](listenerContext: Context): boolean {
      const listenerToken = (listenerContext as Context & { [agentScopeKey]?: AgentScopeToken })[agentScopeKey];
      if (!listenerToken) return true;
      for (let current: AgentScopeToken | undefined = token; current; current = agentScopeParents.get(current)) {
        if (current === listenerToken) return true;
      }
      return false;
    },
  };
  return { context, carrier };
}

function toolExecutionPayload(agent: DeepSeekAgentView, toolCallId: string, toolName: string, args: unknown, signal: AbortSignal | undefined): DeepSeekToolExecution {
  return { agent, toolCallId, toolName, args, signal };
}

function freezeToolResultSnapshot(value: unknown): unknown {
  // P0/Freeze: drop the structuredClone. The original `result` is the tool's
  // ephemeral return value — only this listener sees it, and `Object.freeze`
  // is enough to prevent mutation. The clone doubled peak memory and CPU
  // for large tool results (file_read, grep) without observable benefit.
  // Fallback to no-op if the value isn't freezable (e.g. functions, symbols).
  const seen = new WeakSet<object>();
  const freeze = (candidate: unknown): unknown => {
    if (!candidate || typeof candidate !== "object") return candidate;
    if (seen.has(candidate)) return candidate;
    seen.add(candidate);
    try {
      Object.freeze(candidate);
    } catch {
      // Some exotic proxies / class instances throw on freeze; skip them.
      return candidate;
    }
    for (const nested of Object.values(candidate as Record<string, unknown>)) freeze(nested);
    return candidate;
  };
  return freeze(value);
}

async function runAgentWaterfall<T>(context: Context, carrier: AgentScopeCarrier, name: string, payload: Record<string, unknown>, fallback: AgentWaterfallNext<T>): Promise<T> {
  const serial = (context as unknown as { serial?: (thisArg: AgentScopeCarrier, event: string, payload: unknown, next: AgentWaterfallNext<T>) => Promise<T | undefined> }).serial;
  if (!serial) return fallback();
  const result = await serial(carrier, name, payload, fallback);
  return result === undefined ? fallback() : result;
}

function agentAssistantFailure(messages: readonly unknown[]): AgentRequestFailure | undefined {
  const last = messages.at(-1);
  if (!last || typeof last !== "object") return undefined;
  const record = last as Record<string, unknown>;
  if (record.role !== "assistant" || record.stopReason !== "error") return undefined;
  return { code: typeof record.errorMessage === "string" ? "PI_PROVIDER_ERROR" : "PI_AGENT_ERROR", message: typeof record.errorMessage === "string" ? record.errorMessage : "Pi agent request failed", kind: "provider", retryable: true };
}

function agentThrownFailure(error: unknown): AgentRequestFailure {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "PI_PROVIDER_ERROR";
  return { code, message, kind: "provider", retryable: !/invalid|unsupported|permission|denied/i.test(message) };
}


function createPiAgentFactory(context: Context): DeepSeekAgentFactory {
  const host = context.get("agentHost") as AgentHostRuntime | undefined;
  const createHostAgent = host?.createAgent;
  const resumeHostAgent = host?.resumeAgent;
  const registry = context.get("agents") as DeepSeekAgentService | undefined;
  if (!registry) throw new Error("dsh-agent-loop: agent registry is unavailable");
  const sessions = context.get("sessions") as DeepSeekSessionService | undefined;
  if (!sessions) throw new Error("dsh-agent-loop: session registry is unavailable");
  const live = new Map<string, DeepSeekAgentHandle>();
  const pendingIds = new Set<string>();
  const pending = new Set<Promise<unknown>>();
  const factoryAbort = new AbortController();
  let disposed = false;

  const lifecycleSignal = (caller?: AbortSignal): AbortSignal => {
    if (!caller) return factoryAbort.signal;
    return AbortSignal.any([caller, factoryAbort.signal]);
  };
  const raceLifecycle = async <T>(operation: Promise<T>, signal: AbortSignal, releaseLate?: (value: T) => void): Promise<T> => {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason));
    let abortHandler: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      abortHandler = () => reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
      signal.addEventListener("abort", abortHandler, { once: true });
    });
    try {
      return await Promise.race([operation, aborted]);
    } catch (error) {
      if (signal.aborted && releaseLate) void operation.then(releaseLate, () => undefined);
      throw error;
    } finally {
      if (abortHandler) signal.removeEventListener("abort", abortHandler);
    }
  };

  const register = async (ownerCtx: Context, id: string, source: DeepSeekPiAgentRuntime, options: DeepSeekAgentOptions, setup: DeepSeekAgentSetup | undefined, signal: AbortSignal | undefined, lifecycleSource: "startup" | "resume"): Promise<DeepSeekAgentHandle> => {
    const scoped = createAgentScope(ownerCtx);
    const agentContext = scoped.context.extend({ agent: undefined });
    const agentCarrier = scoped.carrier;
    let requestOptions: DeepSeekAgentOptions = normalizedAgentOptions(options);
    const restoredRequest = lifecycleSource === "resume" ? restoreAgentRequest(source) : undefined;
    if (restoredRequest) requestOptions = { ...requestOptions, ...restoredRequest };
    const restoredSetup = lifecycleSource === "resume" ? restoreAgentSetupTransaction(source) : undefined;
    let setupRevision = (restoredSetup?.revision ?? 0) + 1;
    let setupTransactionStarted = false;
    if (restoredSetup?.operation === "begin") {
      appendAgentSetupTransaction(source, "rollback", lifecycleSource, setupRevision, {
        reason: "recovered-incomplete-setup",
        recoveredRevision: restoredSetup.revision,
      });
      setupRevision += 1;
    }
    let setupDispose: (() => void | Promise<void>) | undefined;
    let detach: (() => void) | undefined;
    let detachSession: (() => void) | undefined;
    let unsubscribeSource: (() => void) | undefined;
    let disposePromise: Promise<void> | undefined;
    let releaseOwner: (() => void) | undefined;
    const ownerAbort = new AbortController();
    const agentSignal = signal ? AbortSignal.any([signal, ownerAbort.signal]) : ownerAbort.signal;
    const inbox = createAgentInbox(source);
    const restoredCoordinates = restoreAgentCoordinates(source);
    let turn = restoredCoordinates.turn;
    let step = restoredCoordinates.step;
    let status: "idle" | "running" = "idle";
    let promptQueue = Promise.resolve();
    let runPrompt!: (text: string) => Promise<void>;
    let wakePrompt!: (target: DeepSeekInboxTarget) => Promise<void>;
    let activeRequestController: AbortController | undefined;
    let suppressNextAgentStart = 0;
    let suppressNextTurnStart = 0;
    const emitAgentEvent = (type: string, data?: unknown, notify = true): void => {
      const payload = { agent, sessionId: id, ...(data && typeof data === "object" ? data as Record<string, unknown> : {}) };
      if (notify) context.emit(agentCarrier, type, payload);
      const persisted = { agentId: id, sessionId: id, ...(data && typeof data === "object" ? data as Record<string, unknown> : {}) };
      source.appendCustomEntry?.("deepseek/agent-event", { version: 1, type, data: jsonAgentValue(persisted) });
    };
    const abortAgent = async (cause?: unknown): Promise<void> => {
      activeRequestController?.abort(cause);
      await source.abort();
    };
    const runQueuedPrompt = (target: DeepSeekInboxTarget): Promise<void> => {
      const operation = async (): Promise<void> => {
        const operationController = new AbortController();
        activeRequestController = operationController;
        try {
        const claimedMessages = inbox.claim(target);
        if (claimedMessages.length === 0) return;
        const requestTurn = turn + 1;
        const requestStep = 1;
        const requestSignal = AbortSignal.any([agentSignal, operationController.signal]);
        requestSignal.throwIfAborted();
        turn = requestTurn;
        step = requestStep;
        status = "running";
        emitAgentEvent("agent/status", { status });
        emitAgentEvent("agent/start", { source: lifecycleSource });
        emitAgentEvent("turn/start", { turn });
        for (const message of claimedMessages) emitAgentEvent("agent/inbox/claimed", { message, turn });
        const proposedMessages = claimedMessages;
        const preStep = await runAgentWaterfall(context, agentCarrier, "agent/pre-step", {
          agent,
          messages: proposedMessages,
          turn: requestTurn,
          step: requestStep,
          signal: requestSignal,
        }, async () => ({ kind: "enter", messages: proposedMessages }));
        requestSignal.throwIfAborted();
        const acceptedMessages = preStep.kind === "enter" ? preStep.messages : proposedMessages;
        emitAgentEvent("agent/pre-step", { messages: acceptedMessages, turn: requestTurn, step: requestStep, phase: "preflight" }, false);
        if (preStep.kind === "reject") {
          emitAgentEvent("turn/end", { turn: requestTurn, reason: { kind: "blocked" } });
          status = "idle";
          emitAgentEvent("agent/status", { status });
          emitAgentEvent("agent/end", { turn: requestTurn, step: requestStep });
          return;
        }
        const acceptedText = textFromAgentMessages(acceptedMessages);
        if (!acceptedText) throw new Error("dsh-agent-loop: agent/pre-step produced no text-compatible messages");
        emitAgentEvent("step/start", { turn: requestTurn, step: requestStep });
        const requested = await runAgentWaterfall(context, agentCarrier, "agent/request", {
          agent,
          turn: requestTurn,
          step: requestStep,
          signal: requestSignal,
          provider: requestOptions.provider,
          model: requestOptions.model,
        }, async () => ({ provider: requestOptions.provider, model: requestOptions.model }));
        requestSignal.throwIfAborted();
        const requestedRecord = requested && typeof requested === "object" ? requested as Record<string, unknown> : {};
        const provider = typeof requestedRecord.provider === "string" && requestedRecord.provider.trim() ? requestedRecord.provider : requestOptions.provider;
        const model = typeof requestedRecord.model === "string" && requestedRecord.model.trim() ? requestedRecord.model : requestOptions.model;
        const maxTokens = typeof requestedRecord.maxTokens === "number" && Number.isSafeInteger(requestedRecord.maxTokens) && requestedRecord.maxTokens > 0 ? requestedRecord.maxTokens : requestOptions.maxTokens;
        const maxRetries = typeof requestedRecord.maxRetries === "number" && Number.isSafeInteger(requestedRecord.maxRetries) && requestedRecord.maxRetries >= 0 ? Math.min(requestedRecord.maxRetries, 10) : requestOptions.maxRetries;
        if (provider && model) {
          requestOptions = normalizedAgentOptions({ provider, model, ...(maxTokens === undefined ? {} : { maxTokens }), ...(maxRetries === undefined ? {} : { maxRetries }) });
          source.appendCustomEntry?.("deepseek/agent-request", jsonAgentValue({ version: 1, ...requestOptions }));
          if (source.setModel) await source.setModel(provider, model);
        }
        suppressNextAgentStart += 1;
        suppressNextTurnStart += 1;
        let attempts = 0;
        while (true) {
          attempts += 1;
          if (attempts > 1) {
            suppressNextAgentStart += 1;
            suppressNextTurnStart += 1;
          }
          try {
            await source.prompt(acceptedText);
          } catch (error) {
            if (requestSignal.aborted) throw error;
            const failure = agentThrownFailure(error);
            const action = await runAgentWaterfall<AgentRequestErrorAction>(context, agentCarrier, "agent/request-error", { agent, turn: requestTurn, step: requestStep, provider: requestOptions.provider, failure, signal: requestSignal }, async () => undefined);
            requestSignal.throwIfAborted();
            persistAgentRequestError(source, { turn: requestTurn, step: requestStep, attempt: attempts, failure, action: action?.kind ?? "stop" });
            if (action?.kind === "retry" && failure.retryable && attempts <= (requestOptions.maxRetries ?? DEFAULT_AGENT_MAX_RETRIES)) continue;
            throw error;
          }
          const failure = agentAssistantFailure(source.messages);
          if (!failure) return;
          if (requestSignal.aborted) throw requestSignal.reason instanceof Error ? requestSignal.reason : new Error(String(requestSignal.reason));
          const action = await runAgentWaterfall<AgentRequestErrorAction>(context, agentCarrier, "agent/request-error", { agent, turn: requestTurn, step: requestStep, provider: requestOptions.provider, failure, signal: requestSignal }, async () => undefined);
          requestSignal.throwIfAborted();
          persistAgentRequestError(source, { turn: requestTurn, step: requestStep, attempt: attempts, failure, action: action?.kind ?? "stop" });
          if (action?.kind === "retry" && failure.retryable && attempts <= (requestOptions.maxRetries ?? DEFAULT_AGENT_MAX_RETRIES)) continue;
          return;
        }
        } finally {
          activeRequestController = undefined;
        }
      };
      const queued = promptQueue.then(operation, operation);
      promptQueue = queued.catch(() => undefined);
      return queued;
    };
    wakePrompt = (target: DeepSeekInboxTarget): Promise<void> => runQueuedPrompt(target);
    runPrompt = (text: string): Promise<void> => {
      const message = createInboxMessage(text);
      inbox.append("next-turn", message);
      return wakePrompt("next-turn");
    };
    const routeQueuedMessage = (text: string, target: DeepSeekInboxTarget): Promise<void> => {
      const message = createInboxMessage(text);
      inbox.append(target, message);
      return wakePrompt(target);
    };
    const session: SessionFacade = {
      id,
      sessionId: id,
      cwd: source.cwd,
      messages: source.messages,
      prompt: (text) => runPrompt(text),
      steer: (text) => routeQueuedMessage(text, "next-step"),
      followUp: (text) => routeQueuedMessage(text, "next-turn"),
      abort: abortAgent,
      subscribe: source.subscribe,
    };
    const agent: DeepSeekAgentView = {
      id,
      get options() { return { ...requestOptions }; },
      session,
      get sessionId() { return id; },
      get cwd() { return source.cwd; },
      get modelId() { return source.modelId; },
      get messages() { return source.messages; },
      prompt: runPrompt,
      steer: (text) => {
        const message = createInboxMessage(text);
        inbox.append("next-step", message);
        return wakePrompt("next-step");
      },
      followUp: (text) => {
        const message = createInboxMessage(text);
        inbox.append("next-turn", message);
        return wakePrompt("next-turn");
      },
      abort: abortAgent,
      subscribe: source.subscribe,
      inbox,
      get status() { return status === "running" || source.isStreaming ? "running" : "idle"; },
      ctx: agentContext,
      cancel: (cause) => { void abortAgent(cause); },
      whenIdle: source.waitForIdle,
      runMaintenance: async <T>(task: (runSignal: AbortSignal) => Promise<T>) => {
        await source.waitForIdle();
        const controller = new AbortController();
        try { return await task(controller.signal); } finally { controller.abort(); }
      },
      send: (message, target, wakeup) => {
        const text = textFromAgentMessage(message);
        if (!text) return;
        const queued = createInboxMessage(message);
        inbox.append(target, queued);
        if (wakeup) void wakePrompt(target);
      },
      followup: (message) => {
        const text = textFromAgentMessage(message);
        if (!text) return;
        const queued = createInboxMessage(message);
        inbox.append("next-turn", queued);
        void wakePrompt("next-turn");
      },
      inject: (message) => { const text = textFromAgentMessage(message); if (text) void source.inject(text); },
    };
    source.setToolAgent?.(agent);
    source.setToolHooks?.({
      preExecute: async (execution) => {
        const result = await runAgentWaterfall<DeepSeekToolDecision>(context, agentCarrier, "tools/pre-execute", {
          ...execution,
          agent,
        }, async () => ({ kind: "allow" }));
        return result?.kind === "reject" ? result : { kind: "allow" };
      },
      execute: (execution, next) => runAgentWaterfall(context, agentCarrier, "tools/execute", { ...execution, agent }, next),
      postExecute: async (execution, result) => {
        const serial = (context as unknown as { serial?: (thisArg: AgentScopeCarrier, event: string, execution: unknown, result: unknown, next: () => Promise<unknown>) => Promise<unknown> }).serial;
        if (!serial) return result;
        const outcome = await serial(agentCarrier, "tools/post-execute", { ...execution, agent }, result, async () => result);
        return outcome === undefined ? result : outcome;
      },
      result: async (execution, result) => {
        const observedExecution = Object.freeze({ ...execution, agent });
        const observedResult = freezeToolResultSnapshot(result);
        await context.parallel(agentCarrier, "tools/result", observedExecution, observedResult).catch(() => undefined);
      },
    });
    (agentContext as Context & { agent?: DeepSeekAgentView }).agent = agent;
    let handle!: DeepSeekAgentHandle;
    handle = {
      agent,
      dispose: async () => {
        if (disposePromise) return disposePromise;
        disposePromise = (async () => {
          let failure: unknown;
          try {
            unsubscribeSource?.();
          } catch (error) {
            failure = error;
          }
          try {
            await source.dispose();
          } catch (error) {
            failure ??= error;
          }
          try {
            source.setToolHooks?.(undefined);
            source.setToolAgent?.(undefined);
          } catch (error) {
            failure ??= error;
          }
          try {
            detach?.();
          } catch (error) {
            failure ??= error;
          }
          try {
            detachSession?.();
          } catch (error) {
            failure ??= error;
          }
          try {
            await setupDispose?.();
          } catch (error) {
            failure ??= error;
          }
          live.delete(id);
          releaseOwner?.();
          if (failure) throw failure;
        })();
        await disposePromise;
      },
    };
    try {
      if (restoredRequest?.provider && restoredRequest.model && source.setModel) {
        await source.setModel(restoredRequest.provider, restoredRequest.model);
      }
      releaseOwner = ownerCtx.effect(() => async () => {
        ownerAbort.abort(new Error(`dsh-agent-loop: agent "${id}" owner disposed`));
        await handle.dispose();
      }, `dsh-agent-loop: ${id} owner cleanup`);
      agentSignal.throwIfAborted();
      detachSession = sessions.registerLiveSession(session);
      unsubscribeSource = source.subscribe((event) => {
        if (!event || typeof event !== "object" || typeof (event as { type?: unknown }).type !== "string") return;
        const sessionEvent = { ...(event as Record<string, unknown>), sessionId: id } as unknown as { type: string; [key: string]: unknown };
        if (sessionEvent.type === "agent_start") {
          if (suppressNextAgentStart > 0) {
            suppressNextAgentStart -= 1;
            emitPiSessionEvent(context, session, sessionEvent);
            return;
          }
          turn += 1;
          step = 0;
          status = "running";
          emitAgentEvent("agent/status", { status });
          emitAgentEvent("agent/start", { source: lifecycleSource });
        } else if (sessionEvent.type === "turn_start") {
          if (suppressNextTurnStart > 0) {
            suppressNextTurnStart -= 1;
            emitPiSessionEvent(context, session, sessionEvent);
            return;
          }
          step += 1;
          let claimed: DeepSeekInboxMessage[] = [];
          if (inbox.hasPending) {
            claimed = inbox.claim(step === 1 ? "next-turn" : "next-step");
            for (const message of claimed) emitAgentEvent("agent/inbox/claimed", { message, turn });
          }
          if (step === 1) emitAgentEvent("turn/start", { turn });
          emitAgentEvent("step/start", { turn, step });
          emitAgentEvent("agent/pre-step", { messages: claimed, turn, step });
        } else if (sessionEvent.type === "turn_end") {
          emitAgentEvent("step/end", { turn, step, reason: sessionEvent.message });
        } else if (sessionEvent.type === "agent_end") {
          status = "idle";
          emitAgentEvent("turn/end", { turn, reason: sessionEvent.messages });
          emitAgentEvent("agent/status", { status });
          emitAgentEvent("agent/end", { turn, step });
        } else if (sessionEvent.type === "tool_execution_start") {
          emitAgentEvent("tool/start", { turn, step, toolCallId: sessionEvent.toolCallId, toolName: sessionEvent.toolName, args: sessionEvent.args });
          emitAgentEvent("tools/pre-execute", { turn, step, toolCallId: sessionEvent.toolCallId, toolName: sessionEvent.toolName, args: sessionEvent.args });
        } else if (sessionEvent.type === "tool_execution_update") {
          emitAgentEvent("tool/update", { turn, step, toolCallId: sessionEvent.toolCallId, toolName: sessionEvent.toolName, args: sessionEvent.args, partialResult: sessionEvent.partialResult });
        } else if (sessionEvent.type === "tool_execution_end") {
          emitAgentEvent("tool/end", { turn, step, toolCallId: sessionEvent.toolCallId, toolName: sessionEvent.toolName, result: sessionEvent.result, isError: sessionEvent.isError });
          emitAgentEvent("tool/result", { turn, step, toolCallId: sessionEvent.toolCallId, toolName: sessionEvent.toolName, result: sessionEvent.result, isError: sessionEvent.isError });
        }
        emitPiSessionEvent(context, session, sessionEvent);
      });
      if (setup) {
        appendAgentSetupTransaction(source, "begin", lifecycleSource, setupRevision);
        setupTransactionStarted = true;
        const setupJob = Promise.resolve().then(() => setup(agentContext));
        const result = await raceLifecycle(setupJob, agentSignal, (late) => {
          if (typeof late === "function") void Promise.resolve(late()).catch(() => undefined);
        });
        if (typeof result === "function") setupDispose = result;
      }
      agentSignal.throwIfAborted();
      if (setupTransactionStarted) {
        appendAgentSetupTransaction(source, "commit", lifecycleSource, setupRevision);
      }
      detach = registry.registerAgent(agent);
      live.set(id, handle);
      context.emit(agentCarrier, "agent/session-start", { agent, source: lifecycleSource });
      return handle;
    } catch (error) {
      if (setupTransactionStarted) {
        appendAgentSetupTransaction(source, "rollback", lifecycleSource, setupRevision, {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      await handle.dispose().catch(() => undefined);
      throw error;
    }
  };

  const createAgent = async (ownerCtx: Context, options: DeepSeekAgentCreateOptions): Promise<DeepSeekAgentHandle> => {
    if (disposed) throw new Error("dsh-agent-loop: agent factory is disposed");
    if (!createHostAgent) throw new Error("dsh-agent-loop: Pi agent lifecycle is unavailable");
    const id = options.sessionId;
    if (!id || live.has(id) || pendingIds.has(id)) throw new Error(`dsh-agent-loop: agent "${id}" is already live or invalid`);
    pendingIds.add(id);
    const signal = lifecycleSignal(options.signal);
    let reservation: { token: string; heartbeatMs?: number; renew?: () => Promise<void> | void; release: () => Promise<void> | void } | undefined;
    let reservationTransferred = false;
    try {
      reservation = await host?.reserveAgent?.(id, "create");
      const persisted = await raceLifecycle(host?.listAllSessions?.() ?? Promise.resolve([]), signal);
      if (persisted?.some((entry) => entry && typeof entry === "object" && (entry as { id?: unknown }).id === id)) {
        throw new Error(`dsh-agent-loop: session "${id}" already exists`);
      }
      signal.throwIfAborted();
      const source = await raceLifecycle(createHostAgent({ sessionId: id, cwd: options.meta?.cwd, parentSession: options.meta?.parentSession, provider: options.agentOptions?.provider, model: options.agentOptions?.model, maxTokens: options.agentOptions?.maxTokens, seed: options.seed, signal }), signal, (late) => { void late.dispose().catch(() => undefined); });
      try {
        if (reservation) appendAgentLeaseLifecycle(source, "begin", reservation.token);
        const handle = await register(ownerCtx, id, source, options.agentOptions ?? {}, options.setup, signal, "startup");
        if (reservation) {
          const ownedReservation = reservation;
          let heartbeat: ReturnType<typeof setInterval> | undefined;
          let renewing = false;
          const dispose = handle.dispose;
          if (ownedReservation.renew) {
            heartbeat = setInterval(() => {
              if (renewing) return;
              renewing = true;
              void Promise.resolve(ownedReservation.renew?.()).then(() => {
                appendAgentLeaseLifecycle(source, "renew", ownedReservation.token);
              }).catch(() => handle.agent.cancel(new Error(`dsh-agent-loop: reservation for "${id}" was lost`))).finally(() => { renewing = false; });
            }, ownedReservation.heartbeatMs ?? 40_000);
          }
          handle.dispose = async () => {
            if (heartbeat) clearInterval(heartbeat);
            try {
              appendAgentLeaseLifecycle(source, "release", ownedReservation.token);
              await dispose();
            } finally { await ownedReservation.release(); }
          };
          reservationTransferred = true;
        }
        return handle;
      } catch (error) {
        await source.dispose().catch(() => undefined);
        throw error;
      }
    } finally {
      if (reservation && !reservationTransferred) await Promise.resolve(reservation.release()).catch(() => undefined);
      pendingIds.delete(id);
    }
  };

  const resume = async (ownerCtx: Context, options: DeepSeekAgentResumeOptions): Promise<DeepSeekAgentHandle> => {
    if (disposed) throw new Error("dsh-agent-loop: agent factory is disposed");
    if (!resumeHostAgent) throw new Error("dsh-agent-loop: Pi agent lifecycle is unavailable");
    const id = options.resumeSessionId;
    if (!id || live.has(id) || pendingIds.has(id)) throw new Error(`dsh-agent-loop: agent "${id}" is already live or invalid`);
    pendingIds.add(id);
    const signal = lifecycleSignal(options.signal);
    let reservation: { token: string; heartbeatMs?: number; renew?: () => Promise<void> | void; release: () => Promise<void> | void } | undefined;
    let reservationTransferred = false;
    const persistence = context.get("sessionPersistence") as { prepare?: (sessionId: string, signal?: AbortSignal) => Promise<{ dispose: () => void }> } | undefined;
    try {
      reservation = await host?.reserveAgent?.(id, "resume");
      if (!persistence?.prepare) throw new Error("dsh-agent-loop: session persistence is unavailable");
      const preparation = await raceLifecycle(persistence.prepare(id, signal), signal, (late) => { late.dispose(); });
      try {
        signal.throwIfAborted();
        const source = await raceLifecycle(resumeHostAgent({ sessionId: id, provider: options.agentOptions?.provider, model: options.agentOptions?.model, maxTokens: options.agentOptions?.maxTokens, signal }), signal, (late) => { void late.dispose().catch(() => undefined); });
        try {
          if (reservation) appendAgentLeaseLifecycle(source, "begin", reservation.token);
          const handle = await register(ownerCtx, id, source, options.agentOptions ?? {}, options.setup, signal, "resume");
          if (reservation) {
            const ownedReservation = reservation;
            let heartbeat: ReturnType<typeof setInterval> | undefined;
            let renewing = false;
            const dispose = handle.dispose;
            if (ownedReservation.renew) {
              heartbeat = setInterval(() => {
                if (renewing) return;
                renewing = true;
                void Promise.resolve(ownedReservation.renew?.()).then(() => {
                  appendAgentLeaseLifecycle(source, "renew", ownedReservation.token);
                }).catch(() => handle.agent.cancel(new Error(`dsh-agent-loop: reservation for "${id}" was lost`))).finally(() => { renewing = false; });
              }, ownedReservation.heartbeatMs ?? 40_000);
            }
            handle.dispose = async () => {
              if (heartbeat) clearInterval(heartbeat);
              try {
                appendAgentLeaseLifecycle(source, "release", ownedReservation.token);
                await dispose();
              } finally { await ownedReservation.release(); }
            };
            reservationTransferred = true;
          }
          return handle;
        } catch (error) {
          await source.dispose().catch(() => undefined);
          throw error;
        }
      } finally {
        preparation.dispose();
      }
    } finally {
      if (reservation && !reservationTransferred) await Promise.resolve(reservation.release()).catch(() => undefined);
      pendingIds.delete(id);
    }
  };

  const track = <T>(job: Promise<T>): Promise<T> => {
    pending.add(job);
    void job.then(
      () => { pending.delete(job); },
      () => { pending.delete(job); },
    );
    return job;
  };
  return {
    createAgent: (ownerCtx, options) => track(createAgent(ownerCtx, options)),
    resume: (ownerCtx, options) => track(resume(ownerCtx, options)),
    async dispose() {
      if (disposed) return;
      disposed = true;
      factoryAbort.abort(new Error("dsh-agent-loop: agent factory is disposed"));
      await Promise.allSettled([...pending]);
      await Promise.all([...live.values()].map((handle) => handle.dispose()));
    },
  };
}

export function createDeepSeekPiAgentLoopPlugin(): { inject: string[]; apply: (ctx: Context) => Promise<() => Promise<void>> } {
  return {
    inject: ["agents", "sessions"],
    async apply(ctx) {
      const agents = ctx.get("agents") as { setFactory?: (factory: DeepSeekAgentFactory) => () => void } | undefined;
      if (!agents?.setFactory) throw new Error("dsh-agent-loop: agent registry factory is unavailable");
      const factory = createPiAgentFactory(ctx);
      const release = agents.setFactory(factory);
      return async () => {
        release();
        await factory.dispose();
      };
    },
  };
}

type DeepSeekSessionHeader = {
	version: number;
	id: string;
	createdAt: number;
	cwd?: string;
	parentSession?: string;
};

type DeepSeekSessionEvent = {
	seq: number;
	time: number;
	type: string;
	data?: unknown;
	[key: string]: unknown;
};

function snapshotDeepSeekSessionValue(value: unknown, path = "value"): unknown {
	// P0/snapshot: validate JSON-safety + recursively freeze the original
	// tree in place. Previously this function returned a brand-new tree
	// built via Object.entries → recursive map → Object.freeze. Every append
	// paid O(n) for the copy even though the caller (`append()`) freezes
	// the result via Object.freeze — making the copy unnecessary: if the
	// tree is frozen, no consumer can mutate it, so a separate snapshot
	// is redundant. We keep the JSON-safety check (catches class instances
	// and exotic types that wouldn't survive structuredClone) and drop
	// the copy.
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`${path} is not JSON-safe`);
		return value;
	}
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i += 1) {
			snapshotDeepSeekSessionValue(value[i], `${path}[${i}]`);
		}
		return value;
	}
	if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`${path} is not a plain JSON value`);
	}
	for (const [key, item] of Object.entries(value)) {
		snapshotDeepSeekSessionValue(item, `${path}.${key}`);
	}
	return value;
}

/**
 * Detached Harness session used by the persistence preparation boundary.
 * Pi remains the live AgentSession owner; this object only represents the
 * unpublished JSON event graph required by Harness resume/setup code.
 */
export class DeepSeekHarnessSession {
	private readonly log: DeepSeekSessionEvent[];
	// P0/events-cache: cache the events/messages getters. Both rebuild a full
	// array on every access, and the outer facade exposes them as plain
	// getters that consumers read multiple times per turn. With a long
	// conversation each read triggered an O(n) copy + O(n) filter+map.
	// Cache invalidated on append().
	private eventsCache: readonly DeepSeekSessionEvent[] | null = null;
	private messagesCache: unknown[] | null = null;

	private constructor(
		public readonly header: DeepSeekSessionHeader,
		seed: readonly DeepSeekSessionEvent[] = [],
	) {
		this.log = seed.map((event, index) => {
			if (!event || typeof event !== "object" || event.seq !== index || typeof event.type !== "string") {
				throw new Error(`dsh-session: invalid prepared event at index ${index}`);
			}
			return Object.freeze(snapshotDeepSeekSessionValue(event, `events[${index}]`) as DeepSeekSessionEvent);
		});
	}

	static create(id: string, seed?: readonly DeepSeekSessionEvent[], header?: Partial<DeepSeekSessionHeader>): DeepSeekHarnessSession {
		return new DeepSeekHarnessSession({
			version: 0,
			id,
			createdAt: header?.createdAt ?? Date.now(),
			...(header?.cwd ? { cwd: header.cwd } : {}),
			...(header?.parentSession ? { parentSession: header.parentSession } : {}),
		}, seed);
	}

	static fromRestore(id: string, seed: readonly DeepSeekSessionEvent[], header: DeepSeekSessionHeader): DeepSeekHarnessSession {
		return new DeepSeekHarnessSession({ ...header, id }, seed);
	}

	get id(): string { return this.header.id; }
	get sessionId(): string { return this.id; }
	get cwd(): string | undefined { return this.header.cwd; }
	get events(): readonly DeepSeekSessionEvent[] {
		// P0/events-cache: return the frozen snapshot until append() invalidates.
		// Previously rebuilt a fresh copy + Object.freeze on every read.
		if (this.eventsCache) return this.eventsCache;
		const frozen = Object.freeze([...this.log]);
		this.eventsCache = frozen;
		return frozen;
	}
	get seq(): number { return this.log.length; }
	get messages(): unknown[] {
		// P0/messages-cache: same pattern. deriveMessages() does filter + map
		// over the full event log; caching avoids the rebuild until append().
		if (this.messagesCache) return this.messagesCache;
		const derived = this.deriveMessages();
		this.messagesCache = derived;
		return derived;
	}
	get surface(): { nodes: number[]; replaceGeneration: number } {
		return { nodes: this.log.filter((event) => event.type === "user/message" || event.type === "assistant/message" || event.type === "tool/result").map((event) => event.seq), replaceGeneration: 0 };
	}

	append(type: string, data: unknown, metadata: Record<string, unknown> = {}): DeepSeekSessionEvent {
		if (!/^[a-z][a-z0-9_./-]*$/u.test(type)) throw new Error(`dsh-session: invalid event type ${JSON.stringify(type)}`);
		const event = Object.freeze({
			seq: this.log.length,
			time: Date.now(),
			type,
			...metadata,
			...(data === undefined ? {} : { data: snapshotDeepSeekSessionValue(data, `events[${this.log.length}].data`) }),
		});
		this.log.push(event);
		// P0/events-cache: invalidate the cached snapshots so the next reader
		// sees the new event.
		this.eventsCache = null;
		this.messagesCache = null;
		return event;
	}

	deriveEventMessage(event: DeepSeekSessionEvent): unknown {
		if (event.type === "user/message") return event.data ?? null;
		if (event.type === "assistant/message" || event.type === "tool/result") {
			return event.data && typeof event.data === "object" ? (event.data as { message?: unknown }).message ?? null : null;
		}
		return null;
	}

	deriveMessages(): unknown[] {
		return this.log
			.filter((event) => event.type === "user/message" || event.type === "assistant/message" || event.type === "tool/result")
			.map((event) => this.deriveEventMessage(event))
			.filter((message) => message !== null);
	}

	requestHeader(): undefined { return undefined; }
	requestContext(): undefined { return undefined; }
	prompt(): Promise<void> { return Promise.reject(new Error("dsh-session: detached session cannot prompt; use the Pi AgentSession runtime")); }
	steer(): Promise<void> { return Promise.reject(new Error("dsh-session: detached session cannot steer; use the Pi AgentSession runtime")); }
	followUp(): Promise<void> { return Promise.reject(new Error("dsh-session: detached session cannot follow up; use the Pi AgentSession runtime")); }
	abort(): Promise<void> { return Promise.resolve(); }
	subscribe(): () => void { return () => undefined; }
}

export class DeepSeekSessionPreparation implements Disposable {
	private released = false;

	private constructor(
		public readonly session: DeepSeekHarnessSession,
		public readonly revision: number = 0,
		public readonly sourceRevision?: string,
		private readonly release?: () => void,
	) {}

	static create(session: DeepSeekHarnessSession, options: { revision?: number; sourceRevision?: string; release?: () => void } = {}): DeepSeekSessionPreparation {
		return new DeepSeekSessionPreparation(session, options.revision ?? 0, options.sourceRevision, options.release);
	}

	dispose(): void {
		if (this.released) return;
		this.released = true;
		this.release?.();
	}

	[Symbol.dispose](): void { this.dispose(); }
}

function piEntryTime(entry: Record<string, unknown>, fallback: number): number {
	if (typeof entry.timestamp === "number" && Number.isSafeInteger(entry.timestamp)) return entry.timestamp;
	if (typeof entry.timestamp === "string") {
		const parsed = Date.parse(entry.timestamp);
		if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
	}
	return fallback;
}

function deepSeekEventType(value: unknown): string {
	return typeof value === "string" && /^[a-z][a-z0-9_./-]*$/u.test(value) ? value : "pi/custom";
}

function projectPiPersistenceEntries(entries: readonly unknown[]): DeepSeekSessionEvent[] {
	const projected: DeepSeekSessionEvent[] = [];
	for (const raw of entries) {
		if (!raw || typeof raw !== "object") continue;
		const entry = raw as Record<string, unknown>;
		const index = projected.length;
		const time = piEntryTime(entry, Date.now());
		if (entry.type === "custom" && entry.customType === "deepseek/session-header") continue;
		if (entry.type === "custom" && entry.customType === DEEPSEEK_REPAIR_CUSTOM_TYPE) continue;
		if (entry.type === "custom" && entry.customType === "deepseek/session-event" && entry.data && typeof entry.data === "object" && !Array.isArray(entry.data)) {
			const payload = { ...(entry.data as Record<string, unknown>), seq: index, time };
			projected.push(payload as DeepSeekSessionEvent);
			continue;
		}
		if (entry.type === "custom" && entry.customType === "deepseek/agent-event" && entry.data && typeof entry.data === "object" && !Array.isArray(entry.data)) {
			const envelope = entry.data as { type?: unknown; data?: unknown };
			if (typeof envelope.type === "string") {
				projected.push({ seq: index, time, type: envelope.type, data: envelope.data ?? {} });
				continue;
			}
		}
		if (entry.type === "message" && entry.message && typeof entry.message === "object") {
			const message = snapshotDeepSeekSessionValue(entry.message, `pi.entries[${index}].message`);
			const role = (message as { role?: unknown }).role;
			if (role === "user") {
				projected.push({ seq: index, time, type: "user/message", data: message });
			} else if (role === "assistant") {
				projected.push({ seq: index, time, type: "assistant/message", data: { turn: 0, step: index, message } });
			} else if (role === "toolResult") {
				projected.push({ seq: index, time, type: "tool/result", data: { turn: 0, step: index, message } });
			} else {
				projected.push({ seq: index, time, type: "pi/message", data: { message } });
			}
			continue;
		}
		if (entry.type === "model_change") {
			projected.push({ seq: index, time, type: "pi/model-change", data: {
				provider: entry.provider,
				modelId: entry.modelId,
			} });
			continue;
		}
		if (entry.type === "compaction") {
			projected.push({ seq: index, time, type: "pi/compaction", data: { ...entry } });
			continue;
		}
		if (entry.type === "branch_summary") {
			projected.push({ seq: index, time, type: "pi/branch-summary", data: { ...entry } });
			continue;
		}
		if (entry.type === "custom") {
			projected.push({ seq: index, time, type: deepSeekEventType(entry.customType), data: entry.data ?? {} });
			continue;
		}
		projected.push({ seq: index, time, type: deepSeekEventType(entry.type), data: { ...entry } });
	}
	return projected;
}

function pendingDeepSeekRepair(entries: readonly unknown[]): DeepSeekRepairMarker | undefined {
	const active = new Map<string, DeepSeekRepairMarker>();
	for (const raw of entries) {
		if (!raw || typeof raw !== "object") continue;
		const entry = raw as { type?: unknown; customType?: unknown; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== DEEPSEEK_REPAIR_CUSTOM_TYPE || !entry.data || typeof entry.data !== "object") continue;
		const data = entry.data as Partial<DeepSeekRepairMarker>;
		if (data.version !== 1 || typeof data.repairId !== "string" || (data.operation !== "begin" && data.operation !== "commit")) continue;
		if (data.operation === "begin" && Number.isSafeInteger(data.entryCount)) {
			active.set(data.repairId, data as DeepSeekRepairMarker);
		} else if (data.operation === "commit") {
			active.delete(data.repairId);
		}
	}
	return [...active.values()].at(-1);
}

type DeepSeekRepairCall = { step: number; callSeq?: number };

function interruptedPiTurnClosers(events: readonly DeepSeekSessionEvent[]): DeepSeekSessionEvent[] {
	let openTurn: number | null = null;
	let openStep: number | null = null;
	const pendingCalls = new Map<string, DeepSeekRepairCall>();
	for (const event of events) {
		const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : undefined;
		switch (event.type) {
			case "turn/start":
				openTurn = typeof data?.turn === "number" ? data.turn : openTurn;
				openStep = null;
				pendingCalls.clear();
				break;
			case "turn/end":
				openTurn = null;
				openStep = null;
				pendingCalls.clear();
				break;
			case "step/start":
				openStep = typeof data?.step === "number" ? data.step : openStep;
				break;
			case "step/end":
				openStep = null;
				pendingCalls.clear();
				break;
			case "assistant/message": {
				const message = data?.message;
				const content = message && typeof message === "object" && Array.isArray((message as { content?: unknown }).content)
					? (message as { content: unknown[] }).content : [];
				for (const block of content) {
					if (!block || typeof block !== "object") continue;
					const value = block as Record<string, unknown>;
					if (value.type !== "tool-call") continue;
					const callId = typeof value.id === "string" ? value.id : typeof value.callId === "string" ? value.callId : undefined;
					if (callId && openStep !== null) pendingCalls.set(callId, { step: openStep });
				}
				break;
			}
			case "tool/call": {
				const callId = typeof data?.callId === "string" ? data.callId : undefined;
				const pending = callId ? pendingCalls.get(callId) : undefined;
				if (pending) pending.callSeq = event.seq;
				break;
			}
			case "tool/start": {
				const callId = typeof data?.toolCallId === "string" ? data.toolCallId : typeof data?.callId === "string" ? data.callId : undefined;
				const pending = callId ? pendingCalls.get(callId) : undefined;
				if (pending) pending.callSeq = event.seq;
				break;
			}
			case "tool/result": {
				const message = data?.message;
				const source = message && typeof message === "object" ? (message as { source?: unknown }).source : undefined;
				const callId = typeof data?.callId === "string" ? data.callId
					: typeof data?.toolCallId === "string" ? data.toolCallId
						: source && typeof source === "object" && typeof (source as { callId?: unknown }).callId === "string" ? (source as { callId: string }).callId : undefined;
				if (callId) pendingCalls.delete(callId);
				break;
			}
			default:
				break;
		}
	}
	if (openTurn === null || events.length === 0) return [];
	const last = events[events.length - 1];
	let seq = last.seq + 1;
	const closers: DeepSeekSessionEvent[] = [];
	for (const [callId, pending] of pendingCalls) {
		const started = pending.callSeq !== undefined;
		const errorCode = started ? "TOOL_OUTCOME_UNKNOWN" : "TOOL_NOT_STARTED";
		const event: DeepSeekSessionEvent = {
			seq: seq++,
			time: last.time,
			type: "tool/result",
			data: {
				turn: openTurn,
				step: pending.step,
				message: {
					id: `interrupted-tool-result-${callId}-${seq - 1}`,
					role: "user",
					content: [{ type: "tool-result", toolCallId: callId, isError: true, content: [{ type: "text", text: started
						? "The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Verify external state before retrying."
						: "The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed." }] }],
					source: { kind: "tool", callId },
				},
				error: { name: started ? "ToolOutcomeUnknownError" : "ToolNotStartedError", code: errorCode },
			},
			surfaceOp: "append",
			...(started ? { sourceEventSeqs: [pending.callSeq] } : {}),
		};
		closers.push(event);
	}
	if (openStep !== null) {
		closers.push({ seq: seq++, time: last.time, type: "step/end", data: { turn: openTurn, step: openStep } });
	}
	closers.push({ seq: seq++, time: last.time, type: "turn/end", data: { turn: openTurn, reason: { kind: "interrupted" } } });
	return closers;
}

function sessionFacade(pi: PiSession): SessionFacade {
  const facade = Object.defineProperties({
    id: pi.sessionId,
    sessionId: pi.sessionId,
    cwd: pi.cwd,
    messages: pi.messages,
  } as SessionFacade, {
    prompt: { configurable: true, value: (text: string) => pi.prompt(text) },
    steer: { configurable: true, value: (text: string) => pi.steer(text) },
    followUp: { configurable: true, value: (text: string) => pi.followUp(text) },
    abort: { configurable: true, value: () => pi.abort() },
    subscribe: { configurable: true, value: (listener: (event: unknown) => void) => pi.subscribe(listener) },
  }) as SessionFacade;
  return facade;
}

export class DeepSeekSessionService extends OpenBuddyService {
  static override provide = "sessions";
  private readonly context: RuntimeContext;
	private readonly harnessSessions = new Map<string, DeepSeekHarnessSession>();
	private readonly liveSessions = new Map<string, SessionFacade>();

  constructor(ctx: Context) {
    const serviceKey = ctx.get("sessions") === undefined ? "sessions" : "dshSessions";
    super(ctx, serviceKey);
    this.context = ctx as RuntimeContext;
    ctx.set("session", this);
    ctx.effect(() => () => {
      if (ctx.get("session") === this) ctx.set("session", undefined);
			this.harnessSessions.clear();
			this.liveSessions.clear();
    }, "dsh-session.singular-alias");
  }

	prepare(id?: string, options?: { seed?: readonly DeepSeekSessionEvent[]; meta?: { cwd?: string; parentSession?: string; createdAt?: number } }): DeepSeekHarnessSession {
		const sessionId = id ?? `session-${randomUUID()}`;
		if (this.harnessSessions.has(sessionId)) throw new Error(`dsh-session: session "${sessionId}" already exists`);
		return DeepSeekHarnessSession.create(sessionId, options?.seed, options?.meta);
	}

	enter(session: DeepSeekHarnessSession): () => void {
		if (this.harnessSessions.has(session.id)) throw new Error(`dsh-session: session "${session.id}" already exists`);
		this.harnessSessions.set(session.id, session);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			if (this.harnessSessions.get(session.id) === session) this.harnessSessions.delete(session.id);
		};
	}

	announce(session: DeepSeekHarnessSession): void {
		if (this.harnessSessions.get(session.id) !== session) throw new Error(`dsh-session: session "${session.id}" is not live`);
		this.ctx.emit("session/created", session);
	}

	async flush(session: DeepSeekHarnessSession): Promise<boolean> {
		if (this.harnessSessions.get(session.id) !== session) throw new Error(`dsh-session: session "${session.id}" is not live`);
		return false;
	}

  get(id?: string): SessionFacade | undefined {
    const harness = id ? this.harnessSessions.get(id) : undefined;
    if (harness) return harness;
    const live = id ? this.liveSessions.get(id) : undefined;
    if (live) return live;
    const pi = (this.context.get("pi") as PiRuntime | undefined)?.getSession();
    if (!pi || (id && id !== pi.sessionId)) return undefined;
    return sessionFacade(pi);
  }

  async create(cwd?: string): Promise<{ sessionId?: string; sessionFile?: string; cwd: string }> {
    const host = this.context.get("agentHost") as AgentHostRuntime | undefined;
    if (!host?.newSession) throw new Error("dsh-session: session creation is unavailable");
    return host.newSession(cwd ?? process.cwd());
  }

  async load(id: string, cwd?: string): Promise<void> {
    const host = this.context.get("agentHost") as AgentHostRuntime | undefined;
    if (!host?.loadSession) throw new Error("dsh-session: session loading is unavailable");
    await host.loadSession(id, cwd ?? process.cwd());
  }

  async listPersisted(cwd?: string): Promise<unknown[]> {
    const host = this.context.get("agentHost") as AgentHostRuntime | undefined;
    if (host?.listSessions) return host.listSessions(cwd ?? process.cwd());
    return this.list();
  }

  list(): SessionFacade[] {
    const current = this.get();
    const sessions = [...this.harnessSessions.values()] as SessionFacade[];
    sessions.push(...[...this.liveSessions.values()].filter((session) => !sessions.some((entry) => entry.sessionId === session.sessionId)));
    if (current && !sessions.some((session) => session.sessionId === current.sessionId)) sessions.push(current);
    return sessions;
  }

  registerLiveSession(session: SessionFacade): () => void {
    if (this.liveSessions.has(session.sessionId) || this.harnessSessions.has(session.sessionId)) {
      throw new Error(`dsh-session: session "${session.sessionId}" already exists`);
    }
    this.liveSessions.set(session.sessionId, session);
    this.ctx.emit("session/created", session);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.liveSessions.get(session.sessionId) !== session) return;
      this.liveSessions.delete(session.sessionId);
      this.ctx.emit("session/disposed", session);
    };
  }

  async history(id?: string): Promise<unknown[]> {
    const sessionId = id ?? this.get()?.sessionId;
    if (!sessionId) return [];
    return (this.context.get("eventLog") as { list?: (query?: unknown) => unknown[] } | undefined)?.list?.({ sessionId }) ?? [];
  }

  info(id?: string): unknown {
    const sessionId = id ?? this.get()?.sessionId;
    const host = this.context.get("agentHost") as AgentHostRuntime | undefined;
    return sessionId && host?.sessionInfo ? host.sessionInfo(sessionId) : null;
  }

  usage(id?: string): unknown {
    const sessionId = id ?? this.get()?.sessionId;
    const host = this.context.get("agentHost") as AgentHostRuntime | undefined;
    return sessionId && host?.sessionUsage ? host.sessionUsage(sessionId) : null;
  }

  async selectModel(modelId: string, id?: string): Promise<void> {
    const sessionId = id ?? this.get()?.sessionId;
    const host = this.context.get("agentHost") as AgentHostRuntime | undefined;
    if (!sessionId || !host?.setModel) throw new Error("dsh-session: model selection is unavailable");
    await host.setModel(modelId);
  }
}

export class DeepSeekAgentService extends OpenBuddyService {
  static override provide = "agents";
  static inject = ["sessions"];
  private readonly context: RuntimeContext;
  private factory: DeepSeekAgentFactory | undefined;
  private readonly liveAgents = new Map<string, DeepSeekAgentView>();

  constructor(ctx: Context) {
    super(ctx, "agents");
    this.context = ctx as RuntimeContext;
  }

  private getCompatSessions(): DeepSeekSessionService | undefined {
    return (this.context.get("dshSessions") as DeepSeekSessionService | undefined)
      ?? (this.context.get("sessions") as DeepSeekSessionService | undefined);
  }

  get(id?: string): SessionFacade | undefined {
    const live = id ? this.liveAgents.get(id) : undefined;
    if (live) return live;
    return this.getCompatSessions()?.get(id)
      ?? (this.context.get("session") as DeepSeekSessionService | undefined)?.get(id);
  }

  list(): SessionFacade[] {
    const existing = this.getCompatSessions()?.list()
      ?? (this.context.get("session") as DeepSeekSessionService | undefined)?.list()
      ?? [];
    return [...existing, ...[...this.liveAgents.values()].filter((agent) => !existing.some((session) => session.sessionId === agent.id))];
  }

  currentInitiator(): SessionFacade | undefined {
    return this.get();
  }

  setFactory(factory: DeepSeekAgentFactory): () => void {
    if (this.factory) throw new Error("dsh-agent: an agent factory is already registered");
    this.factory = factory;
    return () => {
      if (this.factory === factory) this.factory = undefined;
    };
  }

  async create(options: DeepSeekAgentCreateOptions): Promise<DeepSeekAgentHandle> {
    if (!this.factory) throw new Error("no agent factory registered (load an agent-loop plugin)");
    return this.factory.createAgent(this.context, options);
  }

  async resume(options: DeepSeekAgentResumeOptions): Promise<DeepSeekAgentHandle> {
    if (!this.factory) throw new Error("no agent factory registered (load an agent-loop plugin)");
    return this.factory.resume(this.context, options);
  }

  registerAgent(agent: DeepSeekAgentView): () => void {
    if (this.liveAgents.has(agent.id)) throw new Error(`dsh-agent: agent "${agent.id}" is already registered`);
    this.liveAgents.set(agent.id, agent);
    this.ctx.emit("agent/created", { agent });
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.liveAgents.get(agent.id) !== agent) return;
      this.liveAgents.delete(agent.id);
      this.ctx.emit("agent/disposed", { agent });
    };
  }
}

export class DeepSeekPersistenceService extends OpenBuddyService {
  static override provide = "sessionPersistence";
  static inject = ["eventLog"];
  private readonly context: RuntimeContext;
  private readonly locations = new Map<string, string>();
  private readonly preparations = new Map<string, DeepSeekSessionPreparation>();
  private readonly preparationInFlight = new Set<string>();
  private readonly revisions = new Map<string, number>();
  private readonly sourceRevisions = new Map<string, string>();
  private readonly appendQueues = new Map<string, Promise<void>>();

  constructor(ctx: Context) {
    super(ctx, "sessionPersistence");
    this.context = ctx as RuntimeContext;
  }

  listEvents(query?: unknown): unknown[] {
    return (this.context.get("eventLog") as { list?: (query?: unknown) => unknown[] } | undefined)?.list?.(query) ?? [];
  }

  private host(): AgentHostRuntime {
    const host = this.context.get("agentHost") as AgentHostRuntime | undefined;
    if (!host) throw new Error("dsh-session-persistence: Pi host is unavailable");
    return host;
  }

  private validateLogicalHeader(id: string, version: unknown): void {
    if (version === undefined || version === 0) return;
    throw Object.assign(new Error(`dsh-session-persistence: session "${id}" uses unsupported DeepSeek session format v${String(version)}; upgrade OpenBuddy to read it`), {
      code: "session-format-unsupported",
      sessionId: id,
      version,
    });
  }

  private validateLogicalEntries(id: string, entries: readonly unknown[]): void {
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const value = entry as { customType?: unknown; data?: unknown };
      if (value.customType !== "deepseek/session-header" || !value.data || typeof value.data !== "object") continue;
      this.validateLogicalHeader(id, (value.data as { version?: unknown }).version);
    }
  }

  private async readSourceRevision(id: string, entries?: readonly unknown[]): Promise<string | undefined> {
    const revision = await this.host().readSessionRevision?.(id);
    if (revision) {
      this.sourceRevisions.set(id, revision.revision);
      return revision.revision;
    }
    if (entries) {
      const fallback = `entries:${entries.length}`;
      this.sourceRevisions.set(id, fallback);
      return fallback;
    }
    return this.sourceRevisions.get(id);
  }

  private async currentSnapshot(id: string): Promise<{ entries: unknown[]; sourceRevision?: string }> {
    const entries = await this.host().readSessionEntries?.(id) ?? [];
    return { entries, sourceRevision: await this.readSourceRevision(id, entries) };
  }

  private async appendRepairMarker(
    id: string,
    marker: DeepSeekRepairMarker,
    options: { expectedRevision?: number; expectedSourceRevision?: string; allowPreparation?: boolean } = {},
  ): Promise<void> {
    const host = this.host();
    const batch = [{ customType: DEEPSEEK_REPAIR_CUSTOM_TYPE, data: marker }];
    if (host.appendSessionEntries) {
      const result = await host.appendSessionEntries(id, batch, { ...options, allowPreparation: true });
      this.revisions.set(id, result.entryCount);
      this.sourceRevisions.set(id, result.sourceRevision);
      return;
    }
    if (!host.appendSessionEntry) throw new Error("dsh-session-persistence: Pi repair marker append is unavailable");
    await host.appendSessionEntry(id, DEEPSEEK_REPAIR_CUSTOM_TYPE, marker);
    const current = await this.currentSnapshot(id);
    this.revisions.set(id, current.entries.length);
  }

  private async header(id: string): Promise<Record<string, unknown>> {
    const value = await this.host().readSessionHeader?.(id);
    if (!value) throw new Error(`dsh-session-persistence: session is unavailable: ${id}`);
    return {
      version: 0,
      id,
      createdAt: typeof value.timestamp === "string" ? Date.parse(value.timestamp) || Date.now() : Date.now(),
      ...(value.cwd ? { cwd: value.cwd } : {}),
      ...(value.parentSessionId ? { parentSession: value.parentSessionId } : {}),
    };
  }

  private preparedSnapshot(id: string): { meta: Record<string, unknown>; events: unknown[] } | undefined {
    const preparation = this.preparations.get(id);
    if (!preparation) return undefined;
    const header = preparation.session.header;
    return {
      meta: { ...header },
      events: preparation.session.events.map((event) => ({ ...event })),
    };
  }

  /** Pi's JSONL file is the sole durable source; no second Harness log is created. */
  async list(): Promise<unknown[]> {
    const host = this.host() as AgentHostRuntime & { listSessionInfos?: () => Promise<Array<{ id: string; path?: string; cwd?: string; parentSessionId?: string; createdAt?: number; timestamp?: string; created?: string }>> };
    const rows = await host.listSessionInfos?.() ?? await host.listSessionHeaders?.() ?? [];
    return Promise.all(rows.map(async (row) => {
      const snapshot = await this.currentSnapshot(row.id);
      this.validateLogicalEntries(row.id, snapshot.entries);
      const sequence = snapshot.entries.length;
      this.revisions.set(row.id, sequence);
      return {
      header: {
        version: 0,
        id: row.id,
        createdAt: row.createdAt ?? (row.timestamp ? Date.parse(row.timestamp) : Date.now()),
        ...(row.cwd ? { cwd: row.cwd } : {}),
        ...(row.parentSessionId ? { parentSession: row.parentSessionId } : {}),
      },
      revision: {
        kind: "pi-jsonl",
        value: row.timestamp ?? row.created ?? String(row.createdAt ?? ""),
        sequence: this.revisions.get(row.id) ?? 0,
        ...(snapshot.sourceRevision ? { sourceRevision: snapshot.sourceRevision } : {}),
      },
      ...("path" in row && typeof row.path === "string" ? (this.locations.set(row.id, row.path), {}) : {}),
      };
    }));
  }

  locate(meta: { id: string }): { kind: "pi-jsonl"; path: string } | undefined {
    const path = this.locations.get(meta.id);
    return path ? { kind: "pi-jsonl", path } : undefined;
  }

  readonly supportsRawArtifacts = true;

  async readRaw(id: string): Promise<{ meta: Record<string, unknown>; filename: string; content: string } | undefined> {
    const raw = await this.host().readSessionRaw?.(id);
    if (!raw) return undefined;
    const firstLine = raw.content.split(/\r?\n/u, 1)[0] ?? "";
    let physicalHeader: unknown;
    try {
      physicalHeader = JSON.parse(firstLine);
    } catch (error) {
      throw Object.assign(new Error(`corrupt Pi session artifact "${raw.path}": invalid first line`), {
        code: "session-corrupt",
        path: raw.path,
        line: 1,
        cause: error,
      });
    }
    if (!physicalHeader || typeof physicalHeader !== "object" || (physicalHeader as { type?: unknown }).type !== "session" || (physicalHeader as { id?: unknown }).id !== id) {
      throw Object.assign(new Error(`corrupt Pi session artifact "${raw.path}": requested id "${id}" does not match the first record`), {
        code: "session-corrupt",
        path: raw.path,
        line: 1,
      });
    }
    if (raw.header.id !== undefined && raw.header.id !== id) {
      throw Object.assign(new Error(`corrupt Pi session artifact "${raw.path}": requested id "${id}" does not match header id`), {
        code: "session-corrupt",
        path: raw.path,
        line: 1,
      });
    }
    const entries: unknown[] = [];
    const lines = raw.content.split(/\r?\n/u);
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line || line.trim() === "") continue;
      try {
        entries.push(JSON.parse(line) as unknown);
      } catch (error) {
        const lineNumber = index + 1;
        throw Object.assign(new Error(`corrupt Pi session artifact "${raw.path}": invalid JSON on line ${lineNumber}`), {
          code: "session-corrupt",
          path: raw.path,
          line: lineNumber,
          cause: error,
        });
      }
    }
    this.validateLogicalEntries(id, entries);
    const header = raw.header;
    return {
      meta: {
        version: 0,
        id,
        createdAt: typeof header.timestamp === "string" ? Date.parse(header.timestamp) || Date.now() : Date.now(),
        ...(typeof header.cwd === "string" ? { cwd: header.cwd } : {}),
        ...(typeof header.parentSession === "string" ? { parentSession: header.parentSession } : {}),
      },
      filename: "session.jsonl",
      content: raw.content,
    };
  }

  async create(meta: { id: string; cwd?: string; parentSession?: string }): Promise<void> {
    const host = this.host();
    if (!host.createPersistedSession || (!host.appendSessionEntry && !host.appendSessionEntries)) throw new Error("dsh-session-persistence: Pi session creation is unavailable");
    const created = await host.createPersistedSession(meta);
    if (created.sessionFile) this.locations.set(meta.id, created.sessionFile);
    if (host.appendSessionEntries) {
      await host.appendSessionEntries(meta.id, [{ customType: "deepseek/session-header", data: { version: 0, ...meta, createdAt: Date.now() } }]);
    } else {
      await host.appendSessionEntry!(meta.id, "deepseek/session-header", { version: 0, ...meta, createdAt: Date.now() });
    }
    const snapshot = await this.currentSnapshot(meta.id);
    this.revisions.set(meta.id, snapshot.entries.length);
  }

  async append(id: string, events: readonly unknown[], options: { expectedRevision?: number; expectedSourceRevision?: string; allowPreparation?: boolean } = {}): Promise<{ revision: number; appended: number; sourceRevision?: string }> {
    const append = this.host().appendSessionEntry;
    const appendBatch = this.host().appendSessionEntries;
    if (!append && !appendBatch) throw new Error("dsh-session-persistence: Pi session append is unavailable");
    if (!options.allowPreparation && (this.preparationInFlight.has(id) || this.preparations.has(id))) {
      throw Object.assign(new Error(`dsh-session-persistence: session "${id}" has an active preparation`), {
        code: "preparation-conflict",
        sessionId: id,
      });
    }
    const previous = this.appendQueues.get(id) ?? Promise.resolve();
    let resolveQueue!: () => void;
    const queue = new Promise<void>((resolve) => { resolveQueue = resolve; });
    const queued = previous.then(() => queue, () => queue);
    this.appendQueues.set(id, queued);
    await previous.catch(() => undefined);
    try {
      const snapshot = await this.currentSnapshot(id);
      const actualRevision = snapshot.entries.length;
      const actualSourceRevision = snapshot.sourceRevision;
      this.revisions.set(id, actualRevision);
      if (options.expectedSourceRevision !== undefined && options.expectedSourceRevision !== actualSourceRevision) {
        throw Object.assign(new Error(`dsh-session-persistence: source revision conflict for session "${id}"`), {
          code: "revision-conflict",
          expectedSourceRevision: options.expectedSourceRevision,
          actualSourceRevision,
          expectedRevision: options.expectedRevision,
          actualRevision,
        });
      }
      if (options.expectedRevision !== undefined && options.expectedRevision !== actualRevision) {
        throw Object.assign(new Error(`dsh-session-persistence: revision conflict for session "${id}" (expected ${options.expectedRevision}, actual ${actualRevision})`), {
          code: "revision-conflict",
          expectedRevision: options.expectedRevision,
          actualRevision,
        });
      }
        const appended = appendBatch
        ? await appendBatch(id, events.map((event) => ({ customType: "deepseek/session-event", data: event })), {
          expectedRevision: actualRevision,
          expectedSourceRevision: actualSourceRevision,
          allowPreparation: options.allowPreparation,
        })
        : { entryIds: [], sourceRevision: undefined, entryCount: actualRevision + events.length };
      if (!appendBatch) for (const event of events) await append!(id, "deepseek/session-event", event);
      const revision = appended.entryCount;
      this.revisions.set(id, revision);
      const afterSourceRevision = appended.sourceRevision ?? (await this.currentSnapshot(id)).sourceRevision;
      if (afterSourceRevision) this.sourceRevisions.set(id, afterSourceRevision);
      return { revision, appended: events.length, sourceRevision: afterSourceRevision };
    } finally {
      resolveQueue();
      if (this.appendQueues.get(id) === queued) this.appendQueues.delete(id);
    }
  }

  async load(id: string): Promise<{ meta: Record<string, unknown>; events: unknown[] }> {
    const prepared = this.preparedSnapshot(id);
    if (prepared) return prepared;
    if (!this.locations.has(id)) await this.list();
    for (;;) {
      const host = this.host();
      const snapshot = await this.currentSnapshot(id);
      const entries = snapshot.entries;
      this.validateLogicalEntries(id, entries);
      this.revisions.set(id, entries.length);
      const events = projectPiPersistenceEntries(entries);
      if (host.getSessionId?.() === id) return { meta: await this.header(id), events };
      const closers = interruptedPiTurnClosers(projectPiPersistenceEntries(entries));
      if (closers.length === 0) {
        const pending = pendingDeepSeekRepair(entries);
        if (pending) {
          await this.appendRepairMarker(id, { ...pending, operation: "commit", entryCount: entries.length, createdAt: Date.now() }, {
            expectedRevision: entries.length,
            expectedSourceRevision: snapshot.sourceRevision,
          });
          const committed = await this.currentSnapshot(id);
          this.revisions.set(id, committed.entries.length);
          return { meta: await this.header(id), events: projectPiPersistenceEntries(committed.entries) };
        }
        const current = await this.currentSnapshot(id);
        if (current.entries.length !== entries.length || current.sourceRevision !== snapshot.sourceRevision) continue;
        return { meta: await this.header(id), events };
      }
      if (host.getSessionId?.() === id) continue;
      const pending = pendingDeepSeekRepair(entries);
      const repairId = pending?.repairId ?? randomUUID();
      if (!pending) {
        await this.appendRepairMarker(id, {
          version: 1,
          operation: "begin",
          repairId,
          sourceRevision: snapshot.sourceRevision,
          entryCount: entries.length,
          createdAt: Date.now(),
        }, { expectedRevision: entries.length, expectedSourceRevision: snapshot.sourceRevision });
      }
      try {
        const afterBegin = await this.currentSnapshot(id);
        const remainingClosers = interruptedPiTurnClosers(projectPiPersistenceEntries(afterBegin.entries));
        if (remainingClosers.length > 0) {
          await this.append(id, remainingClosers, { expectedRevision: afterBegin.entries.length, expectedSourceRevision: afterBegin.sourceRevision, allowPreparation: true });
        }
        const afterClosers = await this.currentSnapshot(id);
        await this.appendRepairMarker(id, {
          version: 1,
          operation: "commit",
          repairId,
          sourceRevision: snapshot.sourceRevision,
          entryCount: afterClosers.entries.length,
          createdAt: Date.now(),
        }, { expectedRevision: afterClosers.entries.length, expectedSourceRevision: afterClosers.sourceRevision });
      } catch (error) {
        if (error && typeof error === "object" && (error as { code?: unknown }).code === "revision-conflict") continue;
        throw error;
      }
      const repaired = await this.currentSnapshot(id);
      const repairedEntries = repaired.entries;
      this.revisions.set(id, repairedEntries.length);
      return { meta: await this.header(id), events: projectPiPersistenceEntries(repairedEntries) };
    }
  }

  async inspect(id: string): Promise<{ meta: Record<string, unknown>; events: unknown[] }> {
    const prepared = this.preparedSnapshot(id);
    if (prepared) return prepared;
    if (!this.locations.has(id)) await this.list();
    const snapshot = await this.currentSnapshot(id);
    const entries = snapshot.entries;
    this.validateLogicalEntries(id, entries);
    this.revisions.set(id, entries.length);
    return { meta: await this.header(id), events: projectPiPersistenceEntries(entries) };
  }

  async readFrom(id: string, seq = 0): Promise<{ meta: Record<string, unknown>; events: unknown[] }> {
    if (!Number.isSafeInteger(seq) || seq < 0) throw new TypeError(`dsh-session-persistence: readFrom seq must be a non-negative safe integer, got ${String(seq)}`);
    if (!this.locations.has(id)) await this.list();
    const snapshot = await this.currentSnapshot(id);
    this.validateLogicalEntries(id, snapshot.entries);
    this.revisions.set(id, snapshot.entries.length);
    const events = projectPiPersistenceEntries(snapshot.entries);
    return {
      meta: await this.header(id),
      events: events.filter((event) => event.seq >= seq),
    };
  }

  async prepare(id: string, signal?: AbortSignal): Promise<DeepSeekSessionPreparation> {
    signal?.throwIfAborted();
    if (!id || typeof id !== "string") throw new TypeError("dsh-session-persistence: session id is required");
    if (this.preparations.has(id)) throw new Error(`dsh-session-persistence: session "${id}" is already prepared`);
    if (this.preparationInFlight.has(id)) {
      throw Object.assign(new Error(`dsh-session-persistence: session "${id}" is already being prepared`), {
        code: "preparation-conflict",
        sessionId: id,
      });
    }
    const liveId = this.host().getSessionId?.();
    if (liveId === id) throw new Error(`dsh-session-persistence: cannot prepare live session "${id}"`);
    this.preparationInFlight.add(id);
    let reservation: Awaited<ReturnType<NonNullable<AgentHostRuntime["reservePreparation"]>>> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let reservationTransferred = false;
    try {
      reservation = await this.host().reservePreparation?.(id);
      if (reservation?.renew) {
        let renewing = false;
        heartbeat = setInterval(() => {
          if (renewing) return;
          renewing = true;
          void Promise.resolve(reservation?.renew?.()).catch(() => undefined).finally(() => { renewing = false; });
        }, reservation.heartbeatMs ?? 40_000);
      }
      for (;;) {
        const loaded = await this.load(id);
        signal?.throwIfAborted();
        if (this.host().getSessionId?.() === id) throw new Error(`dsh-session-persistence: session "${id}" became live while preparing`);
        const loadedRevision = this.revisions.get(id) ?? loaded.events.length;
        const loadedSourceRevision = this.sourceRevisions.get(id);
        const current = await this.currentSnapshot(id);
        const currentRevision = current.entries.length;
        if (currentRevision !== loadedRevision || (loadedSourceRevision !== undefined && current.sourceRevision !== loadedSourceRevision)) {
          this.revisions.set(id, currentRevision);
          continue;
        }
        const events = loaded.events.map((event, index) => {
      if (!event || typeof event !== "object") throw new Error(`dsh-session-persistence: invalid event at index ${index}`);
      const value = event as Record<string, unknown>;
      return {
        ...value,
        seq: typeof value.seq === "number" ? value.seq : index,
        time: typeof value.time === "number" ? value.time : Date.now(),
        type: typeof value.type === "string" ? value.type : "deepseek/session-event",
      };
        });
        const session = DeepSeekHarnessSession.fromRestore(id, events, {
      version: typeof loaded.meta.version === "number" ? loaded.meta.version : 0,
      id,
      createdAt: typeof loaded.meta.createdAt === "number" ? loaded.meta.createdAt : Date.now(),
      ...(typeof loaded.meta.cwd === "string" ? { cwd: loaded.meta.cwd } : {}),
      ...(typeof loaded.meta.parentSession === "string" ? { parentSession: loaded.meta.parentSession } : {}),
        });
        let preparation: DeepSeekSessionPreparation;
      preparation = DeepSeekSessionPreparation.create(session, {
      revision: this.revisions.get(id) ?? loaded.events.length,
      sourceRevision: this.sourceRevisions.get(id),
      release: () => {
        if (heartbeat) clearInterval(heartbeat);
        void reservation?.release();
        if (this.preparations.get(id) === preparation) this.preparations.delete(id);
      },
        });
        this.preparations.set(id, preparation);
        reservationTransferred = true;
        return preparation;
      }
    } finally {
      if (!reservationTransferred) {
        if (heartbeat) clearInterval(heartbeat);
        await Promise.resolve(reservation?.release()).catch(() => undefined);
      }
      this.preparationInFlight.delete(id);
    }
  }
}

type SessionQueryHeader = {
  id: string;
  cwd?: string;
  title?: string;
  name?: string;
  timestamp?: string;
	createdAt?: number;
	created?: string;
	parentSessionId?: string;
	modified?: string;
	messageCount?: number;
	firstMessage?: string;
	allMessagesText?: string;
};

type SessionQuerySessionRecord = {
  header: SessionQueryHeader;
  live: boolean;
  persisted: boolean;
};

type SessionQueryEventRecord = {
  sessionId: string;
  seq: number;
  entryId?: string;
  parentSeq?: number;
  fromSeq?: number;
  type: string;
  time: number;
  surface: "current" | "shadowed" | "log-only";
  replacedBy?: number;
  replacedEventSeqs?: number[];
  sourceEventSeqs?: number[];
  surfaceOp?: "append" | { op: "replace"; start: number; end: number };
  text?: string;
  payload?: unknown;
};

type SessionQueryFilter =
  | { kind: "id"; values: readonly string[] }
  | { kind: "cwd"; values: readonly (string | null)[] }
  | { kind: "created-at"; from?: number; to?: number }
  | { kind: "parent"; values: readonly (string | null)[] }
  | { kind: "availability"; values: readonly ("live" | "persisted")[] }
  | { kind: "type"; values: readonly string[] }
  | { kind: "surface"; values: readonly ("current" | "shadowed" | "log-only")[] }
  | { kind: "seq" | "time"; from?: number; to?: number }
  | { kind: "text"; text: string };

type SessionQueryRequest = {
  query: string;
  sessionFilters?: readonly SessionQueryFilter[];
  eventFilters?: readonly SessionQueryFilter[];
  workspaceId?: string;
  limit?: number;
  cursor?: string;
};

export type SessionQueryErrorCode =
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
  | "SESSION_QUERY_STALE_CURSOR";

export class SessionQueryError extends Error {
  readonly code: SessionQueryErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: SessionQueryErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SessionQueryError";
    this.code = code;
    this.details = details;
  }
}

export type SessionQueryEventWindow = {
	session: SessionQueryHeader;
	target: SessionQueryEventRecord;
	events: SessionQueryEventRecord[];
	startSeq: number;
	endSeq: number;
};

export type SessionQuerySurfaceSnapshot = {
  session: SessionQueryHeader;
  capturedThroughSeq: number | null;
  events: SessionQueryEventRecord[];
};

export type SessionQueryEventTrace = {
  session: SessionQueryHeader;
  target: SessionQueryEventRecord;
  replacedBy?: number;
  replacementChain: number[];
  replacedEventSeqs: number[];
  sourceEventSeqs: number[];
  derivedEventSeqs: number[];
};

export type SessionQueryLineageNode = {
  session: SessionQuerySessionRecord;
  descendants: SessionQueryLineageNode[];
};

export type SessionQueryLineageTrace = {
  target: SessionQuerySessionRecord;
  ancestors: SessionQuerySessionRecord[];
  descendants: SessionQueryLineageNode[];
  complete: boolean;
  root?: SessionQuerySessionRecord;
  unresolvedParentId?: string;
};

function queryText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(queryText).join(" ");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map(queryText).join(" ");
  return String(value);
}

function searchableText(value: unknown): string {
	return queryText(value).trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function eventText(value: { type: string; message?: unknown; data?: unknown; name?: unknown; payload?: unknown }): string {
  const message = value.message && typeof value.message === "object" ? value.message as Record<string, unknown> : undefined;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const item = part as { type?: unknown; text?: unknown; content?: unknown };
    return item.type === "text" && typeof item.text === "string" ? item.text : typeof item.content === "string" ? item.content : "";
  }).filter(Boolean).join(" ");
  if (value.type === "compaction" || value.type === "branch_summary") return queryText(value);
  return queryText(value.data ?? value.name ?? value.payload ?? message?.content ?? "");
}

type QueryCursor = { version: 2; offset: number; queryFingerprint: string; corpusFingerprint: string };

function cursorFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

function queryCursor(value: unknown, queryFingerprint?: string, corpusFingerprint?: string): number {
  if (value === undefined) return 0;
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new SessionQueryError("SESSION_QUERY_INVALID_CURSOR", "session-query cursor must be a base64url string");
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<QueryCursor>;
    if (decoded.version !== 2) throw new Error("unsupported cursor version");
    if (typeof decoded.offset !== "number" || !Number.isSafeInteger(decoded.offset) || decoded.offset < 0) throw new Error("invalid cursor offset");
    if (typeof decoded.queryFingerprint !== "string" || typeof decoded.corpusFingerprint !== "string") throw new Error("cursor fingerprint is missing");
    if (queryFingerprint !== undefined && decoded.queryFingerprint !== queryFingerprint) {
      throw new SessionQueryError("SESSION_QUERY_STALE_CURSOR", "session-query cursor does not match this query");
    }
    if (corpusFingerprint !== undefined && decoded.corpusFingerprint !== corpusFingerprint) {
      throw new SessionQueryError("SESSION_QUERY_STALE_CURSOR", "session-query cursor is stale");
    }
    return decoded.offset;
  } catch (error) {
    if (error instanceof SessionQueryError) throw error;
    throw new SessionQueryError("SESSION_QUERY_INVALID_CURSOR", "session-query cursor is invalid", { cause: String(error) });
  }
}

function nextQueryCursor(offset: number, total: number, queryFingerprint: string, corpusFingerprint: string): string | undefined {
  if (offset >= total) return undefined;
  const cursor: QueryCursor = { version: 2, offset, queryFingerprint, corpusFingerprint };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function filterRange(value: number, filter: { from?: number; to?: number }): boolean {
  return (filter.from === undefined || value >= filter.from) && (filter.to === undefined || value <= filter.to);
}

function queryFilterSession(record: SessionQuerySessionRecord, filter: SessionQueryFilter): boolean {
  if (filter.kind === "id") return filter.values.includes(record.header.id);
  if (filter.kind === "cwd") return filter.values.includes(record.header.cwd ?? null);
  if (filter.kind === "created-at") return filterRange(record.header.createdAt ?? (Date.parse(record.header.timestamp ?? "") || 0), filter);
  if (filter.kind === "parent") return filter.values.includes(record.header.parentSessionId ?? null);
  if (filter.kind === "availability") return filter.values.some((value) => value === "live" ? record.live : record.persisted);
  return true;
}

function queryFilterEvent(event: SessionQueryEventRecord, filter: SessionQueryFilter): boolean {
  if (filter.kind === "type") return filter.values.includes(event.type);
  if (filter.kind === "seq" || filter.kind === "time") return filterRange(filter.kind === "seq" ? event.seq : event.time, filter);
  if (filter.kind === "text") return searchableText(event.text).includes(searchableText(filter.text));
  if (filter.kind === "surface") return filter.values.includes(event.surface);
  return true;
}

const surfaceEventTypes = new Set(["user/message", "assistant/message", "tool/result"]);

function projectSurfaceEvents(events: SessionQueryEventRecord[]): SessionQueryEventRecord[] {
  const canonical = events.some((event) => event.surfaceOp !== undefined);
  if (!canonical) {
    const hasPiEntries = events.some((event) => event.type === "message" || event.type === "compaction" || event.type === "branch_summary" || event.type === "custom");
    return events.map((event) => ({ ...event, surface: hasPiEntries ? event.type === "message" ? "current" : "log-only" : "current" }));
  }

  const nodes: number[] = [];
  const replacedBy = new Map<number, number>();
  const replacedEventSeqs = new Map<number, number[]>();
  const current = new Set<number>();
  for (const [index, event] of events.entries()) {
    if (event.seq !== index) throw new SessionQueryError("SESSION_QUERY_INVALID_SURFACE", `event sequence ${event.seq} is not contiguous; expected ${index}`);
    const eligible = surfaceEventTypes.has(event.type);
    if (!eligible && event.surfaceOp !== undefined) throw new SessionQueryError("SESSION_QUERY_INVALID_SURFACE", `event ${event.seq} is not surface-eligible`);
    if (eligible && event.surfaceOp === undefined) throw new SessionQueryError("SESSION_QUERY_INVALID_SURFACE", `event ${event.seq} is missing surface operation`);
    if (!eligible) continue;
    if (event.surfaceOp === "append") {
      nodes.push(event.seq);
      continue;
    }
    const operation = event.surfaceOp;
    if (!operation || operation.op !== "replace" || !Number.isSafeInteger(operation.start) || !Number.isSafeInteger(operation.end)) {
      throw new SessionQueryError("SESSION_QUERY_INVALID_SURFACE", `event ${event.seq} has an invalid surface operation`);
    }
    const start = nodes.indexOf(operation.start);
    const end = nodes.indexOf(operation.end);
    if (start < 0 || end < start) throw new SessionQueryError("SESSION_QUERY_INVALID_SURFACE", `event ${event.seq} replaces a missing surface range`);
    const shadowed = nodes.slice(start, end + 1);
    const sources = event.sourceEventSeqs ?? [];
    if (sources.some((seq) => !Number.isSafeInteger(seq) || seq < 0 || seq >= event.seq)) {
      throw new SessionQueryError("SESSION_QUERY_INVALID_SURFACE", `event ${event.seq} cites an invalid source sequence`);
    }
    if (new Set(sources).size !== sources.length) throw new SessionQueryError("SESSION_QUERY_INVALID_SURFACE", `event ${event.seq} cites duplicate source sequences`);
    if (!shadowed.every((seq) => sources.includes(seq))) throw new SessionQueryError("SESSION_QUERY_INVALID_SURFACE", `event ${event.seq} does not cite every shadowed source`);
    nodes.splice(start, shadowed.length, event.seq);
    replacedEventSeqs.set(event.seq, shadowed);
    for (const seq of shadowed) replacedBy.set(seq, event.seq);
  }
  for (const seq of nodes) current.add(seq);
  return events.map((event) => ({
    ...event,
    surface: current.has(event.seq) ? "current" : replacedBy.has(event.seq) ? "shadowed" : "log-only",
    ...(replacedBy.has(event.seq) ? { replacedBy: replacedBy.get(event.seq) } : {}),
    ...(replacedEventSeqs.has(event.seq) ? { replacedEventSeqs: replacedEventSeqs.get(event.seq) } : {}),
  }));
}

function projectPiBranchSurface(
	events: SessionQueryEventRecord[],
	entries: readonly { id?: unknown; parentId?: unknown; type?: unknown; firstKeptEntryId?: unknown; fromId?: unknown }[],
): SessionQueryEventRecord[] {
	const idToSeq = new Map<string, number>();
	for (const [seq, entry] of entries.entries()) {
		if (typeof entry.id !== "string" || !entry.id) throw new SessionQueryError("SESSION_QUERY_INVALID_LINEAGE", `Pi entry ${seq} has no id`, { seq });
		if (idToSeq.has(entry.id)) throw new SessionQueryError("SESSION_QUERY_INVALID_LINEAGE", `Pi entry id ${entry.id} is duplicated`, { entryId: entry.id });
		idToSeq.set(entry.id, seq);
	}
	const leafSeq = entries.length - 1;
	const activePath: number[] = [];
	const active = new Set<number>();
	const seen = new Set<string>();
	let currentSeq: number | undefined = leafSeq;
	while (currentSeq !== undefined) {
		const current = entries[currentSeq];
		if (!current || typeof current.id !== "string") throw new SessionQueryError("SESSION_QUERY_INVALID_LINEAGE", `Pi entry ${currentSeq} is missing`, { seq: currentSeq });
		if (seen.has(current.id)) throw new SessionQueryError("SESSION_QUERY_INVALID_LINEAGE", `Pi entry lineage contains a cycle at ${current.id}`, { entryId: current.id });
		seen.add(current.id);
		activePath.unshift(currentSeq);
		active.add(currentSeq);
		if (current.parentId === null || current.parentId === undefined) break;
		if (typeof current.parentId !== "string" || !idToSeq.has(current.parentId)) {
			throw new SessionQueryError("SESSION_QUERY_INVALID_LINEAGE", `Pi entry ${current.id} references a missing parent`, { entryId: current.id, parentId: current.parentId });
		}
		currentSeq = idToSeq.get(current.parentId);
	}
	const activeCompaction = [...activePath].reverse().find((seq) => entries[seq]?.type === "compaction");
	let retainedStart = 0;
	const replacedBy = new Map<number, number>();
	if (activeCompaction !== undefined) {
		const compaction = entries[activeCompaction];
		if (typeof compaction.firstKeptEntryId !== "string") {
			throw new SessionQueryError("SESSION_QUERY_INVALID_LINEAGE", `Pi compaction ${compaction.id} has no firstKeptEntryId`, { entryId: compaction.id });
		}
		const keptSeq = idToSeq.get(compaction.firstKeptEntryId);
		const compactionPathIndex = activePath.indexOf(activeCompaction);
		const keptPathIndex = keptSeq === undefined ? -1 : activePath.indexOf(keptSeq);
		if (keptPathIndex < 0 || keptPathIndex >= compactionPathIndex) {
			throw new SessionQueryError("SESSION_QUERY_INVALID_LINEAGE", `Pi compaction ${compaction.id} has an invalid firstKeptEntryId`, { entryId: compaction.id, firstKeptEntryId: compaction.firstKeptEntryId });
		}
		retainedStart = keptPathIndex;
		for (const seq of activePath.slice(0, retainedStart)) {
			if (entries[seq]?.type === "message") replacedBy.set(seq, activeCompaction);
		}
	}
	const activeSurface = new Set<number>();
	for (const seq of activePath.slice(retainedStart)) {
		const type = entries[seq]?.type;
		if (type === "message" || type === "compaction") activeSurface.add(seq);
	}
	const replacedEventSeqs = activeCompaction === undefined ? undefined : [...replacedBy.keys()].sort((left, right) => left - right);
	return events.map((event) => {
		const entry = entries[event.seq];
		const isMessage = entry?.type === "message";
		const surface = activeSurface.has(event.seq) ? "current" : isMessage && active.has(event.seq) ? "shadowed" : "log-only";
		return {
			...event,
			surface,
			...(typeof entry?.id === "string" ? { entryId: entry.id } : {}),
			...(typeof entry?.fromId === "string" && idToSeq.has(entry.fromId) ? { fromSeq: idToSeq.get(entry.fromId) } : {}),
			...(replacedBy.has(event.seq) ? { replacedBy: replacedBy.get(event.seq) } : {}),
			...(event.seq === activeCompaction && replacedEventSeqs?.length ? { replacedEventSeqs } : {}),
		};
	});
}

function validateFilter(filter: unknown, index: number, scope: "session" | "event"): asserts filter is SessionQueryFilter {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    throw new SessionQueryError("SESSION_QUERY_INVALID_FILTER", `${scope}-query filter[${index}] must be an object`);
  }
  const value = filter as Record<string, unknown>;
  const allowed = scope === "session" ? ["id", "cwd", "created-at", "parent", "availability"] : ["type", "seq", "time", "surface", "text"];
  if (typeof value.kind !== "string" || !allowed.includes(value.kind)) {
    throw new SessionQueryError("SESSION_QUERY_INVALID_FILTER", `${scope}-query filter[${index}].kind is invalid`);
  }
  if (["id", "cwd", "parent", "availability", "type", "surface"].includes(value.kind)) {
    if (!Array.isArray(value.values) || value.values.length === 0) {
      throw new SessionQueryError("SESSION_QUERY_INVALID_FILTER", `${scope}-query filter[${index}].values must be a non-empty array`);
    }
    if (value.values.some((item) => typeof item !== "string" && item !== null)) {
      throw new SessionQueryError("SESSION_QUERY_INVALID_FILTER", `${scope}-query filter[${index}].values contains an invalid value`);
    }
  }
  if (value.kind === "text" && typeof value.text !== "string") {
    throw new SessionQueryError("SESSION_QUERY_INVALID_FILTER", `${scope}-query filter[${index}].text must be text`);
  }
  if (value.kind === "created-at" || value.kind === "seq" || value.kind === "time") {
    for (const key of ["from", "to"] as const) {
      if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0)) {
        throw new SessionQueryError("SESSION_QUERY_INVALID_FILTER", `${scope}-query filter[${index}].${key} must be non-negative`);
      }
    }
    if (typeof value.from === "number" && typeof value.to === "number" && value.from > value.to) {
      throw new SessionQueryError("SESSION_QUERY_INVALID_FILTER", `${scope}-query filter[${index}] has an inverted range`);
    }
  }
}

function validateFilters(filters: readonly SessionQueryFilter[] | undefined, scope: "session" | "event"): void {
  if (filters === undefined) return;
  if (!Array.isArray(filters)) throw new SessionQueryError("SESSION_QUERY_INVALID_FILTER", `${scope}-query filters must be an array`);
  filters.forEach((filter, index) => validateFilter(filter, index, scope));
}

function validateLimit(value: unknown): number {
  if (value === undefined) return 20;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new SessionQueryError("SESSION_QUERY_INVALID_LIMIT", "session-query limit must be an integer between 1 and 100");
  }
  return value;
}

function validateRequest(request: SessionQueryRequest, requireQuery = true): void {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new SessionQueryError("SESSION_QUERY_INVALID_QUERY", "session-query request must be an object");
  }
  if (requireQuery && typeof request.query !== "string") {
    throw new SessionQueryError("SESSION_QUERY_INVALID_QUERY", "session-query query must be text");
  }
  if (request.workspaceId !== undefined && (typeof request.workspaceId !== "string" || !request.workspaceId.trim())) {
    throw new SessionQueryError("SESSION_QUERY_INVALID_FILTER", "session-query workspaceId must be a non-empty string");
  }
  validateFilters(request.sessionFilters, "session");
  validateFilters(request.eventFilters, "event");
  validateLimit(request.limit);
  queryCursor(request.cursor);
}

function requestFingerprint(request: SessionQueryRequest): string {
  const { cursor: _cursor, ...withoutCursor } = request;
  return cursorFingerprint(withoutCursor);
}

function queryHeader(value: SessionQueryHeader): SessionQueryHeader {
	const createdAt = value.createdAt ?? ((typeof value.created === "string" ? Date.parse(value.created) : 0) || (typeof value.timestamp === "string" ? Date.parse(value.timestamp) : 0));
	return { ...value, ...(createdAt > 0 ? { createdAt } : {}) };
}

function buildLineageDescendants(rows: readonly SessionQuerySessionRecord[], sessionId: string): SessionQueryLineageNode[] {
	const children = new Map<string, SessionQuerySessionRecord[]>();
	for (const row of rows) {
		const parent = row.header.parentSessionId;
		if (!parent) continue;
		const list = children.get(parent) ?? [];
		list.push(row);
		children.set(parent, list);
	}
	for (const list of children.values()) {
		list.sort((left, right) => (left.header.createdAt ?? 0) - (right.header.createdAt ?? 0) || left.header.id.localeCompare(right.header.id));
	}
	const build = (id: string, path: Set<string>): SessionQueryLineageNode[] => {
		const result: SessionQueryLineageNode[] = [];
		for (const child of children.get(id) ?? []) {
			if (path.has(child.header.id)) {
				throw new SessionQueryError("SESSION_QUERY_INVALID_LINEAGE", `session lineage contains a cycle at ${child.header.id}`, { sessionId: child.header.id });
			}
			const nextPath = new Set(path);
			nextPath.add(child.header.id);
			result.push({ session: child, descendants: build(child.header.id, nextPath) });
		}
		return result;
	};
	return build(sessionId, new Set([sessionId]));
}

/** Pi-backed implementation of the DeepSeek Harness session-query service. */
export class DeepSeekSessionQueryService extends OpenBuddyService {
  static override provide = "sessionQuery";
  static inject = ["sessions", "eventLog"];
  private readonly context: RuntimeContext;

  constructor(ctx: Context) {
    super(ctx, "sessionQuery");
    this.context = ctx as RuntimeContext;
    ctx.set("sessionQuery", this);
    ctx.root.set("sessionQuery", this);
    ctx.effect(() => () => {
      if (ctx.get("sessionQuery") === this) ctx.set("sessionQuery", undefined);
      if (ctx.root.get("sessionQuery") === this) ctx.root.set("sessionQuery", undefined);
    }, "dsh-session-query.service");
  }

  private host(): AgentHostRuntime {
    const host = this.context.get("agentHost") as AgentHostRuntime | undefined;
    if (!host) throw new Error("dsh-session-query: Pi host is unavailable");
    return host;
  }

	private async headers(): Promise<SessionQueryHeader[]> {
		const host = this.host();
		const rows = host.listSessionInfos
			? await host.listSessionInfos()
			: host.listSessionHeaders ? await host.listSessionHeaders() : [];
		return rows.map((row) => ({ ...row, id: row.id, ...(row.parentSessionId ? { parentSessionId: row.parentSessionId } : {}) }));
	}

	private async workspaceSessionIds(workspaceId: string | undefined): Promise<Set<string> | undefined> {
		if (workspaceId === undefined) return undefined;
		const registry = this.context.get("workspaceRegistry") as {
			authorizeSessionQueryWorkspace?: (id: string) => Promise<WorkspaceAuthorizationSnapshot>;
		} | undefined;
		if (registry?.authorizeSessionQueryWorkspace) {
			const snapshot = await registry.authorizeSessionQueryWorkspace(workspaceId);
			return new Set(snapshot.sessionIds);
		}
		const host = this.host();
		if (!host.listWorkspaces) {
			throw new SessionQueryError(
				"SESSION_QUERY_WORKSPACE_AUTHORIZATION_UNAVAILABLE",
				"session-query workspace authorization is unavailable",
				{ workspaceId },
			);
		}
		const workspace = (await host.listWorkspaces()).find((entry) => {
			if (!entry || typeof entry !== "object") return false;
			const value = entry as { workspaceId?: unknown; id?: unknown };
			return value.workspaceId === workspaceId || value.id === workspaceId;
		}) as { sessionIds?: unknown } | undefined;
		if (!workspace) throw new SessionQueryError("SESSION_QUERY_WORKSPACE_NOT_FOUND", `workspace not found: ${workspaceId}`, { workspaceId });
		return new Set(Array.isArray(workspace.sessionIds) ? workspace.sessionIds.filter((id): id is string => typeof id === "string") : []);
	}

  private liveIds(): Set<string> {
    const agents = this.context.get("agents") as DeepSeekAgentService | undefined;
    return new Set(agents?.list().map((session) => session.id) ?? []);
  }

	private eventLogEvents(sessionId?: string): SessionQueryEventRecord[] {
		const eventLog = this.context.get("eventLog") as { list?: (query?: unknown) => Array<{ sequence: number; timestamp: string; type: string; sessionId?: string; payload?: unknown }> } | undefined;
    const rows = eventLog?.list?.(sessionId ? { sessionId } : {}) ?? [];
    return rows.filter((row) => !sessionId || row.sessionId === sessionId).map((row) => ({
      sessionId: row.sessionId ?? sessionId ?? "",
      seq: row.sequence,
      type: row.type,
      time: Date.parse(row.timestamp) || 0,
      surface: "current",
      text: queryText(row.payload),
      payload: row.payload,
		}));
	}

	private async piEvents(sessionId: string): Promise<SessionQueryEventRecord[]> {
		const entries = await this.host().readSessionEntries?.(sessionId);
		if (!entries) return [];
		const sequenceById = new Map<string, number>();
		const projected = entries.map((entry, index) => {
			const value = entry as {
				id?: unknown;
				parentId?: unknown;
				type?: unknown;
				timestamp?: unknown;
				message?: unknown;
				customType?: unknown;
				data?: unknown;
				name?: unknown;
				surfaceOp?: unknown;
				sourceEventSeqs?: unknown;
			};
			const message = value.message && typeof value.message === "object" ? value.message as Record<string, unknown> : undefined;
			const payload = value.message ?? value.data ?? entry;
			const timestamp = typeof value.timestamp === "string" ? Date.parse(value.timestamp) : typeof value.timestamp === "number" ? value.timestamp : 0;
			const projectedType = value.customType === "plan/mode" || value.customType === "todo/write"
				? value.customType
				: typeof value.type === "string" ? value.type : "unknown";
			const text = eventText({ type: projectedType, message: value.message, data: value.data, name: value.name, payload });
			if (value.surfaceOp !== undefined && !(value.surfaceOp === "append" || (value.surfaceOp && typeof value.surfaceOp === "object" && !Array.isArray(value.surfaceOp) && (value.surfaceOp as { op?: unknown }).op === "replace"))) {
				throw new SessionQueryError("SESSION_QUERY_INVALID_SURFACE", `event ${index} has an invalid surface operation`);
			}
			const surfaceOp = value.surfaceOp === "append" || (value.surfaceOp && typeof value.surfaceOp === "object" && (value.surfaceOp as { op?: unknown }).op === "replace")
				? value.surfaceOp as SessionQueryEventRecord["surfaceOp"] : undefined;
			const sourceEventSeqs = Array.isArray(value.sourceEventSeqs)
				? value.sourceEventSeqs.filter((seq): seq is number => Number.isSafeInteger(seq) && seq >= 0) : undefined;
			if (typeof value.id === "string") sequenceById.set(value.id, index);
			return {
				sessionId,
				seq: index,
				type: projectedType,
				time: timestamp || 0,
				surface: "current" as const,
				...(surfaceOp ? { surfaceOp } : {}),
				...(sourceEventSeqs ? { sourceEventSeqs } : {}),
				...(typeof value.parentId === "string" && sequenceById.has(value.parentId) ? { parentSeq: sequenceById.get(value.parentId) } : {}),
				...(typeof value.id === "string" ? { entryId: value.id } : {}),
				...(text ? { text } : {}),
				payload,
			};
		});
		const hasPiBranchEntries = entries.some((entry) => {
			if (!entry || typeof entry !== "object") return false;
			const type = (entry as { type?: unknown }).type;
			return type === "message" || type === "compaction" || type === "branch_summary";
		});
		return hasPiBranchEntries ? projectPiBranchSurface(projected, entries as Array<{ id?: unknown; parentId?: unknown; type?: unknown; firstKeptEntryId?: unknown; fromId?: unknown }>) : projectSurfaceEvents(projected);
	}

	private async events(sessionId?: string): Promise<SessionQueryEventRecord[]> {
		if (sessionId && this.host().readSessionEntries) {
			try {
				const events = await this.piEvents(sessionId);
				if (events.length > 0) return events;
			} catch (error) {
				if (error instanceof SessionQueryError && (error.code === "SESSION_QUERY_INVALID_SURFACE" || error.code === "SESSION_QUERY_INVALID_LINEAGE")) throw error;
				// A live in-memory fixture or an old Pi session may not have a readable file.
			}
		}
		return this.eventLogEvents(sessionId);
	}

  async listSessions(signal?: AbortSignal): Promise<SessionQuerySessionRecord[]> {
    if (signal?.aborted) throw new SessionQueryError("SESSION_QUERY_ABORTED", "session-query aborted");
    const persisted = await this.headers();
    const live = this.liveIds();
    const byId = new Map<string, SessionQuerySessionRecord>();
    for (const header of persisted) byId.set(header.id, { header: queryHeader(header), live: live.has(header.id), persisted: true });
    for (const id of live) {
      if (!byId.has(id)) byId.set(id, { header: { id }, live: true, persisted: false });
    }
    return [...byId.values()].sort((left, right) => (Date.parse(right.header.timestamp ?? "") || 0) - (Date.parse(left.header.timestamp ?? "") || 0));
  }

  async readSession(sessionId: string): Promise<{ session: SessionQueryHeader; events: SessionQueryEventRecord[] }> {
    if (typeof sessionId !== "string" || !sessionId.trim()) throw new SessionQueryError("SESSION_QUERY_INVALID_QUERY", "session-query sessionId must be text");
    const session = (await this.listSessions()).find((entry) => entry.header.id === sessionId);
		if (!session) throw new SessionQueryError("SESSION_QUERY_SESSION_NOT_FOUND", `session not found: ${sessionId}`, { sessionId });
		return { session: queryHeader(session.header), events: await this.events(sessionId) };
	}

  async listEvents(sessionId: string): Promise<SessionQueryEventRecord[]> {
    const result = await this.readSession(sessionId);
    return result.events;
  }

  async readSurface(sessionId: string): Promise<SessionQuerySurfaceSnapshot> {
    const result = await this.readSession(sessionId);
    return {
      session: result.session,
      capturedThroughSeq: result.events.at(-1)?.seq ?? null,
      events: result.events.filter((event) => event.surface === "current"),
    };
  }

  async traceEvent(request: { sessionId: string; seq: number }): Promise<SessionQueryEventTrace> {
    if (!request || typeof request.sessionId !== "string" || !request.sessionId.trim() || !Number.isSafeInteger(request.seq) || request.seq < 0) {
      throw new SessionQueryError("SESSION_QUERY_INVALID_QUERY", "session-query traceEvent requires a sessionId and non-negative seq");
    }
    const result = await this.readSession(request.sessionId);
    const target = result.events.find((event) => event.seq === request.seq);
    if (!target) throw new SessionQueryError("SESSION_QUERY_EVENT_NOT_FOUND", `session "${request.sessionId}" has no event at seq ${request.seq}`, { sessionId: request.sessionId, seq: request.seq });
    const replacedBy = new Map<number, number>();
    for (const event of result.events) for (const source of event.replacedEventSeqs ?? []) replacedBy.set(source, event.seq);
    const replacementChain: number[] = [];
    const seen = new Set<number>();
    let next = replacedBy.get(request.seq);
    while (next !== undefined) {
      if (seen.has(next)) throw new SessionQueryError("SESSION_QUERY_INVALID_SURFACE", `replacement cycle detected at ${next}`);
      seen.add(next);
      replacementChain.push(next);
      next = replacedBy.get(next);
    }
    return {
      session: result.session,
      target,
      ...(replacedBy.has(request.seq) ? { replacedBy: replacedBy.get(request.seq) } : {}),
      replacementChain,
      replacedEventSeqs: target.replacedEventSeqs ?? [],
      sourceEventSeqs: target.sourceEventSeqs ?? [],
      derivedEventSeqs: result.events.filter((event) => event.seq > request.seq && (event.sourceEventSeqs ?? []).includes(request.seq)).map((event) => event.seq),
    };
  }

  async filterSessions(filters: readonly SessionQueryFilter[] = []): Promise<SessionQuerySessionRecord[]> {
    validateFilters(filters, "session");
    const rows = await this.listSessions();
    return rows.filter((row) => filters.every((filter) => queryFilterSession(row, filter)));
  }

  async filterEvents(sessionId: string, filters: readonly SessionQueryFilter[] = []): Promise<SessionQueryEventRecord[]> {
    validateFilters(filters, "event");
    return (await this.listEvents(sessionId)).filter((event) => filters.every((filter) => queryFilterEvent(event, filter)));
  }

  async searchSessions(request: SessionQueryRequest): Promise<{ items: Array<SessionQuerySessionRecord & { bestMatch?: SessionQueryEventRecord }>; nextCursor?: string }> {
    validateRequest(request);
    const query = searchableText(request.query);
    const workspaceIds = await this.workspaceSessionIds(request.workspaceId);
    const allowed = (await this.filterSessions(request.sessionFilters ?? [])).filter((session) => workspaceIds === undefined || workspaceIds.has(session.header.id));
    const eventFilters = request.eventFilters ?? [];
    const matched = await Promise.all(allowed.map(async (session) => {
			const events = await this.events(session.header.id);
			const matchingEvents = events.filter((event) => eventFilters.every((filter) => queryFilterEvent(event, filter)) && (!query || searchableText(event.text).includes(query)));
			const headerText = searchableText(session.header);
			if (query && !matchingEvents.length && !headerText.includes(query)) return undefined;
			return { ...session, ...(matchingEvents[0] ? { bestMatch: matchingEvents[0] } : {}) };
		}));
		const filtered = matched.filter((value): value is SessionQuerySessionRecord & { bestMatch?: SessionQueryEventRecord } => Boolean(value));
		const limit = validateLimit(request.limit);
		const queryFingerprint = requestFingerprint(request);
		const corpusFingerprint = cursorFingerprint(filtered);
		const offset = queryCursor(request.cursor, queryFingerprint, corpusFingerprint);
		return { items: filtered.slice(offset, offset + limit), nextCursor: nextQueryCursor(offset + limit, filtered.length, queryFingerprint, corpusFingerprint) };
  }

  async readTitle(sessionId: string): Promise<{ session: SessionQueryHeader; title?: string }> {
    const session = await this.readSession(sessionId);
    const titleEvent = [...session.events].reverse().find((event) => event.type === "session/summary" || event.type === "session_info_changed");
    const title = titleEvent ? queryText(titleEvent.payload && typeof titleEvent.payload === "object" ? (titleEvent.payload as Record<string, unknown>).title ?? (titleEvent.payload as Record<string, unknown>).name : undefined).trim() : "";
    return { session: session.session, ...(title ? { title } : {}) };
  }

  async traceSession(sessionId: string): Promise<SessionQueryLineageTrace> {
    const rows = await this.listSessions();
    const target = rows.find((row) => row.header.id === sessionId);
    if (!target) throw new SessionQueryError("SESSION_QUERY_SESSION_NOT_FOUND", `session not found: ${sessionId}`, { sessionId });
    const ancestors: SessionQuerySessionRecord[] = [];
    const ancestrySeen = new Set<string>([sessionId]);
    let parent = target.header.parentSessionId;
    while (parent) {
      if (ancestrySeen.has(parent)) {
        throw new SessionQueryError("SESSION_QUERY_INVALID_LINEAGE", `session lineage contains a cycle at ${parent}`, { sessionId, parentSessionId: parent });
      }
      ancestrySeen.add(parent);
      const record = rows.find((row) => row.header.id === parent);
      if (!record) return { target, ancestors, descendants: buildLineageDescendants(rows, sessionId), complete: false, unresolvedParentId: parent };
      ancestors.push(record);
      parent = record.header.parentSessionId;
    }
    return {
      target,
      ancestors,
      descendants: buildLineageDescendants(rows, sessionId),
      complete: true,
      root: ancestors.at(-1) ?? target,
    };
  }

  async searchEvents(request: SessionQueryRequest & { sessionId: string }): Promise<{ session: SessionQueryHeader; items: SessionQueryEventRecord[]; nextCursor?: string }> {
    validateRequest(request);
    const session = await this.readSession(request.sessionId);
		const workspaceIds = await this.workspaceSessionIds(request.workspaceId);
		if (workspaceIds !== undefined && !workspaceIds.has(request.sessionId)) {
			throw new SessionQueryError("SESSION_QUERY_SESSION_NOT_FOUND", `session is not in workspace: ${request.sessionId}`, { sessionId: request.sessionId, workspaceId: request.workspaceId });
		}
		const query = searchableText(request.query);
    const filters = request.eventFilters ?? [];
		const matched = session.events.filter((event) => filters.every((filter) => queryFilterEvent(event, filter)) && (!query || searchableText(event.text).includes(query)));
		const limit = validateLimit(request.limit);
		const queryFingerprint = requestFingerprint(request);
		const corpusFingerprint = cursorFingerprint(matched);
		const offset = queryCursor(request.cursor, queryFingerprint, corpusFingerprint);
		return { session: session.session, items: matched.slice(offset, offset + limit), nextCursor: nextQueryCursor(offset + limit, matched.length, queryFingerprint, corpusFingerprint) };
  }

	async readEvent(request: { sessionId: string; seq: number; before?: number; after?: number }): Promise<SessionQueryEventWindow> {
		if (typeof request?.sessionId !== "string" || !request.sessionId.trim()) {
			throw new SessionQueryError("SESSION_QUERY_INVALID_QUERY", "session-query sessionId must be text");
		}
		if (!Number.isSafeInteger(request.seq) || request.seq < 0) {
			throw new SessionQueryError("SESSION_QUERY_INVALID_QUERY", "session-query seq must be a non-negative integer");
		}
		const validateWindow = (name: "before" | "after", value: number | undefined): number => {
			if (value === undefined) return 0;
			if (!Number.isSafeInteger(value) || value < 0 || value > 50) {
				throw new SessionQueryError("SESSION_QUERY_INVALID_WINDOW", `${name} must be an integer between 0 and 50`, { name, value });
			}
			return value;
		};
		const before = validateWindow("before", request.before);
		const after = validateWindow("after", request.after);
		const result = await this.readSession(request.sessionId);
		const target = result.events[request.seq];
		if (!target || target.seq !== request.seq) {
			throw new SessionQueryError("SESSION_QUERY_EVENT_NOT_FOUND", `session "${request.sessionId}" has no event at seq ${request.seq}`, { sessionId: request.sessionId, seq: request.seq });
		}
		const startSeq = Math.max(0, request.seq - before);
		const endSeq = Math.min(result.events.length - 1, request.seq + after);
		return { session: result.session, target, events: result.events.slice(startSeq, endSeq + 1), startSeq, endSeq };
	}
}

export function deepSeekSessionQueryRemote() {
  return {
    package: "@deepseek-ai/dsh-session-query",
    descriptors: [
      { namespace: "sessionQuery", method: "listSessions", implementation: "listSessions", service: "sessionQuery" },
      { namespace: "sessionQuery", method: "readSession", implementation: "readSession", service: "sessionQuery", parameters: [{ name: "sessionId", wire: "sessionId" }] },
      { namespace: "sessionQuery", method: "listEvents", implementation: "listEvents", service: "sessionQuery", parameters: [{ name: "sessionId", wire: "sessionId" }] },
      { namespace: "sessionQuery", method: "readSurface", implementation: "readSurface", service: "sessionQuery", parameters: [{ name: "sessionId", wire: "sessionId" }] },
      { namespace: "sessionQuery", method: "filterSessions", implementation: "filterSessions", service: "sessionQuery", parameters: [{ name: "filters", wire: "filters", optional: true }] },
      { namespace: "sessionQuery", method: "filterEvents", implementation: "filterEvents", service: "sessionQuery", parameters: [{ name: "sessionId", wire: "sessionId" }, { name: "filters", wire: "filters", optional: true }] },
      { namespace: "sessionQuery", method: "searchSessions", implementation: "searchSessions", service: "sessionQuery", parameters: [{ name: "request", wire: "request" }] },
      { namespace: "sessionQuery", method: "searchEvents", implementation: "searchEvents", service: "sessionQuery", parameters: [{ name: "request", wire: "request" }] },
      { namespace: "sessionQuery", method: "readEvent", implementation: "readEvent", service: "sessionQuery", parameters: [{ name: "request", wire: "request" }] },
      { namespace: "sessionQuery", method: "traceEvent", implementation: "traceEvent", service: "sessionQuery", parameters: [{ name: "request", wire: "request" }] },
      { namespace: "sessionQuery", method: "readTitle", implementation: "readTitle", service: "sessionQuery", parameters: [{ name: "sessionId", wire: "sessionId" }] },
      { namespace: "sessionQuery", method: "traceSession", implementation: "traceSession", service: "sessionQuery", parameters: [{ name: "sessionId", wire: "sessionId" }] },
    ],
  };
}

export class DeepSeekAgentLoopService extends OpenBuddyService {
  static override provide = "agentLoop";
  static inject = ["agents", "llm"];
  private readonly factory: DeepSeekAgentFactory;
  private readonly releaseFactory: () => void;

  constructor(ctx: Context) {
    super(ctx, "agentLoop");
    const agents = ctx.get("agents") as DeepSeekAgentService | undefined;
    if (!agents) throw new Error("dsh-agent-loop: agent registry is unavailable");
    this.factory = createPiAgentFactory(ctx);
    this.releaseFactory = agents.setFactory(this.factory);
    ctx.effect(() => async () => {
      this.releaseFactory();
      await this.factory.dispose();
    }, "dsh-agent-loop.dispose()");
  }

  async create(options: DeepSeekAgentCreateOptions): Promise<DeepSeekAgentHandle> {
    return this.factory.createAgent(this.ctx, options);
  }

  async resume(options: DeepSeekAgentResumeOptions): Promise<DeepSeekAgentHandle> {
    return this.factory.resume(this.ctx, options);
  }

  async prompt(text: string, sessionId?: string): Promise<void> {
    const agents = this.ctx.get("agents") as DeepSeekAgentService | undefined;
    const session = agents?.get(sessionId);
    if (session) return session.prompt(text);
    const host = this.ctx.get("agentHost") as AgentHostRuntime | undefined;
    if (!host) throw new Error("dsh-agent-loop: Pi host is unavailable");
    return host.prompt(text);
  }

  async steer(text: string, sessionId?: string): Promise<void> {
    const session = (this.ctx.get("agents") as DeepSeekAgentService | undefined)?.get(sessionId);
    if (session) return session.steer(text);
    const host = this.ctx.get("agentHost") as AgentHostRuntime | undefined;
    if (!host?.steer) throw new Error("dsh-agent-loop: steer is unavailable");
    return host.steer(text);
  }

  async followUp(text: string, sessionId?: string): Promise<void> {
    const session = (this.ctx.get("agents") as DeepSeekAgentService | undefined)?.get(sessionId);
    if (session) return session.followUp(text);
    const host = this.ctx.get("agentHost") as AgentHostRuntime | undefined;
    if (!host?.followUp) throw new Error("dsh-agent-loop: follow-up is unavailable");
    return host.followUp(text);
  }

  async abort(sessionId?: string): Promise<void> {
    const session = (this.ctx.get("agents") as DeepSeekAgentService | undefined)?.get(sessionId);
    if (session) return session.abort();
    return (this.ctx.get("agentHost") as AgentHostRuntime).abort();
  }
}

export class DeepSeekAgentDefaultModelService extends OpenBuddyService {
  static override provide = "agentDefaultModel";
  static inject = ["llm"];
  readonly config: unknown;
  private readonly settingsScope?: { get: () => unknown; replace: (value: unknown) => Promise<void> };

  constructor(ctx: Context, config?: unknown) {
    super(ctx, "agentDefaultModel");
    this.config = config;
    const settings = ctx.get("settings") as { register?: (namespace: string, schema: unknown, options?: { base?: Record<string, unknown> }) => { get: () => unknown; replace: (value: unknown) => Promise<void> } } | undefined;
    this.settingsScope = settings?.register?.("agent-default-model", (value: unknown) => value, {
      base: config && typeof config === "object" ? config as Record<string, unknown> : {},
    });
  }

  get(): unknown {
    return this.settingsScope?.get() ?? this.config;
  }

  async saveSelection(next: unknown): Promise<void> {
    if (this.settingsScope) await this.settingsScope.replace(next);
  }
}

export type DeepSeekWorkspaceId = string & { readonly __brand: "WorkspaceId" };

export class WorkspaceUnknownSessionError extends Error {
  readonly code = "session-not-found" as const;

  constructor(readonly sessionId: string) {
    super(`cannot archive session '${sessionId}': live sessions and session persistence hold no such session`);
    this.name = "WorkspaceUnknownSessionError";
  }
}

export class WorkspaceOrderInvalidError extends Error {
  readonly code = "workspace-not-found" as const;

  constructor(readonly workspaceId: DeepSeekWorkspaceId) {
    super(`cannot reorder unknown workspace '${workspaceId}'`);
    this.name = "WorkspaceOrderInvalidError";
  }
}

export class WorkspaceMoveInvalidError extends Error {
  readonly code = "workspace-move-invalid" as const;

  constructor(message: string) {
    super(message);
    this.name = "WorkspaceMoveInvalidError";
  }
}

export class WorkspaceInvalidPathError extends Error {
  readonly code = "workspace-invalid-path" as const;

  constructor(readonly path: string, cause?: unknown) {
    super(`cannot create a workspace at "${path}": ${cause instanceof Error ? cause.message : String(cause ?? "path is not a directory")}`);
    this.name = "WorkspaceInvalidPathError";
  }
}

export class WorkspaceNameConflictError extends Error {
  readonly code = "workspace-name-conflict" as const;

  constructor(readonly workspaceName: string) {
    super(`workspace name '${workspaceName}' is already in use`);
    this.name = "WorkspaceNameConflictError";
  }
}

export class WorkspaceTitleInvalidError extends Error {
  readonly code = "bad-request" as const;

  constructor() {
    super("workspace title must be a non-empty string");
    this.name = "WorkspaceTitleInvalidError";
  }
}

export interface DeepSeekWorkspace {
  readonly id: DeepSeekWorkspaceId;
  readonly path: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sessionIds: readonly string[];
  setTitle(title: string): Promise<void>;
  attachSession(sessionId: string): Promise<void>;
  insertSessionBefore(sessionId: string, beforeSessionId?: string): Promise<void>;
  detachSession(sessionId: string): Promise<void>;
  status(): Promise<"ok" | "missing-dir">;
}

type WorkspaceRecord = {
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
};

type WorkspaceDocument = {
  order: string[];
  records: Record<string, WorkspaceRecord>;
  archivedSessionIds: string[];
};

function workspaceStorePath(): string {
  const root = process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? process.env.HOME ?? process.cwd(), ".pi", "agent");
  return join(root, "dsh-workspaces.json");
}

function workspaceId(value: string): DeepSeekWorkspaceId {
  return value as DeepSeekWorkspaceId;
}

function workspaceTitle(pathValue: string, title?: string): string {
  if (title !== undefined) {
    const normalized = title.trim();
    if (!normalized) throw new WorkspaceTitleInvalidError();
    return normalized;
  }
  const normalized = pathValue.replace(/[\\/]$/u, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  // When the path has no segments (root "/", "") fall back to the original
  // path or a stable default so the stored title is never empty. A previous
  // version returned "" here, which silently persisted as the workspace
  // title and then exploded on the next `registry.update()` because
  // `workspaceTitle(path, "")` throws WorkspaceTitleInvalidError.
  const derived = normalized.slice(separator + 1);
  return derived || normalized || pathValue || "/";
}

class DeepSeekWorkspaceEntity implements DeepSeekWorkspace {
  constructor(private readonly registry: DeepSeekWorkspaceRegistryService, readonly id: DeepSeekWorkspaceId, private record: WorkspaceRecord) {}

  get path(): string { return this.record.path; }
  get title(): string { return this.record.title; }
  get createdAt(): string { return this.record.createdAt; }
  get updatedAt(): string { return this.record.updatedAt; }
  get sessionIds(): readonly string[] { return [...this.record.sessionIds]; }

  async setTitle(title: string): Promise<void> {
    await this.registry.update(this.id, { ...this.record, title: workspaceTitle(this.path, title) });
  }

  async attachSession(sessionId: string): Promise<void> {
    if (this.record.sessionIds.includes(sessionId)) return;
    const host = this.registry.contextHost();
    const header = await host.readSessionHeader(sessionId);
    if (!header.cwd || (await realpath(header.cwd)) !== this.path) {
      throw new WorkspaceMoveInvalidError(`cannot attach session '${sessionId}' to workspace '${this.path}': its cwd does not match the workspace`);
    }
    await this.registry.update(this.id, { ...this.record, sessionIds: [sessionId, ...this.record.sessionIds] });
  }

  async insertSessionBefore(sessionId: string, beforeSessionId?: string): Promise<void> {
    if (!this.record.sessionIds.includes(sessionId)) throw new WorkspaceMoveInvalidError(`cannot move session '${sessionId}' in workspace '${this.path}': the session is not accounted`);
    if (beforeSessionId !== undefined && !this.record.sessionIds.includes(beforeSessionId)) throw new WorkspaceMoveInvalidError(`cannot move session '${sessionId}' before '${beforeSessionId}' in workspace '${this.path}': the anchor is not accounted`);
    if (beforeSessionId === sessionId) return;
    const remaining = this.record.sessionIds.filter((id) => id !== sessionId);
    const index = beforeSessionId === undefined ? remaining.length : remaining.indexOf(beforeSessionId);
    await this.registry.update(this.id, { ...this.record, sessionIds: [...remaining.slice(0, index), sessionId, ...remaining.slice(index)] });
  }

  async detachSession(sessionId: string): Promise<void> {
    await this.registry.update(this.id, { ...this.record, sessionIds: this.record.sessionIds.filter((id) => id !== sessionId) });
  }

  async status(): Promise<"ok" | "missing-dir"> {
    try {
      return (await stat(this.path)).isDirectory() ? "ok" : "missing-dir";
    } catch {
      return "missing-dir";
    }
  }

  replace(record: WorkspaceRecord): void { this.record = record; }
}

export class DeepSeekWorkspaceRegistryService extends OpenBuddyService {
  static override provide = "workspaceRegistry";
  private readonly entities = new Map<DeepSeekWorkspaceId, DeepSeekWorkspaceEntity>();
	private document: WorkspaceDocument = { order: [], records: {}, archivedSessionIds: [] };
	private loaded?: Promise<void>;
	private writeTail: Promise<void> = Promise.resolve();
	private revision = 0;

  contextHost(): { readSessionHeader: (sessionId: string) => Promise<{ cwd?: string }> } {
    const host = this.ctx.get("agentHost") as AgentHostRuntime | undefined;
    return {
      readSessionHeader: async (sessionId) => {
        if (host?.readSessionHeader) return host.readSessionHeader(sessionId);
        if (host?.listSessionHeaders) {
          const header = (await host.listSessionHeaders()).find((entry) => entry.id === sessionId);
          if (header) return header;
          throw new WorkspaceMoveInvalidError(`cannot attach unknown session '${sessionId}'`);
        }
        const rows = host?.listAllSessions ? await host.listAllSessions() : [];
        const info = rows.find((entry) => entry && typeof entry === "object" && ((entry as { sessionId?: unknown }).sessionId === sessionId || (entry as { id?: unknown }).id === sessionId)) as { cwd?: string } | undefined;
        if (!info) throw new WorkspaceMoveInvalidError(`cannot attach unknown session '${sessionId}'`);
        return { cwd: info.cwd };
      },
    };
  }

  constructor(ctx: Context) {
    super(ctx, "workspaceRegistry");
    this.loaded = this.load();
  }

  private async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(workspaceStorePath(), "utf8")) as Partial<WorkspaceDocument>;
      const records = parsed.records && typeof parsed.records === "object" ? parsed.records : {};
      const order = Array.isArray(parsed.order) ? parsed.order.filter((id): id is string => typeof id === "string" && Boolean(records[id])) : Object.keys(records);
		this.document = {
        order,
        records: records as Record<string, WorkspaceRecord>,
        archivedSessionIds: Array.isArray(parsed.archivedSessionIds)
          ? parsed.archivedSessionIds.filter((id): id is string => typeof id === "string")
          : [],
		};
		this.revision = 1;
      for (const id of order) {
        const stored = this.document.records[id]!;
        // Normalize legacy / corrupted empty titles on load. A previous build
        // allowed `workspaceTitle("/")` to return "" which got persisted as
        // the workspace title; subsequent `registry.update()` then threw
        // WorkspaceTitleInvalidError because title was explicit-empty.
        const normalizedTitle = typeof stored.title === "string" && stored.title.trim()
          ? stored.title
          : workspaceTitle(stored.path);
        const normalized: WorkspaceRecord = { ...stored, title: normalizedTitle };
        this.document.records[id] = normalized;
        this.entities.set(workspaceId(id), new DeepSeekWorkspaceEntity(this, workspaceId(id), normalized));
      }
    } catch {
      this.document = { order: [], records: {}, archivedSessionIds: [] };
    }
  }

	async ready(): Promise<void> { await this.loaded; }

	async authorizeSessionQueryWorkspace(id: string): Promise<WorkspaceAuthorizationSnapshot> {
		await this.ready();
		const entity = this.entities.get(workspaceId(id));
		if (!entity) throw new SessionQueryError("SESSION_QUERY_WORKSPACE_NOT_FOUND", `workspace not found: ${id}`, { workspaceId: id });
		return Object.freeze({
			workspaceId: id,
			revision: this.revision,
			sessionIds: Object.freeze([...entity.sessionIds]),
		});
	}

  private async persist(): Promise<void> {
    const value = JSON.stringify(this.document, null, 2) + "\n";
    const filename = workspaceStorePath();
    await mkdir(dirname(filename), { recursive: true });
    const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, filename);
  }

	async update(id: DeepSeekWorkspaceId, record: WorkspaceRecord): Promise<void> {
    await this.ready();
    const entity = this.entities.get(id);
    if (!entity) throw new Error(`dsh-workspace: unknown workspace '${id}'`);
    const title = workspaceTitle(record.path, record.title);
    if ([...this.entities.values()].some((other) => other.id !== id && other.title === title)) {
      throw new WorkspaceNameConflictError(title);
    }
    const next = { ...record, title, updatedAt: new Date().toISOString() };
		this.document.records[id] = next;
		entity.replace(next);
		this.revision += 1;
    this.writeTail = this.writeTail.then(() => this.persist());
    await this.writeTail;
    this.ctx.emit("workspace/changed", { workspaceId: id, kind: "updated" });
  }

  async create(pathValue: string, title?: string): Promise<DeepSeekWorkspace> {
    await this.ready();
    let canonical: string;
    try {
      canonical = await realpath(pathValue);
      if (!(await stat(canonical)).isDirectory()) throw new Error("path is not a directory");
    } catch (error) {
      throw new WorkspaceInvalidPathError(pathValue, error);
    }
    const existing = [...this.entities.values()].find((entity) => entity.path === canonical);
    if (existing) return existing;
    const id = workspaceId(randomUUID());
    const now = new Date().toISOString();
    const entity = new DeepSeekWorkspaceEntity(this, id, { path: canonical, title: workspaceTitle(canonical, title), sessionIds: [], createdAt: now, updatedAt: now });
		this.entities.set(id, entity);
    this.document.records[id] = { path: entity.path, title: entity.title, sessionIds: [], createdAt: now, updatedAt: now };
		this.document.order = [id, ...this.document.order];
		this.revision += 1;
    this.writeTail = this.writeTail.then(() => this.persist());
    await this.writeTail;
    this.ctx.emit("workspace/changed", { workspaceId: id, kind: "created" });
    return entity;
  }

  get(id: DeepSeekWorkspaceId): DeepSeekWorkspace | undefined { return this.entities.get(id); }
  list(): DeepSeekWorkspace[] { return this.document.order.map((id) => this.entities.get(workspaceId(id))).filter((entity): entity is DeepSeekWorkspaceEntity => Boolean(entity)); }

  async insertBefore(id: DeepSeekWorkspaceId, beforeId?: DeepSeekWorkspaceId): Promise<DeepSeekWorkspaceId[]> {
    await this.ready();
    if (!this.entities.has(id)) throw new WorkspaceOrderInvalidError(id);
    if (beforeId !== undefined && !this.entities.has(beforeId)) throw new WorkspaceOrderInvalidError(beforeId);
    if (beforeId === id) return this.document.order.map(workspaceId);
    const remaining = this.document.order.filter((entry) => entry !== id);
    const index = beforeId === undefined ? remaining.length : remaining.indexOf(beforeId);
    this.document.order = [...remaining.slice(0, index), id, ...remaining.slice(index)];
    this.writeTail = this.writeTail.then(() => this.persist());
    await this.writeTail;
    this.ctx.emit("workspace/changed", { workspaceId: id, kind: "reordered", workspaceIds: this.document.order.map(String) });
    return this.document.order.map(workspaceId);
  }

  get archivedSessionIds(): readonly string[] { return [...this.document.archivedSessionIds]; }

  async archiveSession(sessionId: string, archived = true): Promise<readonly string[]> {
    await this.ready();
    const host = this.ctx.get("agentHost") as AgentHostRuntime | undefined;
    if (archived && (host?.listSessionHeaders || host?.listAllSessions || host?.listSessions)) {
      const known = host.listSessionHeaders
        ? await host.listSessionHeaders()
        : host.listAllSessions
          ? await host.listAllSessions()
          : await host.listSessions!(process.cwd());
      if (!known.some((entry) => entry && typeof entry === "object" && ((entry as { sessionId?: unknown }).sessionId === sessionId || (entry as { id?: unknown }).id === sessionId))) {
        throw new WorkspaceUnknownSessionError(sessionId);
      }
    }
    const next = new Set(this.document.archivedSessionIds);
    if (archived) next.add(sessionId);
    else next.delete(sessionId);
    this.document.archivedSessionIds = [...next];
    this.writeTail = this.writeTail.then(() => this.persist());
    await this.writeTail;
    this.ctx.emit("workspace/changed", { kind: "archive-changed", sessionId, archived });
    return this.archivedSessionIds;
  }

  async resolveByPath(pathValue: string): Promise<DeepSeekWorkspace | undefined> {
    await this.ready();
    const canonical = await realpath(pathValue);
    return this.list().find((entity) => entity.path === canonical);
  }

  async delete(id: DeepSeekWorkspaceId): Promise<boolean> {
    await this.ready();
    if (!this.entities.delete(id)) return false;
    delete this.document.records[id];
    this.document.order = this.document.order.filter((entry) => entry !== id);
    this.writeTail = this.writeTail.then(() => this.persist());
    await this.writeTail;
    this.ctx.emit("workspace/changed", { workspaceId: id, kind: "deleted" });
    return true;
  }
}

export const deepSeekRuntimeAliases: Record<string, unknown> = {
  "@deepseek-ai/dsh-llm": { default: DeepSeekLlmService, LlmRuntime: DeepSeekLlmService },
  "@deepseek-ai/dsh-session": {
    default: DeepSeekSessionService,
    Session: DeepSeekHarnessSession,
    SessionPreparation: DeepSeekSessionPreparation,
    SessionStore: DeepSeekSessionService,
  },
  "@deepseek-ai/dsh-agent": { default: DeepSeekAgentService, AgentRegistry: DeepSeekAgentService },
  "@deepseek-ai/dsh-typert-registry": { default: DeepSeekTypertService, TypertRegistry: DeepSeekTypertService },
  "@deepseek-ai/dsh-typert-loader": { default: DeepSeekTypertLoaderService, TypertLoader: DeepSeekTypertLoaderService },
  "@deepseek-ai/dsh-session-persistence-jsonl": { default: DeepSeekPersistenceService, SessionPersistence: DeepSeekPersistenceService },
  "@deepseek-ai/dsh-session-query": { default: DeepSeekSessionQueryService, SessionQueryEngine: DeepSeekSessionQueryService },
  "@deepseek-ai/dsh-session-query/invariant": { name: "session-query-invariant", inject: ["sessionQuery"], apply: () => undefined },
  "@deepseek-ai/dsh-agent-loop": {
    default: DeepSeekAgentLoopService,
    AgentLoop: DeepSeekAgentLoopService,
    createPiAgentLoopPlugin: createDeepSeekPiAgentLoopPlugin,
  },
  "@deepseek-ai/dsh-agent-default-model": { default: DeepSeekAgentDefaultModelService, AgentDefaultModel: DeepSeekAgentDefaultModelService },
  "@deepseek-ai/dsh-workspace": {
    default: DeepSeekWorkspaceRegistryService,
    WorkspaceRegistry: DeepSeekWorkspaceRegistryService,
    WorkspaceId: workspaceId,
    WorkspaceUnknownSessionError,
    WorkspaceOrderInvalidError,
    WorkspaceMoveInvalidError,
    WorkspaceInvalidPathError,
    WorkspaceNameConflictError,
    WorkspaceTitleInvalidError,
  },
  "@deepseek-ai/dsh-api-gateway": { default: DeepSeekTypertGatewayService, TypertGatewayService: DeepSeekTypertGatewayService },
  "@deepseek-ai/dsh-client-connection": { default: DeepSeekHostConnectionService, HostConnectionService: DeepSeekHostConnectionService },
};

export function resolveDeepSeekRuntimeModule(specifier: string): unknown | undefined {
  return deepSeekRuntimeAliases[specifier];
}

export const deepSeekRuntimePlugins: Record<string, HarnessPlugin> = Object.fromEntries(
  Object.entries(deepSeekRuntimeAliases).map(([name, module]) => [name, module as HarnessPlugin]),
);
