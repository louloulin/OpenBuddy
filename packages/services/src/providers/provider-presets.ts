/** Built-in provider presets (base URL / backend / auth scheme). */
export const PROVIDER_PRESETS: Record<
  string,
  { baseUrl: string; apiBackend: string; authScheme: string }
> = {
  openai: { baseUrl: "https://api.openai.com/v1", apiBackend: "chat_completions", authScheme: "bearer" },
  grok: { baseUrl: "https://api.x.ai/v1", apiBackend: "chat_completions", authScheme: "bearer" },
  deepseek: { baseUrl: "https://api.deepseek.com", apiBackend: "chat_completions", authScheme: "bearer" },
  qwen: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiBackend: "chat_completions", authScheme: "bearer" },
  anthropic: { baseUrl: "https://api.anthropic.com", apiBackend: "messages", authScheme: "x_api_key" },
  // Vercel AI Gateway：OpenAI 兼容的网关端点，模型 id 形如 `anthropic/claude-sonnet-5`。
  vercel: { baseUrl: "https://ai-gateway.vercel.sh/v1", apiBackend: "chat_completions", authScheme: "bearer" },
  // magpie (yetone)：本机模型网关，默认 127.0.0.1:3425，OpenAI 兼容；回环地址不需要 Key。
  magpie: { baseUrl: "http://127.0.0.1:3425/v1", apiBackend: "chat_completions", authScheme: "bearer" },
};
