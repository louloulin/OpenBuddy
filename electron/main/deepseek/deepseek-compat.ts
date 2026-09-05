import * as OpenBuddyCordis from "@openbuddy/cordis";
import { OpenBuddyService } from "@openbuddy/cordis";
import { stat } from "node:fs/promises";
import { watch } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  createIncludePlugin,
  type HarnessPlugin,
} from "@openbuddy/plugin-host";
import { resolveDeepSeekRuntimeModule } from "./deepseek-runtime";
import {
  deepSeekCapabilityDefinitions,
  deepSeekCapabilityModule,
  deepSeekCapabilityRemote,
  deepSeekCapabilitySubmodule,
} from "./deepseek-capabilities";
import { resolveDeepSeekGenericModule } from "./deepseek-generic";
import { DeepSeekSessionQueryService } from "./deepseek-runtime";
import { registerHookConfig } from "../agent/agent-hooks";

type RemoteInvocation = { kind: "direct" } | { kind: "context"; context: string };
type RemoteMarker = { method: string; exportName?: string; invocation: RemoteInvocation };
const remoteMarkers = new WeakMap<object, Map<string, RemoteMarker>>();

function validateRemoteName(value: string, label: string): void {
  if (!/^[A-Za-z0-9_$.-]+$/.test(value) || value === "." || value === "..") throw new TypeError(`dsh-typert: ${label} is invalid`);
}

function markRemote(prototype: object, method: string, invocation: RemoteInvocation, exportName?: string): void {
  const markers = remoteMarkers.get(prototype) ?? new Map<string, RemoteMarker>();
  const existing = markers.get(method);
  const marker = { method, ...(exportName && exportName !== method ? { exportName } : {}), invocation };
  if (existing && JSON.stringify(existing) !== JSON.stringify(marker)) throw new Error(`dsh-typert: conflicting Remote marker for ${method}`);
  markers.set(method, marker);
  remoteMarkers.set(prototype, markers);
}

function remoteDecorator(exportNameOrMethod?: string | Function, decoratorContext?: ClassMethodDecoratorContext): void | ((method: Function, context: ClassMethodDecoratorContext) => void) {
  if (typeof exportNameOrMethod === "string") {
    validateRemoteName(exportNameOrMethod, "Remote export name");
    return (_method, context) => {
      if (typeof context.name !== "string") throw new TypeError("dsh-typert: Remote method must be named");
      context.addInitializer(function () { markRemote(Object.getPrototypeOf(this), context.name as string, { kind: "direct" }, exportNameOrMethod); });
    };
  }
  if (!decoratorContext || typeof decoratorContext.name !== "string") throw new TypeError("dsh-typert: Remote decorator context is missing");
  decoratorContext.addInitializer(function () { markRemote(Object.getPrototypeOf(this), decoratorContext.name as string, { kind: "direct" }); });
}

const DeepSeekTypertProtocol = {
  Remote: remoteDecorator,
  RemoteScope: (contextName: string, exportName?: string) => {
    validateRemoteName(contextName, "Remote scope");
    if (exportName) validateRemoteName(exportName, "Remote export name");
    return (_method: Function, context: ClassMethodDecoratorContext) => {
      if (typeof context.name !== "string") throw new TypeError("dsh-typert: Remote method must be named");
      context.addInitializer(function () { markRemote(Object.getPrototypeOf(this), context.name as string, { kind: "context", context: contextName }, exportName); });
    };
  },
  bindTypertRemote: (service: object, serviceKey: string, options: { namespace?: string } = {}) => Object.freeze({ service, serviceKey, namespace: options.namespace ?? serviceKey }),
  remoteMethods: (service: object): RemoteMarker[] => {
    return getDeepSeekRemoteMethods(service);
  },
  TypertRemoteService: class TypertRemoteService extends OpenBuddyService {
    readonly typertRemote: { service: object; serviceKey: string; namespace: string };
    constructor(ctx: OpenBuddyCordis.Context, serviceKey: string, options: { namespace?: string } = {}) {
      super(ctx, serviceKey);
      this.typertRemote = Object.freeze({ service: this, serviceKey, namespace: options.namespace ?? serviceKey });
    }
  },
};

export function getDeepSeekRemoteMethods(service: object): RemoteMarker[] {
  const result: RemoteMarker[] = [];
  for (let prototype = Object.getPrototypeOf(service); prototype && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
    for (const marker of remoteMarkers.get(prototype)?.values() ?? []) {
      if (!result.some((entry) => entry.method === marker.method)) result.push({ ...marker });
    }
  }
  return result;
}

const DeepSeekApiRemotesPlugin: HarnessPlugin = {
  name: "@deepseek-ai/dsh-api-remotes",
  apply: () => undefined,
};

type DeepSeekHookBridgeConfig = {
  configPath?: string;
  hooks?: unknown;
  config?: unknown;
  pluginRoot?: string;
  defaultTimeoutMs?: number;
  stderrSummaryMaxChars?: number;
};

function deepSeekHookBridge(name: string, dialect: "claude-code" | "codex"): HarnessPlugin {
  return {
    name,
    apply: (ctx, rawConfig) => {
      const config = rawConfig && typeof rawConfig === "object" ? rawConfig as DeepSeekHookBridgeConfig : {};
      const configuredPath = typeof config.configPath === "string" ? config.configPath : undefined;
      const absoluteConfigPath = configuredPath
        ? isAbsolute(configuredPath) ? resolve(configuredPath) : resolve(process.cwd(), configuredPath)
        : undefined;
      const packageRoot = typeof config.pluginRoot === "string"
        ? resolve(config.pluginRoot)
        : absoluteConfigPath ? dirname(absoluteConfigPath) : process.cwd();
      const unregister = registerHookConfig({
        packageName: name,
        packageRoot,
        dialect,
        ...(absoluteConfigPath ? { configPath: absoluteConfigPath } : {}),
        ...(config.hooks !== undefined ? { config: config.hooks } : config.config !== undefined ? { config: config.config } : {}),
        ...(config.defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs: config.defaultTimeoutMs }),
        ...(config.stderrSummaryMaxChars === undefined ? {} : { stderrSummaryMaxChars: config.stderrSummaryMaxChars }),
      });
      ctx.effect(() => unregister, `${name}: hook registry`);
    },
  };
}

const DeepSeekClaudeCodeHooksPlugin = deepSeekHookBridge("@deepseek-ai/dsh-hooks-claude-code", "claude-code");
const DeepSeekCodexHooksPlugin = deepSeekHookBridge("@deepseek-ai/dsh-hooks-codex", "codex");

const DeepSeekCapabilityAliases: Record<string, unknown> = Object.fromEntries(
  deepSeekCapabilityDefinitions.map((definition) => [
    definition.packageName,
    deepSeekCapabilityModule(definition.packageName),
  ]),
);

/**
 * Small runtime facades for the two Cordis packages that DSH profiles put in
 * almost every config tree. OpenBuddy already owns the lifecycle and loader;
 * these facades translate the public DSH entry points instead of starting a
 * second Cordis tree inside Electron.
 */
const DeepSeekLoaderPlugin: HarnessPlugin = {
  name: "@deepseek-ai/cordis-plugin-loader",
  provide: "loader",
  apply(ctx) {
    const loader = ctx.get("pluginLoader");
    if (loader !== undefined && ctx.get("loader") === undefined) ctx.provide("loader", loader);
  },
};

const DeepSeekIncludePlugin: HarnessPlugin = createIncludePlugin();

type DisposableFunction<F extends (...args: any[]) => any> = F & { dispose: () => void };

class DeepSeekTimerService extends OpenBuddyService {
  static override provide = "timer";

  constructor(ctx: OpenBuddyCordis.Context) {
    super(ctx, "timer");
    (ctx as unknown as { mixin: (name: string, mixins: readonly string[]) => void }).mixin("timer", ["timeout", "interval", "throttle", "debounce", "setTimeout", "setInterval"]);
  }

  setTimeout(callback: () => void, delay: number): () => void {
    return this.timeout(callback, delay);
  }

  setInterval(callback: () => void, delay: number): () => void {
    return this.interval(callback, delay);
  }

  timeout(callback: () => void, delay: number): () => void;
  timeout(delay: number): Promise<void>;
  timeout(callbackOrDelay: (() => void) | number, maybeDelay?: number): (() => void) | Promise<void> {
    if (typeof callbackOrDelay === "function") {
      let dispose: (() => void) | undefined;
      dispose = this.ctx.effect(() => {
        const timer = setTimeout(() => {
          dispose?.();
          callbackOrDelay();
        }, Math.max(0, maybeDelay ?? 0));
        return () => clearTimeout(timer);
      }, "ctx.timeout()");
      return dispose;
    }
    let settle: (() => void) | undefined;
    let reject: ((error: Error) => void) | undefined;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      settle = resolvePromise;
      reject = rejectPromise;
    });
    const dispose = this.ctx.effect(() => {
      const timer = setTimeout(() => {
        settle?.();
        dispose();
      }, Math.max(0, callbackOrDelay));
      return () => {
        clearTimeout(timer);
        reject?.(new Error("Context has been disposed"));
      };
    }, "ctx.timeout()");
    return promise;
  }

  interval(callback: () => void, delay: number): () => void;
  interval(delay: number): AsyncIterableIterator<void>;
  interval(callbackOrDelay: (() => void) | number, maybeDelay?: number): (() => void) | AsyncIterableIterator<void> {
    if (typeof callbackOrDelay === "function") {
      const dispose = this.ctx.effect(() => {
        const timer = setInterval(callbackOrDelay, Math.max(1, maybeDelay ?? 1));
        return () => clearInterval(timer);
      }, "ctx.interval()");
      return dispose;
    }
    let done = false;
    let waiter: ((result: IteratorResult<void>) => void) | undefined;
    const dispose = this.ctx.effect(() => {
      const timer = setInterval(() => waiter?.({ done: false, value: undefined }), Math.max(1, callbackOrDelay));
      return () => {
        clearInterval(timer);
        done = true;
        waiter?.({ done: true, value: undefined });
        waiter = undefined;
      };
    }, "ctx.interval()");
    return {
      next: () => done ? Promise.resolve({ done: true, value: undefined }) : new Promise((resolveNext) => { waiter = resolveNext; }),
      return: () => { dispose(); return Promise.resolve({ done: true, value: undefined }); },
      throw: (error: unknown) => { dispose(); return Promise.reject(error); },
      [Symbol.asyncIterator]() { return this; },
    } as AsyncIterableIterator<void>;
  }

  throttle<F extends (...args: any[]) => void>(callback: F, delay: number, noTrailing = false): DisposableFunction<F> {
    let lastCall = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const execute = (...args: Parameters<F>) => { lastCall = Date.now(); callback(...args); };
    const wrapper = ((...args: Parameters<F>) => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      const remaining = delay - Date.now() + lastCall;
      if (remaining <= 0) execute(...args);
      else if (!noTrailing) timer = setTimeout(() => execute(...args), remaining);
    }) as DisposableFunction<F>;
    wrapper.dispose = () => { disposed = true; if (timer) clearTimeout(timer); };
    this.ctx.effect(() => wrapper.dispose, "ctx.throttle()");
    return wrapper;
  }

  debounce<F extends (...args: any[]) => void>(callback: F, delay: number): DisposableFunction<F> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const wrapper = ((...args: Parameters<F>) => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => callback(...args), Math.max(0, delay));
    }) as DisposableFunction<F>;
    wrapper.dispose = () => { disposed = true; if (timer) clearTimeout(timer); };
    this.ctx.effect(() => wrapper.dispose, "ctx.debounce()");
    return wrapper;
  }
}

const DeepSeekGroupPlugin: HarnessPlugin = {
  name: "@deepseek-ai/cordis-plugin-group",
  inject: ["loader"],
  async apply(ctx, config) {
    const loader = ctx.get("loader") as { loadScoped?: (entries: readonly { id: string; name: string; [key: string]: unknown }[], parent: OpenBuddyCordis.Context) => Promise<void>; load(entries: readonly { id: string; name: string; [key: string]: unknown }[]): Promise<void>; remove(id: string): Promise<void> };
    const parentId = String((ctx as unknown as { fiber?: { entry?: { id?: string } } }).fiber?.entry?.id ?? "group");
    const entries = Array.isArray(config) ? config : ((config as { entries?: unknown } | undefined)?.entries ?? []);
    if (!Array.isArray(entries)) throw new Error("deepseek-compat: group config must be an entry list");
    const children = entries.map((entry) => {
      if (!entry || typeof entry !== "object" || typeof (entry as { id?: unknown }).id !== "string" || typeof (entry as { name?: unknown }).name !== "string") {
        throw new Error("deepseek-compat: group child requires id and name");
      }
      const child = entry as { id: string; name: string; [key: string]: unknown };
      return { ...child, id: `${parentId}:${child.id}` };
    });
    if (loader.loadScoped) await loader.loadScoped(children, ctx);
    else await loader.load(children);
    return async () => {
      for (const child of children.slice().reverse()) await loader.remove(child.id);
    };
  },
};

class DeepSeekHmrService extends OpenBuddyService {
  static override provide = "hmr";
  private readonly watchers = new Set<() => void>();

  constructor(ctx: OpenBuddyCordis.Context, config?: { base?: string }) {
    super(ctx, "hmr");
    const baseDir = resolve(config?.base ?? ".");
    ctx.provide("hmr", this);
    ctx.effect(() => () => this.dispose(), "hmr.dispose()");
    void baseDir;
  }

  async registerConfig(filename: string, refresh: () => Promise<void> | void): Promise<() => Promise<void>> {
    const target = resolve(filename);
    try {
      await stat(target);
    } catch {
      throw new Error(`deepseek-compat: hmr target does not exist: ${target}`);
    }
    const watcher = watch(target, { persistent: false }, (event) => {
      if (event === "change") void Promise.resolve(refresh());
    });
    let active = true;
    const dispose = async () => {
      if (!active) return;
      active = false;
      this.watchers.delete(dispose);
      watcher.close();
    };
    this.watchers.add(dispose);
    return dispose;
  }

  private dispose(): void {
    for (const dispose of [...this.watchers]) void dispose();
    this.watchers.clear();
  }
}

const DeepSeekCosmokitCompatibility = {
  defineProperty(target: object, key: PropertyKey, value: PropertyDescriptor | unknown) {
    Object.defineProperty(target, key, typeof value === "object" && value !== null ? value : { value });
    return target;
  },
  isNullable: (value: unknown): value is null | undefined => value === null || value === undefined,
  isNonNullable: <T>(value: T): value is NonNullable<T> => value !== null && value !== undefined,
};

const deepSeekSessionTypes = {
  SessionId: (value: string) => value,
  SESSION_FORMAT_VERSION: 0,
};

const deepSeekSessionSurface = {
  isSurfaceEligibleType: (type: string) => ["user/message", "assistant/message", "tool/result"].includes(type),
  isSurfaceEvent: (event: unknown) => Boolean(
    event && typeof event === "object"
      && deepSeekSessionSurface.isSurfaceEligibleType(String((event as { type?: unknown }).type ?? ""))
      && "surfaceOp" in event,
  ),
  deriveEventMessage: (event: unknown) => {
    if (!event || typeof event !== "object") return null;
    const value = event as { type?: unknown; data?: unknown };
    if (value.type === "user/message") return value.data ?? null;
    if (value.type === "assistant/message" || value.type === "tool/result") {
      const data = value.data && typeof value.data === "object" ? value.data as { message?: unknown } : undefined;
      if (value.type === "assistant/message" && data?.message && typeof data.message === "object") {
        const content = (data.message as { content?: unknown }).content;
        if (Array.isArray(content) && content.length === 0) return null;
        if (typeof content === "string" && content.length === 0) return null;
      }
      return data?.message ?? null;
    }
    return null;
  },
  foldSurface: (events: readonly unknown[]) => {
    const nodes: number[] = [];
    const replacements: Array<{ seq: number; start: number; end: number; shadowedSeqs: number[] }> = [];
    for (const event of events) {
      if (!deepSeekSessionSurface.isSurfaceEvent(event)) continue;
      const value = event as { seq?: unknown; surfaceOp?: unknown };
      if (typeof value.seq !== "number" || !Number.isSafeInteger(value.seq) || value.seq < 0) continue;
      if (value.surfaceOp === "append") {
        nodes.push(value.seq);
        continue;
      }
      if (!value.surfaceOp || typeof value.surfaceOp !== "object") continue;
      const operation = value.surfaceOp as { op?: unknown; start?: unknown; end?: unknown };
      if (operation.op !== "replace" || typeof operation.start !== "number" || typeof operation.end !== "number") continue;
      const startIndex = nodes.indexOf(operation.start);
      const endIndex = nodes.indexOf(operation.end);
      if (startIndex < 0 || endIndex < startIndex) continue;
      const shadowedSeqs = nodes.slice(startIndex, endIndex + 1);
      nodes.splice(startIndex, shadowedSeqs.length, value.seq);
      replacements.push({ seq: value.seq, start: operation.start, end: operation.end, shadowedSeqs });
    }
    return { nodes, replacements };
  },
};

const aliases: Record<string, unknown> = {
  "@deepseek-ai/cordis": OpenBuddyCordis,
  "@cordisjs/core": OpenBuddyCordis,
  "@deepseek-ai/dsh-typert-protocol": DeepSeekTypertProtocol,
  "@deepseek-ai/dsh-api-remotes": { default: DeepSeekApiRemotesPlugin, apply: DeepSeekApiRemotesPlugin.apply },
  "@deepseek-ai/dsh-hooks-claude-code": { default: DeepSeekClaudeCodeHooksPlugin, apply: DeepSeekClaudeCodeHooksPlugin.apply },
  "@deepseek-ai/dsh-hooks-codex": { default: DeepSeekCodexHooksPlugin, apply: DeepSeekCodexHooksPlugin.apply },
  "@deepseek-ai/cordis-plugin-loader": { default: DeepSeekLoaderPlugin, Loader: DeepSeekLoaderPlugin },
  "@deepseek-ai/cordis-plugin-include": { default: DeepSeekIncludePlugin, Include: DeepSeekIncludePlugin },
  "@deepseek-ai/cordis-plugin-timer": { default: DeepSeekTimerService, TimerService: DeepSeekTimerService },
  "@deepseek-ai/cordis-plugin-group": { default: DeepSeekGroupPlugin, Group: DeepSeekGroupPlugin },
  "@deepseek-ai/cordis-plugin-hmr": { default: DeepSeekHmrService, Hmr: DeepSeekHmrService },
  "@deepseek-ai/cosmokit": DeepSeekCosmokitCompatibility,
};

const deepSeekSessionQueryTypes = {
  SessionQueryEngine: DeepSeekSessionQueryService,
  SessionSearchCursor: (value: string) => value,
};

const deepSeekWorkspaceTypes = {
  WorkspaceId: (value: string) => value,
};

const deepSeekWorkspaceClient = {
  WorkspaceId: deepSeekWorkspaceTypes.WorkspaceId,
};

const deepSeekWorkspaceRemote = {
  WorkspaceId: deepSeekWorkspaceTypes.WorkspaceId,
};

const deepSeekWorkspaceInvariant = {
  name: "workspace-invariant",
  inject: ["workspaceRegistry"],
  apply: () => undefined,
};

export function resolveDeepSeekModule(specifier: string): unknown | undefined {
  if (specifier === "cordis:group") return DeepSeekGroupPlugin;
  if (aliases[specifier] !== undefined) return aliases[specifier];
  if (specifier === "@deepseek-ai/dsh-session/types") return deepSeekSessionTypes;
  if (specifier === "@deepseek-ai/dsh-session/surface") return deepSeekSessionSurface;
  if (specifier === "@deepseek-ai/dsh-workspace/types") return deepSeekWorkspaceTypes;
  if (specifier === "@deepseek-ai/dsh-workspace/client") return deepSeekWorkspaceClient;
  if (specifier === "@deepseek-ai/dsh-workspace/remote") return deepSeekWorkspaceRemote;
  if (specifier === "@deepseek-ai/dsh-workspace/invariant") return deepSeekWorkspaceInvariant;
  if (specifier === "@deepseek-ai/dsh-session-query/types") return deepSeekSessionQueryTypes;
  if (specifier === "@deepseek-ai/dsh-session-query/client") return deepSeekSessionQueryTypes;
  if (DeepSeekCapabilityAliases[specifier] !== undefined) return DeepSeekCapabilityAliases[specifier];
  const capabilitySubmodule = deepSeekCapabilitySubmodule(specifier);
  if (capabilitySubmodule !== undefined) return capabilitySubmodule;
  const base = specifier.replace(/\/(?:remote|types|client)$/, "");
  if (DeepSeekCapabilityAliases[base] !== undefined) return DeepSeekCapabilityAliases[base];
  const remote = deepSeekCapabilityRemote(base);
  if (remote !== undefined) return { default: remote, TYPERT_REMOTE: remote };
  const runtime = resolveDeepSeekRuntimeModule(specifier);
  if (runtime !== undefined) return runtime;
  const generic = resolveDeepSeekGenericModule(specifier);
  if (generic !== undefined) return generic;
  return undefined;
}
