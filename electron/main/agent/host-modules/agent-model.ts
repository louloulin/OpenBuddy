/**
 * host-modules/agent-model.ts — model CRUD + provider/auth surface.
 *
 * Phase 8.3 Batch B: 从 agent-host.ts 抽出两块非连续 region:
 *   - Region M1 (lines 3830-3906): setModel / setThinkingLevel / getModel /
 *     getModelRuntime / getCwd
 *   - Region M2 (lines 4298-4410): authStatus / providerCatalog
 *
 * 设计:
 *   - state / emitRendererEvent / piHome / readModelsConfig 通过环形 import
 *     自 ../agent-host 注入 (readModelsConfig 是 agent-host.ts 内部 helper,
 *     line 4642, 这次给它加 export 以支持环形 import)
 *   - piHome 已经在 agent-host.ts 是 export, 不需要再动
 *   - ProviderRegistrySource 已经从 ./agent-host-provider-registry import,
 *     本模块独立 import
 *   - ModelRuntime / ModelRegistry / Model 来自 pi-ai + pi-coding-agent,
 *     与 agent-host.ts 顶层 import 一致
 *   - emitRendererEvent("pi://models-update", ...) 留在这里 — grep target
 *     `emitRendererEvent(` 在 agent-host.ts 仍然保留 (line 3404 + 3854 +
 *     3884 中后两者被删除, 但 line 3404 实现还在; 实际 wrapper import 替换
 *     实际函数, 行为不变)
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";

import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

import { generateTraceId } from "@openbuddy/logging-shared";
import { hostReceived as hostReceivedLog, hostDispatched as hostDispatchedLog, hostFailed as hostFailedLog } from "../agent-host-log";
import type { ProviderRegistrySource } from "../agent-host-provider-registry";
import type { OpenBuddyThinkingLevel } from "../../ipc/validation";
import { type AgentHostState, } from "./_state-shape";
import { createDefaultAgentHostState } from "./_default-state";

/**
 * Phase 8.3 Architectural Refactor: 顶部 from "../agent-host" 反向依赖消除。
 * 所有运行时依赖通过 installAgentModel() 注入。
 *
 * 修复前: state / emitRendererEvent / piHome / readModelsConfig 全部 import 自
 *         ../agent-host,在测试时需要 mock 整个 agent-host 的副作用链。
 * 修复后: 本模块只 import 类型,运行时依赖通过 DI 注入,可独立单测。
 */

let state: AgentHostState = createDefaultAgentHostState();
let emitRendererEvent: (channel: string, payload: unknown) => void;
let piHome: () => string;
let readModelsConfig: () => Promise<{ providers: Record<string, unknown> }>;

export function installAgentModel(deps: {
	state: AgentHostState;
	emitRendererEvent: (channel: string, payload: unknown) => void;
	piHome: () => string;
	readModelsConfig: () => Promise<{ providers: Record<string, unknown> }>;
}): void {
	state = deps.state;
	emitRendererEvent = deps.emitRendererEvent;
	piHome = deps.piHome;
	readModelsConfig = deps.readModelsConfig;
}

async function setModel(modelId: string, options?: { traceId?: string; sessionId?: string }): Promise<void> {
  const traceId = options?.traceId ?? generateTraceId();
  const sessionId = options?.sessionId ?? state.session?.sessionId;
  hostReceivedLog("agent:set-model", traceId, sessionId);
  if (!state.session) {
    const err = new Error("openbuddy-agent: session not initialized");
    hostFailedLog("agent:set-model", traceId, err);
    throw err;
  }
  // Reuse the in-memory runtime so any credential set via setRuntimeApiKey
  // (e.g. after the user saves a BYOK provider in Settings) survives the switch.
  // Recreating ModelRuntime here would discard those runtime-only credentials
  // until the next setRuntimeApiKey call.
  const runtime = state.modelRuntime ?? await ModelRuntime.create({ authPath: join(piHome(), "auth.json"), modelsPath: join(piHome(), "models.json"), refreshOnCreate: false });
  const [provider, ...modelParts] = modelId.split("/");
  const next = new ModelRegistry(runtime).find(provider, modelParts.join("/"));
  if (!next) {
    const err = new Error(`openbuddy-agent: model ${modelId} not found`);
    hostFailedLog("agent:set-model", traceId, err);
    throw err;
  }
  try {
    await state.session.setModel(next);
    state.model = next;
    emitRendererEvent("pi://models-update", {
      sessionId: state.session?.sessionId,
      providers: [...state.providerRegistry.keys()],
      activeModelId: next?.id ?? null,
    });
    hostDispatchedLog("agent:set-model", traceId, sessionId);
  } catch (error) {
    hostFailedLog("agent:set-model", traceId, error);
    throw error;
  }
}

async function setThinkingLevel(level: OpenBuddyThinkingLevel, options?: { traceId?: string; sessionId?: string }): Promise<OpenBuddyThinkingLevel> {
  const traceId = options?.traceId ?? generateTraceId();
  const sessionId = options?.sessionId ?? state.session?.sessionId;
  hostReceivedLog("agent:set-thinking-level", traceId, sessionId);
  if (!state.session) {
    const err = new Error("openbuddy-agent: session not initialized");
    hostFailedLog("agent:set-thinking-level", traceId, err);
    throw err;
  }
  try {
    // Pi's setThinkingLevel is synchronous and clamps the request to the
    // active model's supported levels (e.g. "high" → "medium" on a model
    // that only has medium). We read the canonical level back so the IPC
    // response can tell the renderer the *actual* level that took effect,
    // and so the session tree persists the clamped value (Pi only writes
    // when the stored level actually changes).
    state.session.setThinkingLevel(level);
    const applied = state.session.thinkingLevel as OpenBuddyThinkingLevel;
    emitRendererEvent("pi://thinking-level-update", {
      sessionId: state.session?.sessionId,
      level: applied,
    });
    hostDispatchedLog("agent:set-thinking-level", traceId, sessionId);
    return applied;
  } catch (error) {
    hostFailedLog("agent:set-thinking-level", traceId, error);
    throw error;
  }
}

function getModel(): Model<any> | undefined {
  return state.model;
}

function getModelRuntime(): ModelRuntime | null {
  return state.modelRuntime;
}

function getCwd(): string {
  return state.cwd ?? process.cwd();
}

async function authStatus() {
  const runtime = state.modelRuntime ?? await ModelRuntime.create({
    authPath: join(piHome(), "auth.json"),
    modelsPath: join(piHome(), "models.json"),
    refreshOnCreate: false,
  });
  // providerIds() includes built-ins + extension providers + providers loaded
  // from models.json (custom_anthropic, custom, deepseek, etc.). The previous
  // call to getRegisteredProviderIds() only returned extension providers and
  // therefore reported no providers even when auth.json + models.json were
  // both fully configured.
  const providers = runtime.getProviders().map((provider) => provider.id);
  const available = await runtime.getAvailable().catch(() => []);
  // With refreshOnCreate disabled, getAvailable() can be empty until the
  // asynchronous availability refresh runs. A configured model plus a stored
  // credential is already sufficient to enable the composer safely; the first
  // request will still surface any endpoint/model authentication error.
  const configuredModels = runtime.getModels().filter((model) => {
    const provider = (model as unknown as { provider?: string }).provider;
    return provider ? runtime.hasConfiguredAuth(provider) : false;
  });
  return {
    ready: available.length > 0 || configuredModels.length > 0 || providers.some((provider) => runtime.hasConfiguredAuth(provider)),
    hasAuthFile: (await stat(join(piHome(), "auth.json"), { throwIfNoEntry: false }))?.isFile() ?? false,
    providers,
  };
}

async function providerCatalog() {
  const runtime = state.modelRuntime;
  if (!runtime) return { providers: [], models: [] };
  // getRegisteredProviderIds() does not list custom providers loaded from
  // models.json (it only returns built-in provider ids). Derive provider
  // metadata from the available model list instead.
  const storedConfig = await readModelsConfig();
  const allModels = runtime.getModels().filter((model) => {
    const value = model as unknown as { provider?: string; id?: string; name?: string; contextWindow?: number };
    const providerId = value.provider ?? "custom";
    const modelId = value.id ?? "unknown";
    const configured = Object.prototype.hasOwnProperty.call(storedConfig.providers, providerId);
    const authenticated = runtime.hasConfiguredAuth(providerId);
    if (!configured && !authenticated) return false;
    if (providerId === "xai" || /(^|[/:-])grok([/:-]|$)/i.test(modelId) || /grok/i.test(value.name ?? "")) return false;
    return true;
  });
  // Settings cards represent user-configured providers, not every built-in
  // model provider bundled by pi-ai. Only providers explicitly present in
  // models.json are editable from this UI.
  const configuredIds = Object.keys(storedConfig.providers);
  // Pi extensions can register additional providers at runtime via
  // `pi.registerProvider(...)`. Merge those into the catalog so the UI sees
  // every provider the agent can actually use. Built-ins stay hidden unless
  // they were explicitly configured.
  const extensionRegisteredIds = [...runtime.getRegisteredProviderIds()]
    .filter((id) => !configuredIds.includes(id) && id !== "xai");
  const providerIds = [...configuredIds, ...extensionRegisteredIds];
  // Build a map of provider id → resolved wire protocol by inspecting the
  // model objects the runtime actually exposes. pi-ai merges built-in
  // providers with user overrides, so a user who sets
  // `api: "openai-completions"` for the built-in `minimax` provider still
  // ends up talking Anthropic Messages (the built-in wins). Reading the
  // configured model object instead of `storedConfig.providers[id].api`
  // makes the UI show the protocol that will actually be used on the wire.
  const resolvedApiByProvider = new Map<string, string>();
  for (const model of runtime.getModels()) {
    const providerId = (model as { provider?: string }).provider;
    const api = (model as { api?: string }).api;
    if (!providerId || !api) continue;
    if (!resolvedApiByProvider.has(providerId)) resolvedApiByProvider.set(providerId, api);
  }
  const providers = providerIds.map((id) => {
    const config: Record<string, unknown> = (runtime.getRegisteredProviderConfig(id) as Record<string, unknown> | undefined) ?? (storedConfig.providers[id] as Record<string, unknown>) ?? {};
    const authConfigured = runtime.hasConfiguredAuth(id);
    const providerKind = id.startsWith("custom_anthropic") ? "custom_anthropic" :
      ["anthropic", "openai", "pi", "deepseek", "qwen", "minimax", "minimax_openai", "minimax_cn", "custom"].includes(id) ? id : "custom";
    const attribution = state.providerRegistry.get(id);
    const isExtensionRegistered = extensionRegisteredIds.includes(id);
    const source: ProviderRegistrySource = attribution?.source
      ?? (isExtensionRegistered ? "pi-extension" : (configuredIds.includes(id) ? "user-config" : "builtin"));
    // Prefer the runtime-resolved protocol; fall back to the stored config
    // when the runtime has no models yet (cold cache) so the UI does not
    // briefly show "unknown".
    const resolvedApi = resolvedApiByProvider.get(id) ?? config?.api;
    const apiBackend = resolvedApi === "anthropic-messages" ? "messages"
      : resolvedApi === "openai-responses" ? "responses"
      : resolvedApi === "openai-completions" ? "chat_completions"
      : "chat_completions";
    return {
      id,
      providerKind,
      label: config?.name ?? id,
      apiKey: authConfigured ? "••••••••" : undefined,
      baseUrl: config?.baseUrl,
      apiBackend,
      // pi-ai uses authHeader=true to add `Authorization: Bearer <key>`.
      // The UI calls the native Anthropic header `x_api_key`, so the public
      // value is intentionally the inverse of the wire-level flag.
      authScheme: config?.authHeader ? "bearer" : "x_api_key",
      source,
      ...(attribution?.extensionPath ? { extensionPath: attribution.extensionPath } : {}),
    };
  });
  const models = allModels.flatMap((model) => {
    const value = model as unknown as { provider?: string; id?: string; name?: string; contextWindow?: number; reasoning?: boolean };
    const providerId = value.provider ?? "custom";
    const modelId = value.id ?? "unknown";
    // Pi ships xAI/Grok models for its own CLI defaults. OpenBuddy is Pi-first
    // but intentionally does not expose that legacy provider in its UI.
    if (providerId === "xai" || /(^|[/:-])grok([/:-]|$)/i.test(modelId) || /grok/i.test(value.name ?? "")) return [];
    // Surface `reasoning` so the model editor can pre-fill its toggle — without
    // it, re-saving a model would default the flag back to false and clamp
    // thinking to "off". Pi's Model type always carries the field.
    return [{ modelId, providerId, name: value.name ?? modelId, contextWindow: value.contextWindow, reasoning: value.reasoning ?? false }];
  });
  return { providers, models };
}

export {
  setModel,
  setThinkingLevel,
  getModel,
  getModelRuntime,
  getCwd,
  authStatus,
  providerCatalog,
};
