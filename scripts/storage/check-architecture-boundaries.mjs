import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const productionRoots = [
  "electron/main",
  "packages/capability",
  "packages/core",
  "packages/team",
  "packages/renderer",
  "src",
];

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const relativePath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "out" || entry.name === "dist") continue;
      files.push(...walk(relativePath));
      continue;
    }
    if (!sourceExtensions.has(relativeExtension(entry.name))) continue;
    if (/(?:\.test|\.spec)\.[^.]+$/.test(entry.name) || relativePath.includes("/__tests__/")) continue;
    files.push(relativePath);
  }
  return files;
}

function relativeExtension(file) {
  const index = file.lastIndexOf(".");
  return index === -1 ? "" : file.slice(index);
}

function violation(rule, file, detail) {
  return { rule, file, detail };
}

function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|\s)\/\/.*$/gmu, "$1");
}

export function checkArchitectureBoundaries() {
  const violations = [];
  const productionFiles = productionRoots.flatMap(walk);

  for (const relativePath of productionFiles) {
    const source = readFileSync(resolve(root, relativePath), "utf8");
    const executableSource = withoutComments(source);
    const isRenderer = relativePath === "src" || relativePath.startsWith("src/") || relativePath.startsWith("packages/renderer/");

    if (/from\s+["'](?:node:sqlite|better-sqlite3|sqlite3)["']|require\(\s*["'](?:node:sqlite|better-sqlite3|sqlite3)["']\s*\)/u.test(source)) {
      violations.push(violation("direct-sqlite-import", relativePath, "production code must use @openbuddy/storage public ports"));
    }
    if (/(?:from|import)\s+["'][^"']*(?:packages\/runtime\/openbuddy-storage\/src|@openbuddy\/storage\/src)[^"']*["']/u.test(source)) {
      violations.push(violation("storage-internal-import", relativePath, "internal storage paths are not a public contract"));
    }
    if (/\b(?:CREATE\s+TABLE|INSERT\s+INTO|UPDATE\s+[A-Za-z_][A-Za-z0-9_]*\s+SET|DELETE\s+FROM|ALTER\s+TABLE|PRAGMA\s+[A-Za-z_])/iu.test(executableSource)) {
      violations.push(violation("direct-sql", relativePath, "SQL belongs in the storage adapter, not in application or capability code"));
    }
    if (isRenderer && /from\s+["']node:(?:fs|fs\/promises|sqlite|child_process|os|path)["']/u.test(source)) {
      violations.push(violation("renderer-node-boundary", relativePath, "renderer code must use versioned IPC DTOs"));
    }
    if (isRenderer && /from\s+["']@openbuddy\/storage["']/u.test(source)) {
      violations.push(violation("renderer-storage-boundary", relativePath, "renderer code must not depend on the Node storage package"));
    }
  }

  const storageFiles = walk("packages/runtime/openbuddy-storage/src");
  for (const relativePath of storageFiles) {
    const source = readFileSync(resolve(root, relativePath), "utf8");
    if (/from\s+["'](?:electron|@openbuddy\/(?:renderer|renderer-host|capability-[^"']*))["']/u.test(source)) {
      violations.push(violation("storage-ui-boundary", relativePath, "storage infrastructure must not depend on Electron or renderer packages"));
    }
  }

  return {
    schema: "openbuddy.storage-architecture-boundaries.v1",
    filesScanned: productionFiles.length + storageFiles.length,
    violations,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = checkArchitectureBoundaries();
  console.log(JSON.stringify({ ok: result.violations.length === 0, ...result }, null, 2));
  if (result.violations.length > 0) process.exitCode = 1;
}
