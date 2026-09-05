#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { validateCapabilitySnapshot } from "./validate-new-api-capability-snapshot.mjs";

// `quota` is New API's internal billing unit. Its USD conversion is an
// instance setting and must be read from `/api/status` or supplied explicitly.
// The Worker must never treat `quota` as a fiat currency amount.

export const parseLogOther = (raw) => {
  if (!raw) return undefined;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
};

export const channelFromLog = (log) => {
  if (!log || typeof log !== "object") return undefined;
  const id = log.channel !== undefined && log.channel !== null ? String(log.channel).trim() : "";
  const name = typeof log.channel_name === "string" ? log.channel_name.trim() : "";
  if (!id && !name) return undefined;
  return { ...(id ? { id: id.slice(0, 40) } : {}), ...(name ? { name: name.slice(0, 120) } : {}) };
};

export const cacheFromLog = (log) => {
  const other = parseLogOther(log?.other);
  if (!other || typeof other !== "object") return undefined;
  const ratio = Number(other.cache_ratio);
  const tokens = Number(other.cache_tokens);
  if (!Number.isFinite(ratio) && !Number.isFinite(tokens)) return undefined;
  const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : undefined;
  const safeTokens = Number.isFinite(tokens) && tokens >= 0 ? Math.min(Math.floor(tokens), 1_000_000_000) : undefined;
  if (safeRatio === undefined && safeTokens === undefined) return undefined;
  return { ...(safeRatio !== undefined ? { ratio: safeRatio } : {}), ...(safeTokens !== undefined ? { tokens: safeTokens } : {}) };
};

export const deriveQuotaBasedCost = (log, quotaPerUnit) => {
  if (!log || typeof log !== "object") return undefined;
  const quota = Number(log.quota);
  const unit = Number(quotaPerUnit);
  if (!Number.isFinite(quota) || quota <= 0 || !Number.isFinite(unit) || unit <= 0) return undefined;
  return Number((quota / unit).toFixed(6));
};

export const costFromOther = (value) => {
  if (!value) return undefined;
  const other = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return undefined; } })() : value;
  if (!other || typeof other !== "object" || Array.isArray(other)) return undefined;
  for (const key of ["upstream_cost", "upstreamCost", "cost", "total_cost", "totalCost", "cost_usd"]) {
    const parsed = Number(other[key]);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
};

export const configuredCost = (model, promptTokens, completionTokens, pricing) => {
  if (!pricing || typeof pricing !== "object") return undefined;
  const item = pricing[model] ?? pricing["*"];
  if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
  const inputPerMillion = Number(item.inputPerMillion ?? item.input_per_million);
  const outputPerMillion = Number(item.outputPerMillion ?? item.output_per_million);
  if (!Number.isFinite(inputPerMillion) || inputPerMillion < 0 || !Number.isFinite(outputPerMillion) || outputPerMillion < 0) return undefined;
  return Number(((promptTokens * inputPerMillion + completionTokens * outputPerMillion) / 1_000_000).toFixed(9));
};

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const optional = (name, fallback = "") => process.env[name]?.trim() || fallback;
const number = (value, name) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} is not a non-negative integer`);
  return parsed;
};
const timestamp = (value) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric).toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  throw new Error("log created_at is not a valid timestamp");
};
const text = (value, max = 200) => {
  if (typeof value === "string") return value.trim().slice(0, max);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value).slice(0, max);
  return "";
};

const mappingEntry = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value;
  const tenantId = text(item.tenantId, 120);
  const subject = text(item.subject, 200);
  const group = text(item.group, 120);
  if (!tenantId || !subject) return undefined;
  return { tenantId, subject, ...(group ? { group } : {}) };
};

const mappingGroup = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const tenantId = text(value.tenantId, 120);
  return tenantId ? { tenantId } : undefined;
};

const mappingBucket = (mapping, name) => {
  const value = mapping?.[name];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};

const logUsername = (log) => text(log?.username ?? log?.user_name ?? log?.user, 200);
const logToken = (log) => text(log?.token_id ?? log?.tokenId ?? log?.token, 120);
const logGroup = (log) => text(log?.group ?? log?.group_name ?? log?.groupName ?? log?.token_group, 120);
const logDimension = (log, names, max = 160) => {
  for (const name of names) {
    const value = text(log?.[name], max);
    if (value) return value;
  }
  const other = parseLogOther(log?.other);
  if (other && typeof other === "object") {
    for (const name of names) {
      const value = text(other[name], max);
      if (value) return value;
    }
  }
  return undefined;
};

const resolveIdentity = (mapping, log) => {
  const users = mappingBucket(mapping, "users");
  const tokens = mappingBucket(mapping, "tokens");
  const subjects = mappingBucket(mapping, "subjects");
  const groups = mappingBucket(mapping, "groups");
  const username = logUsername(log);
  const token = logToken(log);
  const group = logGroup(log);
  const subject = logDimension(log, ["subject", "subject_id", "openbuddy_subject", "x_openbuddy_subject"]);
  const legacy = mapping?.[username];
  const tokenIdentity = token ? mappingEntry(tokens[token]) : undefined;
  const userIdentity = mappingEntry(users[username]) ?? mappingEntry(legacy);
  const subjectIdentity = subject ? mappingEntry(subjects[subject]) : undefined;
  const groupIdentity = group ? mappingGroup(groups[group]) : undefined;
  const hasGroupContract = Object.keys(groups).length > 0;
  const hasSubjectContract = Object.keys(subjects).length > 0;

  if (hasGroupContract && !group) return { reason: "missing-group" };
  if (hasGroupContract && !groupIdentity) return { reason: "unknown-group" };
  if (hasSubjectContract && !subject) return { reason: "missing-subject" };
  if (hasSubjectContract && !subjectIdentity) return { reason: "unknown-subject" };
  if (!tokenIdentity && !userIdentity && !subjectIdentity) return { reason: token ? "unknown-token" : subject ? "unknown-subject" : "unknown-user" };

  const identities = [tokenIdentity, userIdentity, subjectIdentity].filter(Boolean);
  if (identities.some((candidate) => candidate.tenantId !== identities[0].tenantId || candidate.subject !== identities[0].subject)) {
    return { reason: "token-user-mismatch" };
  }
  const identity = tokenIdentity ?? userIdentity ?? subjectIdentity;
  if (groupIdentity && groupIdentity.tenantId !== identity.tenantId) return { reason: "group-tenant-mismatch" };
  if (identity.group && group && identity.group !== group) return { reason: "identity-group-mismatch" };
  return { ...identity, ...(group ? { group } : identity.group ? { group: identity.group } : {}) };
};

const summarizeApiError = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  for (const key of ["message", "msg", "error"]) {
    if (typeof body[key] === "string" && body[key].trim()) return body[key].trim().slice(0, 240);
  }
  return undefined;
};

const fetchJson = async (url, init = {}) => {
  const response = await fetch(url, { ...init, headers: { accept: "application/json", ...init.headers } });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    const detail = summarizeApiError(body);
    throw new Error(`${url} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return body;
};

export const buildLogQuery = (page, pageSize, since, until, logType = 2) => new URLSearchParams({
  p: String(page),
  page_size: String(pageSize),
  type: String(logType),
  start_timestamp: String(Math.floor(Date.parse(since) / 1000)),
  end_timestamp: String(Math.floor(Date.parse(until) / 1000)),
});

export const resolveQuotaPerUnit = async (baseUrl, adminHeaders, explicitValue, options = {}) => {
  const explicit = explicitValue === undefined || explicitValue === "" ? undefined : Number(explicitValue);
  if (explicit !== undefined) {
    if (!Number.isFinite(explicit) || explicit <= 0) throw new Error("NEW_API_QUOTA_PER_UNIT must be a positive number");
    if (options.allowExplicitOverride === true) return explicit;
  }
  const status = await fetchJson(`${baseUrl}/api/status`, { headers: adminHeaders });
  const discovered = Number(status?.data?.quota_per_unit);
  if (!Number.isFinite(discovered) || discovered <= 0) throw new Error("New API /api/status did not return a positive data.quota_per_unit; set NEW_API_QUOTA_PER_UNIT explicitly");
  if (explicit !== undefined && explicit !== discovered) throw new Error(`NEW_API_QUOTA_PER_UNIT=${explicit} does not match New API /api/status data.quota_per_unit=${discovered}; set NEW_API_ALLOW_QUOTA_UNIT_OVERRIDE=1 only for an approved migration override`);
  return discovered;
};

const responseItems = (body) => {
  const data = body?.data ?? body;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

const groupNames = (body) => new Set(responseItems(body).flatMap((value) => {
  if (typeof value === "string") return [value.trim()];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const item = value;
  const name = text(item.group ?? item.name ?? item.value, 120);
  return name ? [name] : [];
}));

export const validateMappedGroups = async (baseUrl, adminHeaders, mapping, fetcher = fetchJson) => {
  const groups = mappingBucket(mapping, "groups");
  const expected = Object.keys(groups).filter((name) => /^[a-zA-Z0-9_.:-]{1,120}$/.test(name));
  if (!expected.length) return { checked: 0, missing: [] };
  const actual = groupNames(await fetcher(`${baseUrl}/api/group/`, { headers: adminHeaders }));
  const missing = expected.filter((name) => !actual.has(name));
  if (missing.length) throw new Error(`New API Group mapping contains unknown groups: ${missing.join(",")}`);
  return { checked: expected.length, missing };
};

export const buildAdminHeaders = (accessToken, userId, sessionId = "") => {
  const token = typeof accessToken === "string" ? accessToken.trim() : "";
  const currentUserId = typeof userId === "string" ? userId.trim() : "";
  const session = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!token) throw new Error("NEW_API_ADMIN_ACCESS_TOKEN is required");
  if (!currentUserId) throw new Error("NEW_API_ADMIN_USER_ID is required");
  return {
    authorization: `Bearer ${token}`,
    "new-api-user": currentUserId,
    ...(session ? { "x-auth-session": session } : {}),
  };
};

export const resolveLogWindow = (nowMs, sinceValue, untilValue, windowMinutes = 60) => {
  const sinceInput = typeof sinceValue === "string" ? sinceValue.trim() : "";
  const untilInput = typeof untilValue === "string" ? untilValue.trim() : "";
  if (sinceInput || untilInput) {
    if (!sinceInput || !untilInput) throw new Error("NEW_API_LOG_SINCE and NEW_API_LOG_UNTIL must be provided together");
    if (!Number.isFinite(Date.parse(sinceInput)) || !Number.isFinite(Date.parse(untilInput)) || Date.parse(sinceInput) >= Date.parse(untilInput)) throw new Error("NEW_API_LOG_SINCE/UNTIL must be a valid increasing ISO time range");
    return { since: new Date(sinceInput).toISOString(), until: new Date(untilInput).toISOString() };
  }
  const minutes = Number(windowMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 7 * 24 * 60) throw new Error("NEW_API_LOG_WINDOW_MINUTES must be between 1 and 10080");
  const until = new Date(nowMs);
  const since = new Date(nowMs - Math.floor(minutes * 60_000));
  return { since: since.toISOString(), until: until.toISOString() };
};

export const resolveCheckpointWindow = (nowMs, checkpoint, windowMinutes = 60, overlapMinutes = 10) => {
  const fallback = resolveLogWindow(nowMs, undefined, undefined, windowMinutes);
  const overlap = Number(overlapMinutes);
  if (!Number.isFinite(overlap) || overlap < 0 || overlap > 24 * 60) throw new Error("NEW_API_LOG_OVERLAP_MINUTES must be between 0 and 1440");
  const lastSuccessfulUntil = typeof checkpoint?.lastSuccessfulUntil === "string" && Number.isFinite(Date.parse(checkpoint.lastSuccessfulUntil))
    ? Date.parse(checkpoint.lastSuccessfulUntil)
    : undefined;
  if (lastSuccessfulUntil === undefined) return fallback;
  const until = new Date(nowMs);
  const since = new Date(lastSuccessfulUntil - Math.floor(overlap * 60_000));
  if (since >= until) return fallback;
  return { since: since.toISOString(), until: until.toISOString() };
};

export const readReconciliationCheckpoint = async (file) => {
  if (!file) return undefined;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (!parsed || parsed.schemaVersion !== 1 || typeof parsed.lastSuccessfulUntil !== "string" || !Number.isFinite(Date.parse(parsed.lastSuccessfulUntil))) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
};

export const writeReconciliationCheckpoint = async (file, checkpoint) => {
  if (!file) return;
  const directory = file.slice(0, Math.max(file.lastIndexOf("/"), 0)) || ".";
  await mkdir(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, ...checkpoint })}\n`, { mode: 0o600 });
  await rename(temporary, file);
};

const statusError = (error) => String(error instanceof Error ? error.message : error)
  .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
  .replace(/((?:access[_-]?token|api[_-]?key|secret|password|cookie|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
  .slice(0, 500);

export const writeReconciliationStatus = async (file, status) => {
  if (!file) return;
  const directory = file.slice(0, Math.max(file.lastIndexOf("/"), 0)) || ".";
  await mkdir(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.status.tmp`;
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, ...status })}\n`, { mode: 0o600 });
  await rename(temporary, file);
};

export const readReconciliationStatus = async (file) => {
  if (!file) return undefined;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (!parsed || parsed.schemaVersion !== 1 || typeof parsed.status !== "string") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
};

export const validateReconciliationStatus = (status, options = {}) => {
  if (!status || status.schemaVersion !== 1) throw new Error("reconciliation status is missing or has an unsupported schema");
  if (status.status !== "succeeded") throw new Error(`reconciliation status is ${status.status || "unknown"}`);
  const completedAt = Date.parse(status.completedAt ?? "");
  if (!Number.isFinite(completedAt)) throw new Error("reconciliation status completedAt is invalid");
  const now = Number(options.now ?? Date.now());
  const maxAgeHours = Number(options.maxAgeHours ?? 26);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) throw new Error("reconciliation status max age must be positive");
  if (completedAt > now + 5 * 60 * 1000) throw new Error("reconciliation status completedAt is in the future");
  if (now - completedAt > maxAgeHours * 60 * 60 * 1000) throw new Error(`reconciliation status is older than ${maxAgeHours} hours`);
  return { completedAt: new Date(completedAt).toISOString(), runId: String(status.runId || "") };
};

export const buildRecords = (mapping, pricing, source, currency, logs, quotaPerUnit) => {
  const recordsByTenant = new Map();
  let skipped = 0;
  const skippedReasons = {};
  for (const log of logs) {
    const resolved = resolveIdentity(mapping, log);
    const identity = resolved?.tenantId && resolved?.subject ? resolved : undefined;
    const promptTokens = number(log.prompt_tokens ?? 0, "prompt_tokens");
    const completionTokens = number(log.completion_tokens ?? 0, "completion_tokens");
    const model = String(log.model_name || "unknown").slice(0, 200);
    const reportedCost = costFromOther(log.other);
    const quotaDerivedCost = deriveQuotaBasedCost(log, quotaPerUnit);
    const cost = reportedCost ?? quotaDerivedCost ?? configuredCost(model, promptTokens, completionTokens, pricing);
    if (!identity || cost === undefined) {
      skipped += 1;
      const reason = !identity ? (resolved?.reason ?? "unmapped-identity") : "missing-cost";
      skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
      continue;
    }
    const externalId = String(log.request_id || log.upstream_request_id || log.id || "").trim();
    if (!externalId) {
      skipped += 1;
      skippedReasons["missing-request-id"] = (skippedReasons["missing-request-id"] ?? 0) + 1;
      continue;
    }
    const channel = channelFromLog(log);
    const cache = cacheFromLog(log);
    const agentId = logDimension(log, ["agent_id", "agentId", "openbuddy_agent", "x_openbuddy_agent"]);
    const sessionId = logDimension(log, ["session_id", "sessionId", "openbuddy_session", "x_openbuddy_session"]);
    const walletId = logDimension(log, ["wallet_id", "walletId", "openbuddy_wallet", "x_openbuddy_wallet"]);
    const actorSubject = logDimension(log, ["actor_subject", "actorSubject", "openbuddy_actor", "x_openbuddy_actor"]);
    if (actorSubject && actorSubject !== identity.subject) {
      skipped += 1;
      skippedReasons["actor-subject-mismatch"] = (skippedReasons["actor-subject-mismatch"] ?? 0) + 1;
      continue;
    }
    const record = {
      tenantId: identity.tenantId,
      subject: identity.subject,
      ...(walletId ? { walletId } : {}),
      ...(actorSubject || walletId ? { actorSubject: actorSubject ?? identity.subject } : {}),
      model,
      promptTokens,
      completionTokens,
      upstreamCost: cost,
      currency,
      source,
      externalId,
      importKey: `${source}:${externalId}`,
      usageAt: timestamp(log.created_at),
      ...(log.request_id ? { newApiRequestId: String(log.request_id) } : {}),
      ...(identity.group ? { newApiGroup: identity.group } : {}),
      ...(agentId ? { agentId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(channel ? { channel } : {}),
      ...(cache ? { cache } : {}),
      costBasis: reportedCost !== undefined ? "provider-reported" : quotaDerivedCost !== undefined ? "provider-reported-quota" : "configured-pricing",
    };
    const records = recordsByTenant.get(identity.tenantId) ?? [];
    records.push(record);
    recordsByTenant.set(identity.tenantId, records);
  }
  return { recordsByTenant, skipped, skippedReasons };
};

export const validateReconciliationQuality = (result, writeEnabled) => {
  if (writeEnabled !== true || result?.skipped === 0) return;
  const reasons = Object.entries(result.skippedReasons ?? {}).map(([reason, count]) => `${reason}=${count}`).join(", ");
  throw new Error(`NEW_API_RECONCILIATION_WRITE=1 refuses to advance checkpoint with skipped records (${reasons || "unknown"}); run dry-run, fix tenant/cost/request mappings, then retry`);
};

export const validateFetchedLogWindow = (fetched, total, writeEnabled) => {
  if (writeEnabled !== true || total === undefined || fetched >= total) return;
  throw new Error(`NEW_API_RECONCILIATION_WRITE=1 refuses to advance checkpoint with incomplete pagination (fetched=${fetched}, total=${total}); retry the window`);
};

export const validateCapabilitySnapshotGate = (snapshot, capabilities, options = {}) => {
  const result = validateCapabilitySnapshot(snapshot, {
    now: options.now ?? Date.now(),
    maxAgeHours: options.maxAgeHours ?? 24,
    groups: options.groups ?? [],
    models: options.models ?? [],
    channels: options.channels ?? [],
    capabilities,
  });
  if (options.quotaPerUnit !== undefined && result.quotaPerUnit !== Number(options.quotaPerUnit)) {
    throw new Error(`capability snapshot quotaPerUnit=${result.quotaPerUnit} does not match New API quota_per_unit=${options.quotaPerUnit}`);
  }
  return result;
};

export const importRecords = async (recordsByTenant, gatewayUrl, gatewayAccessToken, importSecret) => {
  let imported = 0;
  let duplicates = 0;
  for (const [tenantId, records] of recordsByTenant) {
    for (let offset = 0; offset < records.length; offset += 1000) {
      const raw = JSON.stringify({ records: records.slice(offset, offset + 1000) });
      const signature = importSecret ? createHmac("sha256", importSecret).update(raw).digest("hex") : undefined;
      const response = await fetchJson(`${gatewayUrl}/v1/tenants/${encodeURIComponent(tenantId)}/credits/reconciliation/import`, { method: "POST", headers: { authorization: `Bearer ${gatewayAccessToken}`, "content-type": "application/json", ...(signature ? { "x-openbuddy-new-api-cost-signature": signature } : {}) }, body: raw });
      imported += Number(response.data?.imported ?? 0);
      duplicates += Number(response.data?.duplicates ?? 0);
    }
  }
  return { imported, duplicates };
};

export const runReconciliation = async () => {
  const baseUrl = required("NEW_API_BASE_URL").replace(/\/$/, "");
  const adminAccessToken = required("NEW_API_ADMIN_ACCESS_TOKEN");
  const adminUserId = required("NEW_API_ADMIN_USER_ID");
  const adminSessionId = optional("NEW_API_ADMIN_SESSION_ID");
  const gatewayUrl = required("OPENBUDDY_GATEWAY_URL").replace(/\/$/, "");
  const gatewayAccessToken = required("OPENBUDDY_GATEWAY_ACCESS_TOKEN");
  const checkpointFile = optional("NEW_API_RECONCILIATION_CHECKPOINT_FILE", "/var/lib/openbuddy/new-api-reconciliation-checkpoint.json");
  const explicitWindow = Boolean(process.env.NEW_API_LOG_SINCE?.trim() || process.env.NEW_API_LOG_UNTIL?.trim());
  const checkpoint = explicitWindow ? undefined : await readReconciliationCheckpoint(checkpointFile);
  const window = explicitWindow
    ? resolveLogWindow(Date.now(), process.env.NEW_API_LOG_SINCE, process.env.NEW_API_LOG_UNTIL, optional("NEW_API_LOG_WINDOW_MINUTES", "60"))
    : resolveCheckpointWindow(Date.now(), checkpoint, optional("NEW_API_LOG_WINDOW_MINUTES", "60"), optional("NEW_API_LOG_OVERLAP_MINUTES", "10"));
  const since = window.since;
  const until = window.until;
  const mappingSource = required("NEW_API_TENANT_SUBJECT_MAP_JSON");
  const writeEnabled = optional("NEW_API_RECONCILIATION_WRITE", "0");
  const pageSize = Math.min(100, Math.max(1, Number(optional("NEW_API_LOG_PAGE_SIZE", "100")) || 100));
  const source = optional("NEW_API_COST_SOURCE", "new-api-log");
  const importSecret = optional("RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET");
  const currency = optional("NEW_API_COST_CURRENCY", "USD").toUpperCase();
  const pricingSource = optional("NEW_API_PRICING_JSON");
  const strictMapping = optional("NEW_API_STRICT_TENANT_MAPPING", writeEnabled === "1" ? "1" : "0");
  const validateGroups = optional("NEW_API_VALIDATE_GROUPS", writeEnabled === "1" ? "1" : "0");
  const allowQuotaUnitOverride = optional("NEW_API_ALLOW_QUOTA_UNIT_OVERRIDE", "0");
  const capabilitySnapshotFile = optional("NEW_API_CAPABILITY_SNAPSHOT_FILE");
  const capabilityDirectorySource = optional("NEW_API_CAPABILITIES_JSON");
  const capabilityMaxAgeHours = Number(optional("NEW_API_CAPABILITY_MAX_AGE_HOURS", "24"));
  const expectedCapabilityGroups = optional("NEW_API_EXPECTED_GROUPS").split(",").map((value) => value.trim()).filter(Boolean);
  const expectedCapabilityModels = optional("NEW_API_EXPECTED_MODELS").split(",").map((value) => value.trim()).filter(Boolean);
  const expectedCapabilityChannels = optional("NEW_API_EXPECTED_CHANNELS").split(",").map((value) => value.trim()).filter(Boolean);

  if (writeEnabled !== "0" && writeEnabled !== "1") throw new Error("NEW_API_RECONCILIATION_WRITE must be 0 or 1");
  if (writeEnabled === "1" && !importSecret) throw new Error("RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET is required when NEW_API_RECONCILIATION_WRITE=1");
  if (strictMapping !== "0" && strictMapping !== "1") throw new Error("NEW_API_STRICT_TENANT_MAPPING must be 0 or 1");
  if (validateGroups !== "0" && validateGroups !== "1") throw new Error("NEW_API_VALIDATE_GROUPS must be 0 or 1");
  if (allowQuotaUnitOverride !== "0" && allowQuotaUnitOverride !== "1") throw new Error("NEW_API_ALLOW_QUOTA_UNIT_OVERRIDE must be 0 or 1");
  if (!Number.isFinite(capabilityMaxAgeHours) || capabilityMaxAgeHours <= 0 || capabilityMaxAgeHours > 8760) throw new Error("NEW_API_CAPABILITY_MAX_AGE_HOURS must be between 0 and 8760");
  if (writeEnabled === "1" && (!capabilitySnapshotFile || !capabilityDirectorySource)) throw new Error("NEW_API_CAPABILITY_SNAPSHOT_FILE and NEW_API_CAPABILITIES_JSON are required when NEW_API_RECONCILIATION_WRITE=1");
  const mapping = JSON.parse(mappingSource.startsWith("@") ? await readFile(mappingSource.slice(1), "utf8") : mappingSource);
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error("NEW_API_TENANT_SUBJECT_MAP_JSON must be an object");
  if (strictMapping === "1" && Object.keys(mappingBucket(mapping, "groups")).length === 0) throw new Error("NEW_API_STRICT_TENANT_MAPPING=1 requires a non-empty groups mapping");
  const pricing = pricingSource ? JSON.parse(pricingSource.startsWith("@") ? await readFile(pricingSource.slice(1), "utf8") : pricingSource) : {};
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) throw new Error("NEW_API_PRICING_JSON must be an object");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("NEW_API_COST_CURRENCY must be an ISO 4217 currency");

  const adminHeaders = buildAdminHeaders(adminAccessToken, adminUserId, adminSessionId);
  const quotaPerUnit = await resolveQuotaPerUnit(baseUrl, adminHeaders, process.env.NEW_API_QUOTA_PER_UNIT?.trim(), { allowExplicitOverride: allowQuotaUnitOverride === "1" });
  const groupValidation = validateGroups === "1" ? await validateMappedGroups(baseUrl, adminHeaders, mapping) : { checked: 0, missing: [] };
  let capabilityValidation;
  if (capabilitySnapshotFile) {
    const snapshot = JSON.parse(await readFile(capabilitySnapshotFile, "utf8"));
    const capabilityRaw = capabilityDirectorySource?.startsWith("@")
      ? await readFile(capabilityDirectorySource.slice(1), "utf8")
      : capabilityDirectorySource;
    if (!capabilityRaw) throw new Error("NEW_API_CAPABILITIES_JSON is required when a capability snapshot is configured");
    capabilityValidation = validateCapabilitySnapshotGate(snapshot, JSON.parse(capabilityRaw), {
      quotaPerUnit,
      maxAgeHours: capabilityMaxAgeHours,
      groups: expectedCapabilityGroups,
      models: expectedCapabilityModels,
      channels: expectedCapabilityChannels,
    });
  }

  const recordsByTenant = new Map();
  let fetched = 0;
  let skipped = 0;
  let total = undefined;
  const logs = [];
  let page = 1;
  while (total === undefined || fetched < total) {
    const params = buildLogQuery(page, pageSize, since, until);
    const body = await fetchJson(`${baseUrl}/api/log/?${params}`, { headers: adminHeaders });
    const data = body.data ?? {};
    const items = Array.isArray(data.items) ? data.items : [];
    total = Number.isFinite(Number(data.total)) ? Number(data.total) : fetched + items.length;
    if (!items.length) break;
    logs.push(...items);
    fetched += items.length;
    if (items.length < pageSize) break;
    page += 1;
  }
  validateFetchedLogWindow(fetched, total, writeEnabled === "1");
  const built = buildRecords(mapping, pricing, source, currency, logs, quotaPerUnit);
  skipped += built.skipped;
  validateReconciliationQuality(built, writeEnabled === "1");
  let imported = 0;
  let duplicates = 0;
  let checkpointUpdated = false;
  if (writeEnabled === "1") {
    const importedStats = await importRecords(built.recordsByTenant, gatewayUrl, gatewayAccessToken, importSecret);
    imported = importedStats.imported;
    duplicates = importedStats.duplicates;
    if (!explicitWindow) {
      await writeReconciliationCheckpoint(checkpointFile, {
        runId: `reconciliation-${Date.now().toString(36)}`,
        lastSuccessfulSince: since,
        lastSuccessfulUntil: until,
        completedAt: new Date().toISOString(),
        fetched,
        eligible: [...built.recordsByTenant.values()].reduce((sum, records) => sum + records.length, 0),
        skipped,
        imported,
        duplicates,
        quotaPerUnit,
      });
      checkpointUpdated = true;
    }
  }
  return { fetched, since, until, eligible: [...built.recordsByTenant.values()].reduce((sum, records) => sum + records.length, 0), skipped, skippedReasons: built.skippedReasons, tenants: built.recordsByTenant.size, quotaPerUnit, quotaUnitOverride: allowQuotaUnitOverride === "1", groupValidation, capabilityValidation: capabilityValidation ? { generatedAt: capabilityValidation.generatedAt, groups: capabilityValidation.groups, models: capabilityValidation.models, channels: capabilityValidation.channels } : undefined, strictMapping: strictMapping === "1", writeEnabled: writeEnabled === "1", checkpointFile, checkpointUpdated, imported, duplicates };
};

export const main = async () => {
  const statusFile = optional("NEW_API_RECONCILIATION_STATUS_FILE", "/var/lib/openbuddy/new-api-reconciliation-status.json");
  const runId = `reconciliation-${Date.now().toString(36)}-${process.pid}`;
  const startedAt = new Date().toISOString();
  await writeReconciliationStatus(statusFile, { runId, status: "running", startedAt, pid: process.pid });
  try {
    const summary = await runReconciliation();
    const completedAt = new Date().toISOString();
    await writeReconciliationStatus(statusFile, { runId, status: "succeeded", startedAt, completedAt, ...summary });
    console.log(JSON.stringify({ ...summary, runId, statusFile, status: "succeeded" }));
    return summary;
  } catch (error) {
    try {
      await writeReconciliationStatus(statusFile, { runId, status: "failed", startedAt, completedAt: new Date().toISOString(), error: statusError(error) });
    } catch {
    }
    throw error;
  }
};

if (process.argv[1] && process.argv[1].endsWith("new-api-reconciliation-worker.mjs")) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
