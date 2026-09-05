import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SessionCatalog, SessionCatalogRecord } from "../sqlite/session-catalog";
import { isMissingSource, legacySourceError } from "./legacy-errors";

export interface PiSessionCatalogOptions {
  sessionsRoot: string;
  stateFile?: string;
  includeArchived?: boolean;
}

export interface PiSessionImportResult {
  imported: number;
  skipped: number;
  parseErrors: number;
  sourceFiles: number;
}

interface PiState {
  pinned: string[] | Record<string, unknown>;
  archived: string[] | Record<string, unknown>;
  experts: Record<string, unknown>;
}

interface JsonObject {
  [key: string]: unknown;
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function hasFlag(value: string[] | Record<string, unknown> | undefined, id: string): boolean {
  if (Array.isArray(value)) return value.includes(id);
  return value ? value[id] === true : false;
}

function asIso(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return undefined;
}

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
}

function sessionDirectoryCandidates(sessionsRoot: string, cwd: string): string[] {
  const canonical = join(sessionsRoot, encodeCwd(cwd));
  const legacy = join(sessionsRoot, cwd.replace(/\//g, "-"));
  return canonical === legacy ? [canonical] : [canonical, legacy];
}

async function readState(path: string | undefined): Promise<PiState> {
  if (!path) return { pinned: [], archived: [], experts: {} };
  try {
    const value = asObject(JSON.parse(await readFile(path, "utf8")));
    return {
      pinned: (value?.pinned as PiState["pinned"]) ?? [],
      archived: (value?.archived as PiState["archived"]) ?? [],
      experts: asObject(value?.experts) ?? {},
    };
  } catch (error) {
    if (isMissingSource(error)) return { pinned: [], archived: [], experts: {} };
    throw legacySourceError("Pi state", path, error);
  }
}

async function jsonlFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const file = join(root, entry.name);
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      try {
        if ((await stat(file)).isDirectory()) files.push(...await jsonlFiles(file));
      } catch (error) {
        if (!isMissingSource(error)) throw error;
      }
    }
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(file);
  }
  return files;
}

export class PiSessionCatalogAdapter {
  constructor(private readonly catalog: SessionCatalog) {}

  async importSession(sessionId: string, options: PiSessionCatalogOptions): Promise<PiSessionImportResult> {
    let sources: string[];
    try {
      sources = await jsonlFiles(options.sessionsRoot);
    } catch (error) {
      if (!isMissingSource(error)) throw legacySourceError("Pi sessions", options.sessionsRoot, error);
      return { imported: 0, skipped: 0, parseErrors: 0, sourceFiles: 0 };
    }
    for (const sourcePath of sources) {
      let raw: string;
      try { raw = await readFile(sourcePath, "utf8"); }
      catch (error) {
        if (isMissingSource(error)) continue;
        throw legacySourceError("Pi session file", sourcePath, error);
      }
      const firstLine = raw.split(/\r?\n/, 1)[0];
      let header: JsonObject | undefined;
      try { header = asObject(firstLine ? JSON.parse(firstLine) : undefined); } catch { continue; }
      if (header?.id !== sessionId && sourcePath.split("/").pop()?.replace(/\.jsonl$/, "") !== sessionId && !sourcePath.includes(sessionId)) continue;
      const workspaceCwd = typeof header?.cwd === "string" && header.cwd.trim() ? header.cwd : options.sessionsRoot;
      return this.importFile(sourcePath, workspaceCwd, options);
    }
    return { imported: 0, skipped: 0, parseErrors: 0, sourceFiles: 0 };
  }

  private async importFile(sourcePath: string, workspaceCwd: string, options: PiSessionCatalogOptions): Promise<PiSessionImportResult> {
    const raw = await readFile(sourcePath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const header = asObject(lines[0] ? JSON.parse(lines[0]) : undefined);
    if (!header) return { imported: 0, skipped: 0, parseErrors: 1, sourceFiles: 1 };
    let messageCount = 0;
    for (const line of lines.slice(1)) {
      try { if (asObject(JSON.parse(line))?.type === "message") messageCount += 1; } catch { }
    }
    const sessionId = typeof header.id === "string" ? header.id : sourcePath.split("/").pop()?.replace(/\.jsonl$/u, "") ?? sourcePath;
    const state = await readState(options.stateFile);
    const archived = hasFlag(state.archived, sessionId);
    const expert = asObject(state.experts[sessionId]);
    const expertId = typeof state.experts[sessionId] === "string" ? state.experts[sessionId] as string : typeof expert?.expertId === "string" ? expert.expertId : undefined;
    this.catalog.upsert({
      sessionId, workspaceCwd, sourcePath, sourceHash: createHash("sha256").update(raw).digest("hex"),
      title: typeof header.name === "string" ? header.name : undefined,
      createdAt: asIso(header.createdAt ?? header.timestamp), updatedAt: asIso(header.updatedAt ?? header.timestamp ?? header.createdAt),
      messageCount, pinned: hasFlag(state.pinned, sessionId), archived, expertId,
      expertMetadata: expert ?? (expertId ? { expertId } : undefined), metadata: { source: "pi-jsonl", header },
    });
    return { imported: 1, skipped: 0, parseErrors: 0, sourceFiles: 1 };
  }

  async importWorkspace(workspaceCwd: string, options: PiSessionCatalogOptions): Promise<PiSessionImportResult> {
    const state = await readState(options.stateFile);
    let directory: string | undefined;
    let files: string[] = [];
    for (const candidate of sessionDirectoryCandidates(options.sessionsRoot, workspaceCwd)) {
      try {
        files = (await readdir(candidate)).filter((file) => file.endsWith(".jsonl"));
        directory = candidate;
        break;
      } catch (error) {
        if (!isMissingSource(error)) throw legacySourceError("Pi workspace", candidate, error);
      }
    }
    if (!directory) return { imported: 0, skipped: 0, parseErrors: 0, sourceFiles: 0 };
    const result: PiSessionImportResult = { imported: 0, skipped: 0, parseErrors: 0, sourceFiles: files.length };
    for (const file of files) {
      const sourcePath = join(directory, file);
      let raw: string;
      try {
        raw = await readFile(sourcePath, "utf8");
      } catch (error) {
        if (!isMissingSource(error)) throw legacySourceError("Pi session file", sourcePath, error);
        result.skipped += 1;
        continue;
      }
      const lines = raw.split(/\r?\n/).filter(Boolean);
      let header: JsonObject | undefined;
      try {
        header = asObject(lines[0] ? JSON.parse(lines[0]) : undefined);
      } catch {
        result.parseErrors += 1;
      }
      if (!header) {
        continue;
      }
      let messageCount = 0;
      for (const line of lines.slice(1)) {
        try {
          if (asObject(JSON.parse(line))?.type === "message") messageCount += 1;
        } catch {
          result.parseErrors += 1;
        }
      }
      const sessionId = typeof header.id === "string" ? header.id : file.replace(/\.jsonl$/, "");
      const archived = hasFlag(state.archived, sessionId);
      if (archived && !options.includeArchived) {
        result.skipped += 1;
        continue;
      }
      const expert = asObject(state.experts[sessionId]);
      const expertId = typeof state.experts[sessionId] === "string"
        ? state.experts[sessionId] as string
        : typeof expert?.expertId === "string" ? expert.expertId : undefined;
      const record: SessionCatalogRecord = {
        sessionId,
        workspaceCwd,
        sourcePath,
        sourceHash: createHash("sha256").update(raw).digest("hex"),
        title: typeof header.name === "string" ? header.name : undefined,
        createdAt: asIso(header.createdAt ?? header.timestamp),
        updatedAt: asIso(header.updatedAt ?? header.timestamp ?? header.createdAt),
        messageCount,
        pinned: hasFlag(state.pinned, sessionId),
        archived,
        expertId,
        expertMetadata: expert ?? (expertId ? { expertId } : undefined),
        metadata: { source: "pi-jsonl", header },
      };
      this.catalog.upsert(record);
      result.imported += 1;
    }
    return result;
  }
}
