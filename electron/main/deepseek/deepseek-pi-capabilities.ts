import {
  DEEPSEEK_PI_CAPABILITIES,
  type DeepSeekPiCapabilityName,
  type DeepSeekPiCapabilityInvocationContext,
  type DeepSeekPiCapabilityRuntime,
} from "./deepseek-pi-bridge";

export type DeepSeekPiCapabilityHandlers = {
  session: {
    get: (context: DeepSeekPiCapabilityInvocationContext) => unknown;
    list: (cwd: string, context: DeepSeekPiCapabilityInvocationContext) => Promise<unknown>;
    listWorkspaces: (context: DeepSeekPiCapabilityInvocationContext) => Promise<unknown>;
  };
  /**
   * Web capability handler is optional — OpenBuddy dropped the bespoke web
   * search backend in favour of `pi-web-access`. When the handler is omitted,
   * any web method invocation rejects with a clear "unavailable" error
   * surfaced through the audit channel.
   */
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

type JsonRecord = Record<string, unknown>;

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.every((item) => isJsonValue(item, ancestors));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    return Object.values(value as JsonRecord).every((item) => isJsonValue(item, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

function assertJsonResult(value: unknown, capability: string, method: string): unknown {
  if (!isJsonValue(value)) throw new Error(`pi bridge: ${capability}.${method} returned a non-JSON-safe value`);
  return value;
}

function argumentsRecord(value: unknown, capability: string, method: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value) || !isJsonValue(value)) {
    throw new Error(`pi bridge: ${capability}.${method} arguments must be JSON-safe object`);
  }
  return value as JsonRecord;
}

function optionalString(args: JsonRecord, key: string): string | undefined {
  if (args[key] === undefined) return undefined;
  if (typeof args[key] !== "string" || !args[key].trim()) throw new Error(`pi bridge: ${key} must be a non-empty string`);
  return args[key];
}

function requiredString(args: JsonRecord, key: string): string {
  const value = optionalString(args, key);
  if (!value) throw new Error(`pi bridge: ${key} is required`);
  return value;
}

function optionalNumber(args: JsonRecord, key: string): number | undefined {
  if (args[key] === undefined) return undefined;
  if (typeof args[key] !== "number" || !Number.isFinite(args[key])) throw new Error(`pi bridge: ${key} must be a finite number`);
  return args[key];
}

function ensureKeys(args: JsonRecord, allowed: readonly string[], capability: string, method: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(args).find((key) => !allowedSet.has(key));
  if (unknown) throw new Error(`pi bridge: ${capability}.${method} does not accept ${unknown}`);
}

function isCapabilityName(value: unknown): value is DeepSeekPiCapabilityName {
  return value === "session" || value === "web" || value === "subagent";
}

function abortError(): Error {
  return Object.assign(new Error("Pi capability invocation was cancelled"), { name: "AbortError", code: "cancelled" });
}

function createContext(input?: Partial<DeepSeekPiCapabilityInvocationContext>): DeepSeekPiCapabilityInvocationContext {
  const controller = new AbortController();
  if (input?.signal?.aborted) controller.abort(input.signal.reason);
  else input?.signal?.addEventListener("abort", () => controller.abort(input.signal?.reason), { once: true });
  return { signal: controller.signal, ...(input?.requestId ? { requestId: input.requestId } : {}), ...(input?.caller ? { caller: input.caller } : {}) };
}

async function withTimeout<T>(task: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeoutMs: number): Promise<T> {
  if (parent.aborted) throw abortError();
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("pi bridge: timeout must be a positive safe integer");
  const timeout = new AbortController();
  const onAbort = () => timeout.abort(parent.reason);
  parent.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => timeout.abort(new Error("Pi capability invocation timed out")), timeoutMs);
  try {
    return await Promise.race([
      task(timeout.signal),
      new Promise<T>((_, reject) => timeout.signal.addEventListener("abort", () => reject(timeout.signal.reason instanceof Error ? timeout.signal.reason : abortError()), { once: true })),
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
      const context = createContext(inputContext);
      const startedAt = Date.now();
      const audit = (outcome: "success" | "failure") => options.onAudit?.({ capability, method, outcome, durationMs: Math.max(0, Date.now() - startedAt), ...(context.requestId ? { requestId: context.requestId } : {}), ...(context.caller ? { caller: context.caller } : {}) });
      try {
        if (!isCapabilityName(capability)) throw new Error(`pi bridge: capability is unavailable: ${String(capability)}`);
        const args = argumentsRecord(rawArgs ?? {}, capability, method);
        if (!(DEEPSEEK_PI_CAPABILITIES[capability] as readonly string[]).includes(method)) throw new Error(`pi bridge: capability method is unavailable: ${capability}/${method}`);
        if (capability === "session") {
          if (method === "get") {
            ensureKeys(args, [], capability, method);
            const result = assertJsonResult(handlers.session.get(context), capability, method);
            audit("success");
            return result;
          }
          if (method === "list") {
            ensureKeys(args, ["cwd"], capability, method);
            const result = assertJsonResult(await withTimeout((signal) => handlers.session.list(optionalString(args, "cwd") ?? process.cwd(), { ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
            audit("success");
            return result;
          }
          ensureKeys(args, [], capability, method);
          const result = assertJsonResult(await withTimeout((signal) => handlers.session.listWorkspaces({ ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
          audit("success");
          return result;
        }
        if (capability === "web") {
          if (!handlers.web) throw new Error("pi bridge: web capability is unavailable (use pi-web-access)");
          if (method === "status") {
            ensureKeys(args, [], capability, method);
            const result = assertJsonResult(await withTimeout((signal) => handlers.web!.status({ ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
            audit("success");
            return result;
          }
          if (method === "search") {
            ensureKeys(args, ["query", "maxResults"], capability, method);
            const result = assertJsonResult(await withTimeout((signal) => handlers.web!.search(requiredString(args, "query"), optionalNumber(args, "maxResults"), { ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
            audit("success");
            return result;
          }
          ensureKeys(args, ["url"], capability, method);
          const result = assertJsonResult(await withTimeout((signal) => handlers.web!.fetch(requiredString(args, "url"), { ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
          audit("success");
          return result;
        }
        if (method === "list") {
          ensureKeys(args, ["parentSessionId"], capability, method);
          const result = assertJsonResult(await withTimeout((signal) => handlers.subagent.list(requiredString(args, "parentSessionId"), { ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
          audit("success");
          return result;
        }
        ensureKeys(args, ["parentSessionId", "childSessionId", "text"], capability, method);
        const parentSessionId = requiredString(args, "parentSessionId");
        const childSessionId = requiredString(args, "childSessionId");
        const result = assertJsonResult(await withTimeout((signal) => method === "interrupt"
          ? handlers.subagent.interrupt(parentSessionId, childSessionId, { ...context, signal })
          : handlers.subagent.prompt(parentSessionId, childSessionId, requiredString(args, "text"), { ...context, signal }), context.signal, options.timeoutMs ?? 30_000), capability, method);
        audit("success");
        return result;
      } catch (error) {
        audit("failure");
        throw error;
      }
    },
  };
}
