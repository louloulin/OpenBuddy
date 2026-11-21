/**
 * 本地模型入口 (20261116-pii W8).
 *
 * llama-server speaks the OpenAI chat-completions protocol at `/v1`. We register it
 * through OpenBuddy's provider layer (same wire format as Pi's built-in llama.cpp
 * provider) so the model picker, experts, sub-agents and usage all work unchanged.
 */
export interface LocalModelConfig {
  enabled: boolean;
  /** Server root or `.../v1`; normalized to end with `/v1`. */
  baseUrl: string;
  model: string;
  contextWindow: number;
  maxTokens: number;
  /** Make the local model the default for new tasks. */
  setDefault: boolean;
}

export interface LocalModelProbe {
  ok: boolean;
  models: string[];
  endpoint: string;
  ms: number;
  error?: string;
}

export interface LocalModelState {
  config: LocalModelConfig;
  providerId: string;
  models: Array<{ modelId: string; name?: string }>;
}

export const LOCAL_MODEL_PROVIDER_ID = "llama.cpp";
export const DEFAULT_LOCAL_MODEL_CONFIG: LocalModelConfig = {
  enabled: false,
  baseUrl: "http://127.0.0.1:8080/v1",
  model: "",
  contextWindow: 8192,
  maxTokens: 4096,
  setDefault: false,
};
