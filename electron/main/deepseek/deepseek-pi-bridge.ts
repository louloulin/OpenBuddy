import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { Model } from "@earendil-works/pi-ai";

type JsonRecord = Record<string, unknown>;

export const DEEPSEEK_PI_BRIDGE_PROTOCOL = "openbuddy.pi.v1" as const;

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

export const DEEPSEEK_PI_CAPABILITIES = {
  session: ["get", "list", "listWorkspaces"],
  web: ["status", "search", "fetch"],
  subagent: ["list", "prompt", "interrupt"],
} as const satisfies Readonly<Record<DeepSeekPiCapabilityName, readonly string[]>>;

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
  protocol: typeof DEEPSEEK_PI_BRIDGE_PROTOCOL;
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

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content.map((part) => {
    if (typeof part === "string") return part;
    const item = record(part);
    if (item.type === "text" && typeof item.text === "string") return item.text;
    if (typeof item.content === "string") return item.content;
    return "";
  }).join("");
}

function piContent(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return contentText(content);
  return content.map((part) => {
    const item = record(part);
    if (item.type === "text" && typeof item.text === "string") return { type: "text", text: item.text };
    if (item.type === "reasoning" && typeof item.text === "string") return { type: "thinking", thinking: item.text };
    if (item.type === "tool-call") {
      return {
        type: "toolCall",
        id: String(item.id ?? "dsh-tool"),
        name: String(item.name ?? "tool"),
        arguments: parseArguments(item.arguments),
      };
    }
    return { type: "text", text: contentText(part) };
  });
}

function parseArguments(value: unknown): JsonRecord {
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

function toPiMessages(messages: unknown, model: Model<any>): unknown[] {
  if (!Array.isArray(messages)) return [];
  return messages.filter((raw) => record(raw).role !== "system").map((raw) => {
    const message = record(raw);
    const role = message.role;
    const timestamp = typeof message.timestamp === "number" ? message.timestamp : Date.now();
    if (role === "tool-result" || role === "tool") {
      return {
        role: "toolResult",
        toolCallId: String(message.toolCallId ?? message.callId ?? "dsh-tool"),
        toolName: String(message.toolName ?? "tool"),
        content: [{ type: "text", text: contentText(message.content) }],
        isError: Boolean(message.isError),
        timestamp,
      };
    }
    if (role === "assistant") {
      return {
        role: "assistant",
        content: piContent(message.content),
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp,
      };
    }
    return { role: "user", content: piContent(message.content), timestamp };
  });
}

function toolCallFromPartial(event: JsonRecord): JsonRecord {
  const partial = record(event.partial);
  const content = Array.isArray(partial.content) ? partial.content : [];
  return record(content[Number(event.contentIndex)]);
}

function usageFromMessage(message: unknown): JsonRecord {
  const usage = record(record(message).usage);
  return {
    inputTokens: Number(usage.input ?? 0),
    outputTokens: Number(usage.output ?? 0),
    ...(usage.cacheRead === undefined ? {} : { cacheReadTokens: Number(usage.cacheRead) }),
    ...(usage.cacheWrite === undefined ? {} : { cacheWriteTokens: Number(usage.cacheWrite) }),
    ...(usage.reasoning === undefined ? {} : { reasoningTokens: Number(usage.reasoning) }),
  };
}

function finishReason(reason: unknown): JsonRecord {
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
    protocol: DEEPSEEK_PI_BRIDGE_PROTOCOL,
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
      messages: toPiMessages(options.messages, model),
      tools: Array.isArray(options.tools) ? options.tools.map((tool) => {
        const item = record(tool);
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
    return mapPiStream(stream(model, context, streamOptions));
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
      const result = record(await runtime.executeTool(name, execution.arguments, execution.signal as AbortSignal | undefined));
      const content = Array.isArray(result.content)
        ? result.content.map((part) => {
          const item = record(part);
          return item.type === "text" && typeof item.text === "string"
            ? { type: "text", text: item.text }
            : { type: "text", text: contentText(part) };
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

async function* mapPiStream(source: AsyncIterable<JsonRecord>): AsyncIterable<JsonRecord> {
  for await (const raw of source) {
    const event = record(raw);
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
        const call = toolCallFromPartial(event);
        yield { type: "block-start", index: Number(event.contentIndex ?? 0), blockType: "tool-call" };
        yield { type: "tool-call-delta", index: Number(event.contentIndex ?? 0), id: String(call.id ?? ""), name: String(call.name ?? ""), argumentsDelta: "" };
        break;
      }
      case "toolcall_delta": {
        const call = toolCallFromPartial(event);
        yield { type: "tool-call-delta", index: Number(event.contentIndex ?? 0), id: String(call.id ?? ""), name: typeof call.name === "string" ? call.name : undefined, argumentsDelta: String(event.delta ?? "") };
        break;
      }
      case "toolcall_end": {
        const call = record(event.toolCall);
        yield { type: "block-end", index: Number(event.contentIndex ?? 0), block: { type: "tool-call", id: String(call.id ?? ""), name: String(call.name ?? ""), arguments: JSON.stringify(call.arguments ?? {}) } };
        break;
      }
      case "done":
        yield { type: "usage", usage: usageFromMessage(event.message) };
        yield { type: "finish", reason: finishReason(event.reason) };
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
