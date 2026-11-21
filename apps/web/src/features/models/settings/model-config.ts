import {
  PI_THINKING_LEVELS,
  type ApiBackend,
  type AuthScheme,
  type ModelEntry,
  type ModelProviderEntry,
  type PiThinkingLevel,
  type ProviderKind,
} from "@openbuddy/client/agent-client";

/** Provider presets: picking one fills the connection; "custom" kinds are left to the user. */
export interface Preset {
  label: string;
  baseUrl?: string;
  apiBackend: ApiBackend;
  models: string[];
  placeholderKey: string;
  helpUrl?: string;
}

export const PRESET_ORDER: ProviderKind[] = ["custom", "custom_anthropic", "openai", "anthropic", "deepseek", "qwen", "grok", "vercel"];

export const PRESETS: Record<ProviderKind, Preset> = {
  anthropic: {
    label: "Anthropic Claude",
    // Pi's Anthropic client appends /v1/messages itself.
    baseUrl: "https://api.anthropic.com",
    apiBackend: "messages",
    models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
    placeholderKey: "sk-ant-...",
    helpUrl: "console.anthropic.com",
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiBackend: "chat_completions",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    placeholderKey: "sk-...",
    helpUrl: "platform.openai.com",
  },
  grok: {
    label: "xAI Grok",
    baseUrl: "https://api.x.ai/v1",
    apiBackend: "chat_completions",
    models: ["grok-4", "grok-4-fast", "grok-3"],
    placeholderKey: "xai-...",
    helpUrl: "console.x.ai",
  },
  // Vercel AI Gateway：OpenAI 兼容网关，模型 id 形如 `anthropic/claude-sonnet-5`。
  vercel: {
    label: "Vercel AI Gateway",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    apiBackend: "chat_completions",
    models: ["anthropic/claude-sonnet-5", "anthropic/claude-haiku-4.5", "openai/gpt-4.1", "google/gemini-2.5-pro"],
    placeholderKey: "AI_GATEWAY_API_KEY…",
    helpUrl: "vercel.com/docs/ai-gateway",
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiBackend: "chat_completions",
    models: ["deepseek-chat", "deepseek-reasoner"],
    placeholderKey: "sk-...",
    helpUrl: "platform.deepseek.com",
  },
  qwen: {
    label: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiBackend: "chat_completions",
    models: ["qwen-max", "qwen-plus", "qwen-turbo"],
    placeholderKey: "sk-...",
    helpUrl: "dashscope.console.aliyun.com",
  },
  custom: {
    label: "自定义（OpenAI 兼容）",
    apiBackend: "chat_completions",
    models: [],
    placeholderKey: "sk-...",
  },
  custom_anthropic: {
    label: "自定义（Anthropic 兼容）",
    apiBackend: "messages",
    models: [],
    placeholderKey: "sk-...",
  },
};

export const PROTOCOLS: { value: ApiBackend; label: string; hint: string }[] = [
  { value: "chat_completions", label: "OpenAI Chat Completions", hint: "…/v1/chat/completions，绝大多数网关与国产模型" },
  { value: "responses", label: "OpenAI Responses", hint: "…/v1/responses，OpenAI 官方新接口" },
  { value: "messages", label: "Anthropic Messages", hint: "…/v1/messages，Claude 及兼容网关" },
];
export const protocolLabel = (backend?: string) => PROTOCOLS.find((p) => p.value === backend)?.label ?? backend ?? "—";
/** The host pairs the protocol with its auth header; the UI never asks. */
export const authFor = (backend: ApiBackend): AuthScheme => (backend === "messages" ? "x_api_key" : "bearer");

export function providerName(p: Pick<ModelProviderEntry, "label" | "providerKind" | "id">): string {
  return p.label || PRESETS[p.providerKind]?.label || p.id;
}

/** A readable, unique provider id: the preset kind, or a slug of the name for custom ones. */
export function uniqueProviderId(kind: ProviderKind, label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const base = kind.startsWith("custom") ? slug || "custom" : kind;
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** 1000000 → "1M", 131072 → "128K", 384000 → "384K". */
export function formatTokens(n?: number): string {
  if (!n) return "";
  // Round decimal sizes stay decimal (384000 → 384K); binary ones read as such (131072 → 128K).
  const unit = n % 1000 !== 0 && n % 1024 === 0 ? 1024 : 1000;
  if (n >= unit * unit) return `${+(n / (unit * unit)).toFixed(1)}M`;
  if (n >= unit) return `${Math.round(n / unit)}K`;
  return String(n);
}

export function formatPrice(cost?: ModelEntry["cost"]): string {
  if (!cost) return "";
  const f = (v: number) => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : +v.toFixed(3) + "");
  return `$${f(cost.input)} / $${f(cost.output)}`;
}

/** Pi's rule (getSupportedThinkingLevels): null = unsupported; xhigh / max need a mapping. */
export function levelsOf(reasoning: boolean | undefined, map?: ModelEntry["thinkingLevelMap"]): PiThinkingLevel[] {
  if (!reasoning) return ["off"];
  return PI_THINKING_LEVELS.filter((level) => {
    const mapped = map?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

/**
 * Build a thinking map from the levels the user ticked. Levels keep a custom provider value
 * they already had (e.g. medium → "high"); unticked ones are marked unsupported.
 */
export function mapFromLevels(levels: Iterable<PiThinkingLevel>, previous?: ModelEntry["thinkingLevelMap"]): NonNullable<ModelEntry["thinkingLevelMap"]> {
  const on = new Set(levels);
  const map: NonNullable<ModelEntry["thinkingLevelMap"]> = {};
  for (const level of PI_THINKING_LEVELS) {
    const before = previous?.[level];
    if (level === "off") { if (!on.has("off")) map.off = null; else if (typeof before === "string") map.off = before; continue; }
    if (on.has(level)) map[level] = typeof before === "string" ? before : level;
    else if (level !== "xhigh" && level !== "max") map[level] = null;
  }
  return map;
}
