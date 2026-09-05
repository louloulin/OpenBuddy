#!/usr/bin/env node

import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const text = (value) => typeof value === "string" ? value.trim() : "";

export const parseTenantIds = (value) => {
  const parsed = Array.isArray(value) ? value : typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 500) throw new Error("CREDIT_EXPIRY_TENANT_IDS must contain 1-500 tenant ids");
  const tenantIds = [...new Set(parsed.filter((tenantId) => typeof tenantId === "string").map((tenantId) => tenantId.trim()))].sort();
  if (tenantIds.length !== parsed.length || tenantIds.some((tenantId) => !/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId))) throw new Error("CREDIT_EXPIRY_TENANT_IDS contains invalid or duplicate tenant ids");
  return tenantIds;
};

export const expirySignature = (secret, timestamp, raw) => createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");

export const writeJsonAtomic = async (file, value) => {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, file);
};

export const runCreditExpiry = async ({ gatewayUrl, secret, tenantIds, requestId = `credit-expiry-${Date.now().toString(36)}-${process.pid}`, fetchImpl = fetch, now = Date.now(), timeoutMs = 30_000 } = {}) => {
  const baseUrl = text(gatewayUrl);
  const signingSecret = text(secret);
  if (!baseUrl) throw new Error("OPENBUDDY_GATEWAY_URL is required");
  if (!signingSecret || signingSecret.length < 32) throw new Error("RESOURCE_GATEWAY_CREDIT_EXPIRY_SECRET must be at least 32 characters");
  if (!/^[a-zA-Z0-9_.:-]{8,160}$/.test(requestId)) throw new Error("credit expiry request id is invalid");
  const normalizedTenants = parseTenantIds(tenantIds);
  const payload = JSON.stringify({ tenantIds: normalizedTenants });
  const timestamp = String(now);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("credit expiry request timed out")), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/internal/v1/credits/expire`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": requestId,
        "x-openbuddy-credit-expiry-timestamp": timestamp,
        "x-openbuddy-credit-expiry-signature": expirySignature(signingSecret, timestamp, payload),
      },
      body: payload,
    });
    const responseText = await response.text();
    let body;
    try { body = responseText ? JSON.parse(responseText) : {}; } catch { body = { raw: responseText.slice(0, 500) }; }
    if (!response.ok) throw new Error(`credit expiry gateway returned ${response.status}: ${JSON.stringify(body)}`);
    return { status: "succeeded", requestId, tenantIds: normalizedTenants, response: body };
  } finally {
    clearTimeout(timer);
  }
};

export const main = async () => {
  const tenantsInput = text(process.env.CREDIT_EXPIRY_TENANT_IDS);
  if (!tenantsInput) throw new Error("CREDIT_EXPIRY_TENANT_IDS is required; refusing an unbounded tenant scan");
  const statusFile = text(process.env.CREDIT_EXPIRY_STATUS_FILE) || "/var/lib/openbuddy/credit-expiry-status.json";
  const startedAt = new Date().toISOString();
  const requestId = `credit-expiry-${Date.now().toString(36)}-${process.pid}`;
  await writeJsonAtomic(statusFile, { schemaVersion: 1, status: "running", requestId, startedAt });
  try {
    const result = await runCreditExpiry({ gatewayUrl: process.env.OPENBUDDY_GATEWAY_URL, secret: process.env.RESOURCE_GATEWAY_CREDIT_EXPIRY_SECRET, tenantIds: tenantsInput, requestId });
    await writeJsonAtomic(statusFile, { schemaVersion: 1, ...result, startedAt, completedAt: new Date().toISOString() });
    process.stdout.write(`${JSON.stringify({ ...result, statusFile })}\n`);
    return result;
  } catch (error) {
    await writeJsonAtomic(statusFile, { schemaVersion: 1, status: "failed", requestId, startedAt, completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
};

if (process.argv[1]?.endsWith("credit-expiry-worker.mjs")) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
