#!/usr/bin/env node
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { URL } from "node:url";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const optional = (name, fallback = "") => process.env[name]?.trim() || fallback;

const safeBaseUrl = (value) => {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("NEW_API_BASE_URL must be a clean HTTP(S) URL");
  return url.toString().replace(/\/+$/, "");
};

const buildAdminHeaders = (accessToken, userId, sessionId = "") => {
  if (!accessToken?.trim()) throw new Error("NEW_API_ADMIN_ACCESS_TOKEN is required");
  if (!userId?.trim()) throw new Error("NEW_API_ADMIN_USER_ID is required");
  return {
    accept: "application/json",
    authorization: `Bearer ${accessToken.trim()}`,
    "new-api-user": userId.trim(),
    ...(sessionId?.trim() ? { "x-auth-session": sessionId.trim() } : {}),
  };
};

const fetchJson = async (url, headers) => {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  if (body?.success === false) throw new Error(`${url} returned an unsuccessful response`);
  return body;
};

const dataOf = (body) => body?.data ?? body;

const itemsOf = (body) => {
  const data = dataOf(body);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

const textOf = (value, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";

const idOf = (value) => {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return textOf(value, 120);
};

const normalizeGroups = (body) => itemsOf(body).flatMap((item) => {
  if (typeof item === "string") return [{ name: item.trim().slice(0, 120) }].filter((entry) => entry.name);
  if (!item || typeof item !== "object") return [];
  const value = item;
  const name = textOf(value.name ?? value.key ?? value.group ?? value.value, 120);
  return name ? [{ name }] : [];
});

const normalizeChannels = (body) => itemsOf(body).flatMap((item) => {
  if (!item || typeof item !== "object") return [];
  const value = item;
  const id = idOf(value.id ?? value.channel_id);
  const name = textOf(value.name ?? value.channel_name ?? value.key, 160);
  if (!id && !name) return [];
  const models = (Array.isArray(value.models) ? value.models : typeof value.models === "string" ? value.models.split(",") : [])
    .map((model) => textOf(model, 160)).filter(Boolean).slice(0, 256);
  return [{
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(textOf(value.type ?? value.type_name, 80) ? { type: textOf(value.type ?? value.type_name, 80) } : {}),
    ...(textOf(value.group ?? value.group_name, 120) ? { group: textOf(value.group ?? value.group_name, 120) } : {}),
    ...(typeof value.status === "number" || typeof value.status === "string" ? { status: value.status } : {}),
    models,
  }];
});

const modelsFromChannels = (channels) => [...new Set(channels.flatMap((channel) => channel.models ?? []))].map((id) => ({ id, source: "channel" }));

const normalizeModels = (body) => itemsOf(body).flatMap((item) => {
  if (typeof item === "string") return [{ id: item.trim().slice(0, 160) }].filter((entry) => entry.id);
  if (!item || typeof item !== "object") return [];
  const id = textOf(item.id ?? item.model_name ?? item.name, 160);
  return id ? [{ id, ...(textOf(item.name, 160) ? { name: textOf(item.name, 160) } : {}) }] : [];
});

const parseExpected = (value) => [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))].slice(0, 256);

export const evaluateExpected = (snapshot, expected = {}) => {
  const checks = [];
  const groups = new Set(snapshot.groups.map((entry) => entry.name));
  const models = new Set(snapshot.models.map((entry) => entry.id));
  const channels = new Set(snapshot.channels.map((entry) => entry.id || entry.name));
  for (const [kind, values, actual] of [["group", expected.groups ?? [], groups], ["model", expected.models ?? [], models], ["channel", expected.channels ?? [], channels]]) {
    for (const value of values) checks.push({ kind, value, ok: actual.has(value), ...(actual.has(value) ? {} : { reason: `${kind} not found` }) });
  }
  return checks;
};

export const buildSnapshot = async ({ baseUrl, headers, includeLogStats = false, expected = {}, fetcher = fetchJson }) => {
  const [statusBody, groupsBody, channelsBody, modelsBody] = await Promise.all([
    fetcher(`${baseUrl}/api/status`, headers),
    fetcher(`${baseUrl}/api/group/`, headers),
    fetcher(`${baseUrl}/api/channel/`, headers),
    fetcher(`${baseUrl}/api/models/`, headers),
  ]);
  const status = dataOf(statusBody);
  const snapshot = {
    schema: "openbuddy.new-api-capability-snapshot.v1",
    generatedAt: new Date().toISOString(),
    status: {
      ...(textOf(status?.version, 80) ? { version: textOf(status.version, 80) } : {}),
      ...(Number.isFinite(Number(status?.quota_per_unit)) && Number(status.quota_per_unit) > 0 ? { quotaPerUnit: Number(status.quota_per_unit) } : {}),
      ...(typeof status?.oidc_enabled === "boolean" ? { oidcEnabled: status.oidc_enabled } : {}),
      ...(typeof status?.wechat_login === "boolean" ? { wechatLogin: status.wechat_login } : {}),
    },
    groups: normalizeGroups(groupsBody),
    channels: normalizeChannels(channelsBody),
    models: (() => {
      const managementModels = normalizeModels(modelsBody).map((model) => ({ ...model, source: "model-management" }));
      const known = new Set(managementModels.map((model) => model.id));
      return [...managementModels, ...modelsFromChannels(normalizeChannels(channelsBody)).filter((model) => !known.has(model.id))];
    })(),
  };
  if (includeLogStats) {
    const logStatsBody = await fetcher(`${baseUrl}/api/log/stat`, headers);
    const logStats = dataOf(logStatsBody);
    snapshot.logStats = logStats && typeof logStats === "object" && !Array.isArray(logStats)
      ? { keys: Object.keys(logStats).filter((key) => /^[a-zA-Z0-9_.:-]{1,80}$/.test(key)).slice(0, 128) }
      : { keys: [] };
  }
  snapshot.checks = evaluateExpected(snapshot, expected);
  return snapshot;
};

export const writeSnapshotAtomic = async (file, snapshot) => {
  const directory = dirname(file);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

export const main = async () => {
  const baseUrl = safeBaseUrl(required("NEW_API_BASE_URL"));
  const headers = buildAdminHeaders(required("NEW_API_ADMIN_ACCESS_TOKEN"), required("NEW_API_ADMIN_USER_ID"), optional("NEW_API_ADMIN_SESSION_ID"));
  const snapshot = await buildSnapshot({
    baseUrl,
    headers,
    includeLogStats: optional("NEW_API_CAPABILITY_INCLUDE_LOG_STATS", "0") === "1",
    expected: {
      groups: parseExpected(optional("NEW_API_EXPECTED_GROUPS")),
      models: parseExpected(optional("NEW_API_EXPECTED_MODELS")),
      channels: parseExpected(optional("NEW_API_EXPECTED_CHANNELS")),
    },
  });
  const failed = snapshot.checks.filter((check) => !check.ok);
  const outputPath = optional("NEW_API_CAPABILITY_SNAPSHOT_OUTPUT");
  if (outputPath && failed.length === 0) await writeSnapshotAtomic(outputPath, snapshot);
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  if (failed.length) process.exitCode = 2;
};

if (process.argv[1] && process.argv[1].endsWith("new-api-capability-snapshot.mjs")) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  });
}
