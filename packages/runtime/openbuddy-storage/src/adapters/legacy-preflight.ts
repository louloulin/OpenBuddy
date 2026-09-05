import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { errorCode } from "./legacy-errors";

export type LegacySourceKind = "json" | "jsonl" | "markdown" | "pi-session";

export interface LegacyPreflightSource {
  path: string;
  kind: LegacySourceKind;
  label?: string;
}

export interface LegacyPreflightSecretRisk {
  detected: boolean;
  matches: number;
}

export interface LegacyPreflightRecord {
  path: string;
  label?: string;
  kind: LegacySourceKind;
  status: "read" | "missing" | "error";
  bytes: number;
  sha256?: string;
  lineCount: number;
  recordCount: number;
  parseErrors: number;
  secretRisk: LegacyPreflightSecretRisk;
  issues: readonly string[];
}

export interface LegacyPreflightReport {
  schema: "openbuddy.storage-legacy-preflight.v1";
  sources: readonly LegacyPreflightRecord[];
}

const sensitiveKey = /^(?:api.?key|access.?token|refresh.?token|authorization|password|client.?secret|secret|credential|token|cookie)$/iu;
const sensitiveValue = /(?:bearer\s+|api[_-]?key\s*[=:]|access[_-]?token\s*[=:]|refresh[_-]?token\s*[=:]|client[_-]?secret\s*[=:]|secret\s*[=:])/iu;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function countSecretRisk(value: unknown, key?: string): number {
  if (key && sensitiveKey.test(key)) return 1;
  if (typeof value === "string") return sensitiveValue.test(value) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((count, item) => count + countSecretRisk(item), 0);
  if (isObject(value)) return Object.entries(value).reduce((count, [entryKey, entryValue]) => count + countSecretRisk(entryValue, entryKey), 0);
  return 0;
}

function hash(raw: Buffer): string {
  return createHash("sha256").update(raw).digest("hex");
}

function errorIssue(error: unknown): string {
  const code = errorCode(error);
  return code ? `read:${code}` : "read:unknown";
}

function emptyRecord(source: LegacyPreflightSource): LegacyPreflightRecord {
  return {
    path: source.path,
    ...(source.label ? { label: source.label } : {}),
    kind: source.kind,
    status: "read",
    bytes: 0,
    lineCount: 0,
    recordCount: 0,
    parseErrors: 0,
    secretRisk: { detected: false, matches: 0 },
    issues: [],
  };
}

function inspectJson(raw: string, record: LegacyPreflightRecord): void {
  try {
    const value: unknown = JSON.parse(raw);
    record.recordCount = 1;
    record.secretRisk.matches = countSecretRisk(value);
  } catch {
    record.parseErrors = 1;
    record.issues = ["parse:invalid-json"];
  }
}

function inspectJsonl(raw: string, record: LegacyPreflightRecord): void {
  const lines = raw.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  record.lineCount = lines.length;
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line);
      record.recordCount += 1;
      record.secretRisk.matches += countSecretRisk(value);
    } catch {
      record.parseErrors += 1;
    }
  }
  if (record.parseErrors > 0) record.issues = [`parse:invalid-jsonl:${record.parseErrors}`];
}

function inspectMarkdown(raw: string, record: LegacyPreflightRecord): void {
  record.lineCount = raw.length === 0 ? 0 : raw.split(/\r?\n/u).length;
  record.recordCount = raw.length > 0 ? 1 : 0;
  record.secretRisk.matches = countSecretRisk(raw);
}

export async function preflightLegacySource(source: LegacyPreflightSource): Promise<LegacyPreflightRecord> {
  const record = emptyRecord(source);
  let raw: Buffer;
  try {
    raw = await readFile(source.path);
  } catch (error) {
    return { ...record, status: errorCode(error) === "ENOENT" ? "missing" : "error", issues: [errorIssue(error)] };
  }

  record.bytes = raw.byteLength;
  record.sha256 = hash(raw);
  const text = raw.toString("utf8");
  if (source.kind === "json") inspectJson(text, record);
  else if (source.kind === "markdown") inspectMarkdown(text, record);
  else inspectJsonl(text, record);
  record.secretRisk = { detected: record.secretRisk.matches > 0, matches: record.secretRisk.matches };
  return record;
}

export async function preflightLegacySources(sources: readonly LegacyPreflightSource[]): Promise<LegacyPreflightReport> {
  const records = await Promise.all(sources.map((source) => preflightLegacySource(source)));
  return { schema: "openbuddy.storage-legacy-preflight.v1", sources: records };
}

export class LegacySourcePreflight {
  async inspect(source: LegacyPreflightSource): Promise<LegacyPreflightRecord> {
    return preflightLegacySource(source);
  }

  async inspectAll(sources: readonly LegacyPreflightSource[]): Promise<LegacyPreflightReport> {
    return preflightLegacySources(sources);
  }
}
