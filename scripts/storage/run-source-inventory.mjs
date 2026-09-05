import { statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";

const home = homedir();
const roots = [
  { source: "codex", path: process.env.CODEX_SQLITE_HOME ?? join(home, ".codex", "sqlite") },
  { source: "pi-openbuddy", path: process.env.PI_OPENBUDDY_DB ?? join(home, ".pi", "agent", "openbuddy.sqlite") },
  { source: "pi-hermes-memory", path: process.env.PI_HERMES_DB ?? join(home, ".pi", "agent", "pi-hermes-memory", "sessions.db") },
];

const sqliteExtensions = new Set([".db", ".sqlite", ".sqlite3"]);

function displayPath(filePath) {
  const homeRelative = relative(home, filePath);
  return homeRelative && !homeRelative.startsWith("..") ? `~/${homeRelative}` : filePath;
}

async function existingFiles(root) {
  try {
    const metadata = await stat(root.path);
    if (metadata.isFile()) return [root.path];
    if (!metadata.isDirectory()) return [];
    const entries = await readdir(root.path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && sqliteExtensions.has(entry.name.slice(entry.name.lastIndexOf("."))))
      .map((entry) => join(root.path, entry.name))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function pragma(database, name) {
  const row = database.prepare(`PRAGMA ${name}`).get();
  return row?.[name] ?? null;
}

function inspectDatabase(filePath) {
  const metadata = new DatabaseSync(filePath, { readOnly: true });
  try {
    const tables = metadata
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') ORDER BY name")
      .all()
      .map((row) => String(row.name));
    return {
      path: displayPath(filePath),
      bytes: Number(statSync(filePath).size),
      userVersion: Number(pragma(metadata, "user_version")),
      schemaVersion: Number(pragma(metadata, "schema_version")),
      journalMode: String(pragma(metadata, "journal_mode")),
      synchronous: Number(pragma(metadata, "synchronous")),
      foreignKeys: Number(pragma(metadata, "foreign_keys")) === 1,
      tables,
    };
  } finally {
    metadata.close();
  }
}

const report = {
  kind: "openbuddy.storage-source-inventory.v1",
  generatedAt: new Date().toISOString(),
  policy: {
    readOnly: true,
    reads: ["file size", "SQLite PRAGMA values", "sqlite_master table names"],
    neverReads: ["table rows", "prompt", "transcript content", "tokens", "cookies", "credentials"],
    openclaw: "skipped / unknown / not-run",
  },
  sources: [],
};

for (const root of roots) {
  const files = await existingFiles(root);
  report.sources.push({
    source: root.source,
    root: displayPath(root.path),
    files: files.map(inspectDatabase),
    status: files.length === 0 ? "not-found" : "inspected",
  });
}

report.sources.push({
  source: "openclaw",
  root: "~/.openclaw",
  files: [],
  status: "skipped",
  reason: "This change does not inspect OpenClaw runtime state, databases, or credentials.",
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
