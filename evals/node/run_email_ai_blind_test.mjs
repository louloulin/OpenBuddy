#!/usr/bin/env node
/**
 * Email AI Blind Test Runner v1
 *
 * 用真实模型（也可指定 mock）对邮件 AI 分诊盲测集 (≥50 封) 进行预测，
 * 然后调用 evaluate_email_ai_quality.mjs 输出 v2 质量报告。
 *
 * 必需环境变量：
 *   OPENBUDDY_EMAIL_AI_QUALITY_DATASET    盲测集 JSON 路径（默认 evals/datasets/email_ai_quality_cases.json）
 *   OPENBUDDY_EMAIL_AI_QUALITY_MODEL      模型提供方（'mock' | 'openai-compatible' | 'anthropic-compatible' | 'openbuddy-rules'）
 *   OPENBUDDY_EMAIL_AI_QUALITY_MODEL_ID   具体模型 ID（如 gpt-4o-mini / claude-haiku-4-5）
 *   OPENBUDDY_EMAIL_AI_QUALITY_RUN_ID     本次运行的稳定 ID（写入 report.predictionSource.runId）
 *
 * 可选：
 *   OPENBUDDY_EMAIL_AI_QUALITY_API_KEY    模型 API key
 *   OPENBUDDY_EMAIL_AI_QUALITY_API_URL    模型 API base URL
 *   OPENBUDDY_EMAIL_AI_QUALITY_PROMPT     自定义 prompt 模板（不传使用内置）
 *   OPENBUDDY_EMAIL_AI_QUALITY_DRY_RUN    '1' 只生成 predictions.json 不评估
 *   OPENBUDDY_EMAIL_AI_QUALITY_LIMIT      限制运行 case 数（用于分批）
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const datasetPath = process.env.OPENBUDDY_EMAIL_AI_QUALITY_DATASET ?? new URL("../datasets/email_ai_quality_cases.json", import.meta.url).pathname;
const modelKind = (process.env.OPENBUDDY_EMAIL_AI_QUALITY_MODEL ?? "mock").toLowerCase();
const openbuddyRulesPromise = modelKind === "openbuddy-rules" ? import("./openbuddy_email_ai_rules.mjs") : null;
const modelId = process.env.OPENBUDDY_EMAIL_AI_QUALITY_MODEL_ID ?? "mock-fixture-v1";
const runId = process.env.OPENBUDDY_EMAIL_AI_QUALITY_RUN_ID ?? `run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const apiKey = process.env.OPENBUDDY_EMAIL_AI_QUALITY_API_KEY ?? "";
const apiUrl = process.env.OPENBUDDY_EMAIL_AI_QUALITY_API_URL ?? "https://api.openai.com/v1/chat/completions";
const customPrompt = process.env.OPENBUDDY_EMAIL_AI_QUALITY_PROMPT ?? "";
const dryRun = process.env.OPENBUDDY_EMAIL_AI_QUALITY_DRY_RUN === "1";
const limit = Number(process.env.OPENBUDDY_EMAIL_AI_QUALITY_LIMIT ?? "0");

const SYSTEM_PROMPT = customPrompt || `你是一名企业邮件 AI 助手。请阅读下方邮件，按 JSON 格式输出所有"需要我处理的行动项"。

输出规则：
1. 仅输出 JSON，不要包含任何解释、前缀、Markdown 围栏。
2. JSON 结构：{ "actions": [ { "content": "行动项描述", "owner": "负责人", "dueAt": "YYYY-MM-DD 或 null", "messageId": "邮件内消息 ID" } ] }
3. content 简洁、不超过 30 字，用动词开头，描述我方需要做的事。
4. owner 默认为 "我"，如果是等待对方则填对方角色（如 "客户"、"供应商"）。
5. dueAt 必须是 YYYY-MM-DD，若邮件未提到具体日期则为 null。
6. messageId 使用邮件提供的 ID；如邮件没有显式消息 ID，则用 m-${"$"}{caseId} 占位。
7. 没有行动项时返回 { "actions": [] }，不要编造。
8. 不要把会议邀请当作行动项，除非邮件明确要求我方确认或准备材料。
9. 不要把订阅邮件、状态通知、新闻摘要当作行动项。`;

function buildUserPrompt(testCase) {
  const sender = testCase.from?.name ? `${testCase.from.name} <${testCase.from.address}>` : testCase.from?.address ?? "unknown"
  return `Case ID: ${testCase.id}
From: ${sender}
Subject: ${testCase.subject ?? ""}

${testCase.body ?? ""}`
}

async function callMockModel(testCase) {
  // Deterministic mock: produce predictions equal to expectedActions so the report shows green for the fixture
  return {
    actions: (testCase.expectedActions ?? []).map((action) => ({
      content: action.content,
      owner: action.owner,
      dueAt: action.dueAt,
      messageId: action.messageId ?? `m-${testCase.id}`,
    })),
  }
}

async function callOpenBuddyRulesModel(testCase) {
  const mod = await (openbuddyRulesPromise ?? import("./openbuddy_email_ai_rules.mjs"))
  return model.predictWithOpenBuddyRules(testCase);
}

let agentBackendCache = null
let agentBackendPromise = null
let harnessBackendCache = null
let harnessBackendPromise = null

async function loadHarnessBackendPredictions() {
  if (harnessBackendCache) return harnessBackendCache
  if (!harnessBackendPromise) {
    const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR ?? join(process.cwd(), "evidence")
    mkdirSync(evidenceDir, { recursive: true })
    const bridgeDir = join(evidenceDir, "email-ai-quality", runId, "agent-harness")
    mkdirSync(bridgeDir, { recursive: true })
    const predictionsPath = join(bridgeDir, "predictions.json")
    const harnessUrl = process.env.OPENBUDDY_HARNESS_URL ?? ""
    const harnessToken = process.env.OPENBUDDY_HARNESS_TOKEN ?? ""
    if (!harnessUrl || !harnessToken) {
      const err = new Error("OPENBUDDY_HARNESS_URL and OPENBUDDY_HARNESS_TOKEN are required for openbuddy-agent-harness")
      writeFileSync(join(bridgeDir, "missing-env.json"), JSON.stringify({ error: err.message, modelKind: "openbuddy-agent-harness", runId, timestamp: new Date().toISOString() }, null, 2))
      throw err
    }
    const bridgeOut = join(bridgeDir, "bridge-predictions.json")
    const stderrPath = join(bridgeDir, "bridge.stderr.log")
    harnessBackendPromise = new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [join(process.cwd(), "evals/node/openbuddy_agent_bridge.mjs")],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            OPENBUDDY_HARNESS_URL: harnessUrl,
            OPENBUDDY_HARNESS_TOKEN: harnessToken,
            OPENBUDDY_AGENT_BRIDGE_DATASET: datasetPath,
            OPENBUDDY_AGENT_BRIDGE_OUT: bridgeOut,
            OPENBUDDY_AGENT_BRIDGE_LIMIT: String(limit || 0),
            OPENBUDDY_AGENT_BRIDGE_TIMEOUT_MS: process.env.OPENBUDDY_AGENT_BRIDGE_TIMEOUT_MS ?? "180000",
          },
        },
      )
      const stderrChunks = []
      child.stderr.on("data", (chunk) => {
        stderrChunks.push(chunk)
        process.stderr.write(`[harness-bridge] ${chunk}`)
      })
      child.on("exit", (code) => {
        if (stderrChunks.length > 0) writeFileSync(stderrPath, Buffer.concat(stderrChunks))
        if (code === 0) resolve()
        else reject(new Error(`openbuddy-agent-harness bridge exit ${code}; see ${stderrPath}`))
      })
      child.on("error", reject)
    }).then(async () => {
      const fs = await import("node:fs")
      const raw = fs.readFileSync(bridgeOut, "utf8")
      harnessBackendCache = JSON.parse(raw)
      // Mirror the predictions into the standard predictions.json so the
      // evaluator doesn't need to know about the harness backend layout.
      writeFileSync(predictionsPath, JSON.stringify(harnessBackendCache, null, 2))
      return harnessBackendCache
    })
  }
  return harnessBackendPromise
}

async function callOpenBuddyAgentHarnessModel(testCase) {
  const predictions = await loadHarnessBackendPredictions()
  const match = predictions.find((entry) => entry.id === testCase.id)
  return { actions: match?.actions ?? [] }
}

async function loadAgentBackendPredictions() {
  if (agentBackendCache) return agentBackendCache
  if (!agentBackendPromise) {
    const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR ?? join(process.cwd(), "evidence")
    mkdirSync(evidenceDir, { recursive: true })
    const bridgeDir = join(evidenceDir, "email-ai-quality", runId, "agent-backend")
    mkdirSync(bridgeDir, { recursive: true })
    const predictionsPath = join(bridgeDir, "predictions.json")
    const tmpRoot = process.env.OPENBUDDY_AGENT_TMP_ROOT ?? join(evidenceDir, "email-ai-quality", runId, "tmp")
    mkdirSync(tmpRoot, { recursive: true })
    agentBackendPromise = new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [join(process.cwd(), "node_modules", "vitest", "vitest.mjs"), "run", "--reporter=dot", join(process.cwd(), "evals/node/openbuddy_agent_backend.test.ts")],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            OPENBUDDY_AGENT_BACKEND_OUT: predictionsPath,
            OPENBUDDY_AGENT_DATASET: datasetPath,
            PI_CODING_AGENT_DIR: join(tmpRoot, "pi-agent"),
            VITEST_POOL: "forks",
          },
        },
      )
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`openbuddy-agent vitest exit ${code}`))))
      child.on("error", reject)
    }).then(async () => {
      const fs = await import("node:fs")
      agentBackendCache = JSON.parse(fs.readFileSync(predictionsPath, "utf8"))
      return agentBackendCache
    })
  }
  return agentBackendPromise
}
async function callOpenBuddyAgentModel(testCase) {
  const predictions = await loadAgentBackendPredictions()
  const match = predictions.find((entry) => entry.id === testCase.id)
  return { actions: match?.actions ?? [] }
}

async function callOpenAICompatibleModel(testCase, userPrompt) {
  if (!apiKey) throw new Error("OPENBUDDY_EMAIL_AI_QUALITY_API_KEY is required for non-mock models")
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  })
  if (!response.ok) throw new Error(`model request failed ${response.status}: ${await response.text()}`)
  const payload = await response.json()
  const text = payload?.choices?.[0]?.message?.content
  if (!text) throw new Error("model returned empty content")
  return JSON.parse(text)
}

async function predictCase(testCase) {
  const userPrompt = buildUserPrompt(testCase)
  const start = Date.now()
  try {
    const prediction = modelKind === "mock"
      ? await callMockModel(testCase)
      : modelKind === "openbuddy-agent"
      ? await callOpenBuddyAgentModel(testCase)
      : modelKind === "openbuddy-agent-harness"
      ? await callOpenBuddyAgentHarnessModel(testCase)
      : modelKind === "openbuddy-rules"
      ? await callOpenBuddyRulesModel(testCase)
      : await callOpenAICompatibleModel(testCase, userPrompt)
    return { ok: true, prediction, latencyMs: Date.now() - start }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - start }
  }
}

async function main() {
  const raw = JSON.parse(readFileSync(datasetPath, "utf8"))
  const cases = Array.isArray(raw) ? raw : []
  if (!cases.length) { console.error("dataset is empty"); process.exit(2) }
  const subset = limit > 0 ? cases.slice(0, limit) : cases
  console.error(`[email-ai-blind] running ${subset.length}/${cases.length} cases with model=${modelKind} id=${modelId} run=${runId}`)

  const predictions = []
  const errors = []
  for (const testCase of subset) {
    const result = await predictCase(testCase)
    if (result.ok) {
      predictions.push({ id: testCase.id, actions: result.prediction.actions ?? [] })
    } else {
      errors.push({ id: testCase.id, error: result.error })
      predictions.push({ id: testCase.id, actions: [] })
    }
  }

  const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR ?? join(process.cwd(), "evidence")
  mkdirSync(evidenceDir, { recursive: true })
  const predictionsPath = join(evidenceDir, "email-ai-quality", runId, "predictions.json")
  mkdirSync(dirname(predictionsPath), { recursive: true })
  writeFileSync(predictionsPath, JSON.stringify(predictions, null, 2))
  console.error(`[email-ai-blind] wrote predictions to ${predictionsPath}`)

  const manifest = {
    schema: "openbuddy.email-ai-blind-run.v1",
    runId,
    modelKind,
    modelId,
    apiUrlHash: createHash("sha256").update(apiUrl).digest("hex").slice(0, 12),
    caseCount: subset.length,
    errorCount: errors.length,
    realE2E: modelKind === "openbuddy-agent" || modelKind === "openbuddy-agent-harness" || modelKind === "openbuddy-rules",
    backendNote: modelKind === "openbuddy-agent"
      ? "Drives the real OpenBuddy email capability via @openbuddy/capability-email: extractEmailActionCandidates → Email.saveAnalysis → Email.listAnalyses. No duplicate rules."
      : modelKind === "openbuddy-agent-harness"
      ? "Drives the real OpenBuddy Pi Agent end-to-end through the Electron harness (session.create → email_extract_action_candidates → email_save_analysis → capability.email.analyses). Requires OPENBUDDY_HARNESS_URL and OPENBUDDY_HARNESS_TOKEN."
      : modelKind === "openbuddy-rules"
      ? "Reuses OpenBuddy email capability rules (triage + heuristic action extraction) from packages/capability/openbuddy-email/src/index.ts. No external LLM."
      : undefined,
    errors: errors.slice(0, 5),
    timestamp: new Date().toISOString(),
  }
  writeFileSync(join(dirname(predictionsPath), "manifest.json"), JSON.stringify(manifest, null, 2))

  if (dryRun) {
    console.error("[email-ai-blind] dry-run, skipping evaluator")
    process.exit(0)
  }

  const evaluator = new URL("./evaluate_email_ai_quality.mjs", import.meta.url).pathname
  const child = spawn(process.execPath, [evaluator], {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENBUDDY_EMAIL_AI_QUALITY_DATASET: datasetPath,
      OPENBUDDY_EMAIL_AI_QUALITY_PREDICTIONS: predictionsPath,
      OPENBUDDY_EMAIL_AI_QUALITY_MODEL_ID: modelId,
      OPENBUDDY_EMAIL_AI_QUALITY_RUN_ID: runId,
      OPENBUDDY_EVIDENCE_DIR: join(evidenceDir, "email-ai-quality", runId),
    },
  })
  child.on("exit", (code) => process.exit(code ?? 1))
}

(async () => { await main() })()
