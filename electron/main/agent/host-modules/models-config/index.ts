/**
 * host-modules/models-config/index.ts — provider / model persistence domain.
 *
 * Batch A extraction (docs/agent-host-microkernel-modularization.md §批次A):
 * moved out of electron/main/agent/agent-host.ts (lines ~2591-2727) so the
 * composition root no longer owns provider/model file I/O. This module keeps its
 * own module-level capture of `state` + `piHome` via `installModelConfig(deps)`,
 * matching the host-modules convention (zero agent-host reverse dependency).
 *
 * Reverse-dependency invariant:
 *   This module imports ONLY host-modules/_state-shape (type) + node builtins.
 *   It never imports agent-host. `state` / `piHome` are injected at install time.
 */

import { join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { AgentHostState } from "../_state-shape";

export interface ProviderDraft {
  id: string;
  providerKind: string;
  label?: string;
  apiKey?: string;
  baseUrl?: string;
  apiBackend?: string;
  authScheme?: string;
  contextWindow?: number;
}
export interface ModelDraft {
  modelId: string;
  providerId: string;
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
}

let hostState: AgentHostState | null = null;
let hostPiHome: () => string = () => "";

/**
 * Wire module-level deps. Call once at agent-host module load (after `state` /
 * `piHome` are available) and before any model-config function is invoked at
 * runtime. Idempotent.
 */
export function installModelConfig(deps: { state: AgentHostState; piHome: () => string }): void {
  hostState = deps.state;
  hostPiHome = deps.piHome;
}

function modelsFile(): string {
  return join(hostPiHome(), "models.json");
}
function authFile(): string {
  return join(hostPiHome(), "auth.json");
}

async function atomicWrite(file: string, contents: string): Promise<void> {
  await mkdir(hostPiHome(), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, file);
}

export async function readModelsConfig(): Promise<{ providers: Record<string, any>; [key: string]: any }> {
  try {
    return JSON.parse(await readFile(modelsFile(), "utf8"));
  } catch {
    return { providers: {} };
  }
}

async function writeModelsConfig(config: { providers: Record<string, any>; [key: string]: any }): Promise<void> {
  await atomicWrite(modelsFile(), `${JSON.stringify(config, null, 2)}\n`);
  // Keep the runtime instance that was injected into the active AgentSession.
  // Replacing it here leaves the session checking credentials against the old
  // runtime while setModel() resolves the model from the new one.
  if (hostState?.modelRuntime) {
    await hostState.modelRuntime.refresh({ allowNetwork: false });
  }
}

async function updateStoredApiKey(providerId: string, apiKey: string | undefined): Promise<void> {
  let auth: Record<string, unknown> = {};
  try {
    auth = JSON.parse(await readFile(authFile(), "utf8"));
  } catch {
    /* first credential */
  }
  if (apiKey) auth[providerId] = { type: "api_key", key: apiKey };
  else delete auth[providerId];
  await atomicWrite(authFile(), `${JSON.stringify(auth, null, 2)}\n`);
}

export async function saveProvider(provider: ProviderDraft): Promise<void> {
  const config = await readModelsConfig();
  const current = config.providers[provider.id] ?? {};
  config.providers[provider.id] = {
    ...current,
    name: provider.label || current.name,
    baseUrl: provider.baseUrl || current.baseUrl,
    api:
      provider.apiBackend === "messages"
        ? "anthropic-messages"
        : provider.apiBackend === "responses"
          ? "openai-responses"
          : "openai-completions",
    // `authHeader` is the pi-ai switch for Authorization/Bearer. Native
    // Anthropic Messages providers use x-api-key and therefore leave it off.
    authHeader: provider.authScheme === "bearer",
    models: current.models ?? [],
  };
  await writeModelsConfig(config);
  if (provider.apiKey && !provider.apiKey.startsWith("•")) {
    await updateStoredApiKey(provider.id, provider.apiKey);
    await hostState?.modelRuntime?.setRuntimeApiKey(provider.id, provider.apiKey);
  }
  if (hostState?.modelRuntime) {
    try {
      await hostState.modelRuntime.refresh({ allowNetwork: false, providers: [provider.id] });
    } catch (error) {
      console.error(`[openbuddy] runtime refresh after save-provider failed`, error);
    }
  }
}

export async function saveModel(model: ModelDraft): Promise<void> {
  const config = await readModelsConfig();
  const provider = config.providers[model.providerId];
  if (!provider) throw new Error(`Pi provider not found: ${model.providerId}`);
  const models = Array.isArray(provider.models) ? provider.models.filter((item: any) => item.id !== model.modelId) : [];
  // Preserve a previously-stored `reasoning` flag when the draft doesn't carry
  // one, so re-saving a model (e.g. renaming it) can't silently strip reasoning
  // support and clamp thinking to "off". An explicit draft value always wins.
  const previous = Array.isArray(provider.models)
    ? provider.models.find((item: any) => item.id === model.modelId)
    : undefined;
  const reasoning = model.reasoning ?? previous?.reasoning ?? false;
  models.push({
    id: model.modelId,
    name: model.name ?? model.modelId,
    contextWindow: model.contextWindow ?? 128000,
    maxTokens: 16384,
    reasoning,
  });
  provider.models = models;
  await writeModelsConfig(config);
  if (hostState?.modelRuntime) {
    try {
      await hostState.modelRuntime.refresh({ allowNetwork: false, providers: [model.providerId] });
    } catch (error) {
      console.error(`[openbuddy] runtime refresh after save-model failed`, error);
    }
  }
}

export async function deleteModel(providerId: string, modelId: string): Promise<void> {
  const config = await readModelsConfig();
  const provider = config.providers[providerId];
  if (provider) provider.models = (provider.models ?? []).filter((item: any) => item.id !== modelId);
  await writeModelsConfig(config);
  if (hostState?.modelRuntime) {
    try {
      await hostState.modelRuntime.refresh({ allowNetwork: false, providers: [providerId] });
    } catch (error) {
      console.error(`[openbuddy] runtime refresh after delete-model failed`, error);
    }
    await restoreActiveModelAfterMutation(providerId, modelId);
  }
}

async function restoreActiveModelAfterMutation(providerId: string, modelId?: string): Promise<void> {
  if (!hostState?.session || !hostState.model || hostState.model.provider !== providerId || (modelId && hostState.model.id !== modelId)) return;
  const fallback = hostState.modelRuntime
    ?.getAvailableSnapshot()
    .find((candidate) => candidate.provider !== providerId || candidate.id !== modelId);
  if (!fallback) {
    hostState.model = undefined;
    return;
  }
  try {
    await hostState.session.setModel(fallback);
    hostState.model = fallback;
  } catch (error) {
    console.error(`[openbuddy] failed to restore active model after provider mutation`, error);
    hostState.model = undefined;
  }
}

export async function deleteProvider(id: string): Promise<void> {
  const config = await readModelsConfig();
  delete config.providers[id];
  await writeModelsConfig(config);
  await hostState?.modelRuntime?.removeRuntimeApiKey(id).catch(() => undefined);
  await updateStoredApiKey(id, undefined);
  if (hostState?.modelRuntime) {
    try {
      await hostState.modelRuntime.refresh({ allowNetwork: false, providers: [id] });
    } catch (error) {
      console.error(`[openbuddy] runtime refresh after delete-provider failed`, error);
    }
    await restoreActiveModelAfterMutation(id);
  }
}
