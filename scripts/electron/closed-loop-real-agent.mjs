#!/usr/bin/env node
/**
 * Real-agent end-to-end probe. Optional companion to the closed-loop harness.
 *
 * Requires:
 *   OPENBUDDY_HARNESS_URL  (e.g. http://127.0.0.1:42183)
 *   OPENBUDDY_HARNESS_TOKEN
 *   OPENBUDDY_E2E_API_KEY
 *   OPENBUDDY_E2E_BASE_URL
 *   OPENBUDDY_E2E_MODEL_ID
 *
 * Talks the real Pi HTTP / WebSocket surface (no mocks). Writes evidence to
 * the caller-provided outDir.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, text };
  }
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, text };
  }
}

export async function runRealAgentEval({ outDir }) {
  const startedAt = new Date().toISOString();
  const base = process.env.OPENBUDDY_HARNESS_URL.replace(/\/$/, "");
  const token = process.env.OPENBUDDY_HARNESS_TOKEN;
  const headers = { authorization: `Bearer ${token}` };

  const checks = {};

  // 1. Server reachable
  try {
    const res = await getJson(`${base}/v1/health`, headers);
    checks.health = { status: res.status, body: res.json ?? res.text };
  } catch (error) {
    checks.health = { error: String(error) };
  }

  // 2. List models (real provider)
  try {
    const res = await getJson(`${base}/v1/models`, headers);
    const models = Array.isArray(res.json?.data) ? res.json.data.length : 0;
    checks.models = { status: res.status, count: models };
  } catch (error) {
    checks.models = { error: String(error) };
  }

  // 3. Real chat completion (no mock)
  try {
    const res = await postJson(`${base}/v1/chat/completions`, headers, {
      model: process.env.OPENBUDDY_E2E_MODEL_ID,
      messages: [
        { role: "system", content: "Reply with one short sentence." },
        { role: "user", content: "OpenBuddy closed-loop probe. Acknowledge with the model name." },
      ],
      max_tokens: 64,
    });
    checks.chat = {
      status: res.status,
      choice: res.json?.choices?.[0]?.message?.content ?? null,
      usage: res.json?.usage ?? null,
    };
  } catch (error) {
    checks.chat = { error: String(error) };
  }

  const finishedAt = new Date().toISOString();
  const result = {
    schema: "openbuddy.real-agent-probe.v1",
    startedAt,
    finishedAt,
    model: process.env.OPENBUDDY_E2E_MODEL_ID,
    baseUrl: process.env.OPENBUDDY_E2E_BASE_URL,
    pass: checks.chat?.status === 200 && Boolean(checks.chat?.choice),
    checks,
  };

  await writeFile(join(outDir, "real-agent-probe.json"), JSON.stringify(result, null, 2));
  return result;
}
