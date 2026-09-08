/**
 * IPC surface — providers domain.
 *
 * Phase B.1 round 4 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Owns the
 * `agent:providers-*` handlers — provider CRUD + model catalog
 * discovery + connection test.
 */
import { ipcMain } from "electron";

import {
  enumValue,
  httpUrl,
  modelId,
  optionalFiniteInteger,
  optionalString,
  providerId,
  recordValue,
  requiredString,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

export function registerProvidersIpc(deps: AgentHostIpcDeps): void {
  const { agentHost } = deps;

  ipcMain.handle("agent:providers-save-provider", async (_e, args: unknown) => {
    const input = recordValue(args, "provider save payload");
    const provider = recordValue(input.provider, "provider");
    const normalized = {
      ...provider,
      id: providerId(provider.id),
      providerKind: requiredString(provider.providerKind, "providerKind"),
      ...(provider.label === undefined ? {} : { label: requiredString(provider.label, "label") }),
      ...(provider.apiKey === undefined ? {} : { apiKey: requiredString(provider.apiKey, "apiKey") }),
      ...(provider.baseUrl === undefined ? {} : { baseUrl: httpUrl(provider.baseUrl, "baseUrl") }),
      ...(provider.apiBackend === undefined ? {} : { apiBackend: enumValue(provider.apiBackend, "apiBackend", ["messages", "responses", "chat_completions"] as const) }),
      ...(provider.authScheme === undefined ? {} : { authScheme: enumValue(provider.authScheme, "authScheme", ["bearer", "x_api_key"] as const) }),
      ...(provider.contextWindow === undefined ? {} : { contextWindow: optionalFiniteInteger(provider.contextWindow, "contextWindow", 128000, 1, 10_000_000) }),
    };
    return agentHost.saveProvider(normalized);
  });
  ipcMain.handle("agent:providers-save-model", async (_e, args: unknown) => {
    const input = recordValue(args, "model save payload");
    const model = recordValue(input.model, "model");
    return agentHost.saveModel({
      ...model,
      providerId: providerId(model.providerId),
      modelId: modelId(model.modelId),
      ...(model.name === undefined ? {} : { name: requiredString(model.name, "name") }),
      ...(model.contextWindow === undefined ? {} : { contextWindow: optionalFiniteInteger(model.contextWindow, "contextWindow", 128000, 1, 10_000_000) }),
      // `reasoning` gates the entire thinking-level surface. Pi's Model
      // type requires it, and `session.setThinkingLevel(...)` clamps any
      // request to "off" when the active model reports no reasoning
      // support — which silently kills the `agent_thought_chunk` channel
      // and the collapsible 深度思考 block for every custom provider that
      // omits it (e.g. a hand-added MiniMax-M3, which does reason).
      ...(model.reasoning === undefined ? {} : { reasoning: Boolean(model.reasoning) }),
    });
  });
  ipcMain.handle("agent:providers-delete-provider", async (_e, args: unknown) => {
    return agentHost.deleteProvider(providerId(recordValue(args, "provider delete payload").id));
  });
  ipcMain.handle("agent:providers-delete-model", async (_e, args: unknown) => {
    const input = recordValue(args, "model delete payload");
    return agentHost.deleteModel(providerId(input.providerId), modelId(input.modelId));
  });
  ipcMain.handle("agent:providers-fetch-models", async (_e, args: unknown) => {
    const input = recordValue(args, "model discovery payload");
    const baseUrl = httpUrl(input.baseUrl, "baseUrl");
    const apiKey = requiredString(input.apiKey, "apiKey");
    const providerKind = optionalString(input.providerKind, "providerKind");
    const isAnthropic = providerKind === "anthropic" || providerKind === "custom_anthropic" || providerKind === "minimax_cn";
    const headers: Record<string, string> = isAnthropic
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${apiKey}` };
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, { headers });
    if (!response.ok) throw new Error(`Model catalog request failed (${response.status})`);
    const payload = await response.json() as { data?: Array<{ id: string; owned_by?: string }> };
    return (payload.data ?? []).map((model) => ({ id: model.id, ownedBy: model.owned_by }));
  });
  ipcMain.handle("agent:providers-test", async (_e, args: unknown) => {
    const input = recordValue(args, "provider test payload");
    const baseUrl = httpUrl(input.baseUrl, "baseUrl");
    const apiKey = optionalString(input.apiKey, "apiKey") ?? "";
    const providerKind = optionalString(input.providerKind, "providerKind");
    const isAnthropic = providerKind === "anthropic" || providerKind === "custom_anthropic" || providerKind === "minimax_cn";
    const headers: Record<string, string> = isAnthropic
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : { Authorization: apiKey ? `Bearer ${apiKey}` : "Bearer " };
    const startedAt = Date.now();
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, { headers, signal: AbortSignal.timeout(10_000) });
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return {
          status: response.status >= 500 ? "unreachable" : "degraded",
          latencyMs,
          httpStatus: response.status,
          errorCode: String(response.status),
          errorMessage: `HTTP ${response.status} ${response.statusText}`.trim(),
          checkedAt: new Date().toISOString(),
        };
      }
      const payload = await response.json().catch(() => ({})) as { data?: unknown[] };
      const modelsCount = Array.isArray(payload.data) ? payload.data.length : undefined;
      return {
        status: latencyMs > 3000 ? "degraded" : "healthy",
        latencyMs,
        modelsCount,
        httpStatus: response.status,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const err = error as NodeJS.ErrnoException;
      let errorCode: string;
      if (err.code && typeof err.code === "string") {
        errorCode = err.code;
      } else if (err.cause && typeof err.cause === "object" && "code" in err.cause && typeof (err.cause as { code: unknown }).code === "string") {
        errorCode = (err.cause as { code: string }).code;
      } else if (err.name === "AbortError") {
        errorCode = "timeout";
      } else {
        errorCode = "unknown";
      }
      const errorMessage = err.message ?? "Provider test failed";
      return {
        status: "unreachable",
        latencyMs,
        errorCode,
        errorMessage,
        checkedAt: new Date().toISOString(),
      };
    }
  });
}