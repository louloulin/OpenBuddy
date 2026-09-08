#!/usr/bin/env node
/**
 * OpenBuddyDoctor 临床 LLM Provider 一键配置脚本
 *
 * 用法:
 *   OPENBUDDY_CLINICAL_API_KEY=sk-xxx node scripts/clinical/setup-llm-provider.mjs
 *   node scripts/clinical/setup-llm-provider.mjs --api-key sk-xxx --base-url https://token.yueming.xin/v1
 *
 * 默认指向 token.yueming.xin(个人测试)。医院部署时用 --base-url 切换内网地址。
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { execSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, "..", "..");

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function keychainApiKey() {
  try {
    return execSync(
      `security find-generic-password -a "openbuddy-doctor" -s "token.yueming.xin" -w`,
      { encoding: "utf8", timeout: 3000 },
    ).trim() || null;
  } catch { return null; }
}

const apiKey = arg(
  "api-key",
  process.env.OPENBUDDY_CLINICAL_API_KEY
    || process.env.OPENBUDDY_DOCTOR_API_KEY
    || keychainApiKey(),
);
const baseUrl = arg("base-url", "https://token.yueming.xin/v1");
const providerId = arg("provider-id", "yueming-token");
const label = arg("label", "Yueming Token Gateway");

if (!apiKey) {
  console.error("错误: 缺少 API key");
  console.error("用法(三选一):");
  console.error("  1. OPENBUDDY_CLINICAL_API_KEY=sk-xxx node scripts/clinical/setup-llm-provider.mjs");
  console.error("  2. node scripts/clinical/setup-llm-provider.mjs --api-key sk-xxx");
  console.error("  3. 先存入钥匙串: security add-generic-password -a openbuddy-doctor -s token.yueming.xin -w sk-xxx -U");
  process.exit(1);
}

console.log(`[clinical] 测试网关连通性: ${baseUrl}/models ...`);
const response = await fetch(`${baseUrl}/models`, {
  headers: { Authorization: `Bearer ${apiKey}` },
}).catch((error) => {
  console.error(`[clinical] 连接失败: ${error.message}`);
  process.exit(1);
});

if (!response.ok) {
  const body = await response.text().catch(() => "");
  console.error(`[clinical] 网关返回 ${response.status}: ${body.slice(0, 200)}`);
  if (response.status === 401) console.error("[clinical] API key 无效或已过期");
  process.exit(1);
}

const payload = await response.json();
const models = (payload.data ?? []).map((m) => ({ id: m.id, ownedBy: m.owned_by ?? "" }));
console.log(`[clinical] ✓ 网关连通,发现 ${models.length} 个模型:`);
for (const model of models.slice(0, 20)) console.log(`  - ${model.id}${model.ownedBy ? ` (${model.ownedBy})` : ""}`);
if (models.length > 20) console.log(`  ... 以及 ${models.length - 20} 个`);

// Smoke test: one chat completion.
if (models.length > 0) {
  const testModel = models.find((m) => /gpt|claude|deepseek|qwen/i.test(m.id))?.id ?? models[0].id;
  console.log(`[clinical] 冒烟测试 chat completion (${testModel}) ...`);
  const chatResponse = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: testModel,
      messages: [{ role: "user", content: "回复 OK 两个字母即可,不要任何其他内容" }],
      max_tokens: 8,
    }),
  }).catch(() => null);
  if (chatResponse?.ok) {
    const chatPayload = await chatResponse.json().catch(() => null);
    const content = chatPayload?.choices?.[0]?.message?.content ?? "";
    console.log(`[clinical] ✓ LLM 冒烟通过: "${content.trim().slice(0, 40)}"`);
  } else {
    console.warn(`[clinical] ⚠ 冒烟测试失败 (HTTP ${chatResponse?.status ?? "network"}) — 模型列表可用但 chat 接口需检查`);
  }
}

// Write provider config to the Pi agent home used by OpenBuddyDoctor.
const piAgentHome = process.env.PI_CODING_AGENT_DIR
  ?? join(process.env.PI_HOME ?? os.homedir(), ".pi", "agent");
const modelsConfigPath = join(piAgentHome, "models.json");
const authConfigPath = join(piAgentHome, "auth.json");
let config = { providers: {} };
try {
  if (existsSync(modelsConfigPath)) config = JSON.parse(readFileSync(modelsConfigPath, "utf8"));
} catch { /* fresh */ }
if (!config.providers) config.providers = {};

config.providers[providerId] = {
  ...(config.providers[providerId] ?? {}),
  name: label,
  baseUrl,
  api: "openai-completions",
  authHeader: true,
  models: models.slice(0, 50).map((m) => ({
    id: m.id,
    name: m.id,
    contextWindow: 128000,
    maxTokens: 16384,
    reasoning: /o[13]|thinking|reasoning|r1/i.test(m.id),
  })),
};

mkdirSync(piAgentHome, { recursive: true });
writeFileSync(modelsConfigPath, JSON.stringify(config, null, 2) + "\n", "utf8");

let auth = {};
try {
  if (existsSync(authConfigPath)) auth = JSON.parse(readFileSync(authConfigPath, "utf8"));
} catch { /* fresh */ }
auth[providerId] = { type: "api_key", key: apiKey };
writeFileSync(authConfigPath, JSON.stringify(auth, null, 2) + "\n", { mode: 0o600 });
console.log(`[clinical] ✓ Provider 配置已写入: ${modelsConfigPath}`);
console.log(`[clinical] ✓ API key 配置已写入: ${authConfigPath}`);
console.log(`[clinical] Provider ID: ${providerId}`);
console.log(`[clinical] 重启 OpenBuddyDoctor 后在模型选择器中即可看到。`);
