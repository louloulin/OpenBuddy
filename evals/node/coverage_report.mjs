// Real-no-mock coverage report: maps every capability to its actual automated
// test coverage by scanning the source tree for test references.
//
// No mocks, no fixtures — all reads come from real files on disk.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const matrixPath = join(root, "evals", "capability-matrix.json");
const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));

const evidenceRoot = process.env.OPENBUDDY_EVIDENCE_DIR
  ?? join(root, "evidence", "coverage-report");
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync(evidenceRoot, { recursive: true });

function listFilesRecursive(dir, exts) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    // Skip nested dependency trees so a missing symlink in .pnpm/
    // (e.g. workspace packages removed from packages/ but still
    // referenced in package.json) cannot crash the coverage scan.
    if (entry === "node_modules" || entry === ".pnpm") continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) results.push(...listFilesRecursive(full, exts));
    else if (exts.some((ext) => entry.endsWith(ext))) results.push(full);
  }
  return results;
}

const testFiles = [
  ...listFilesRecursive(join(root, "src"), [".test.ts", ".test.tsx", ".test.mjs"]),
  ...listFilesRecursive(join(root, "electron"), [".test.ts", ".test.mjs"]),
  ...listFilesRecursive(join(root, "evals"), [".test.mjs", ".test.ts"]),
  ...listFilesRecursive(join(root, "packages"), [".test.ts", ".test.mjs"]),
  ...listFilesRecursive(join(root, "scripts"), [".test.mjs"]),
];

const sourceFiles = [
  ...listFilesRecursive(join(root, "src"), [".ts", ".tsx"]),
  ...listFilesRecursive(join(root, "electron"), [".ts"]),
  ...listFilesRecursive(join(root, "packages"), [".ts"]),
];

function tokenize(path) {
  return relative(root, path).split(sep).join(".").split("/").join(".").toLowerCase();
}

const testIndex = new Map();
for (const test of testFiles) {
  const tokens = tokenize(test);
  testIndex.set(test, { path: relative(root, test), tokens });
}

const capabilities = matrix.capabilities.map((cap) => {
  const id = cap.id;
  const idTokens = id.toLowerCase().split(/[-_]/);
  const matches = [];
  for (const [path, info] of testIndex) {
    const score = idTokens.reduce((acc, tok) => acc + (info.tokens.includes(tok) ? 1 : 0), 0);
    if (score > 0) matches.push({ path: info.path, score });
  }
  matches.sort((a, b) => b.score - a.score);
  return {
    id,
    surface: cap.surface,
    localEvidence: cap.localEvidence ?? [],
    realEvidence: cap.realEvidence ?? [],
    localArtifacts: cap.localArtifacts ?? [],
    realArtifacts: cap.realArtifacts ?? [],
    matchedTests: matches.slice(0, 8),
    matchedTestCount: matches.length,
    hasLocalEvidenceScript: (cap.localEvidence ?? []).length > 0,
    hasRealEvidenceScript: (cap.realEvidence ?? []).length > 0,
    hasLocalArtifactOnDisk: (cap.localArtifacts ?? []).some((a) => existsSync(join(root, a))),
    hasRealArtifactOnDisk: (cap.realArtifacts ?? []).some((a) => existsSync(join(root, a))),
    status: cap.status ?? "ready-for-real-run",
  };
});

const summary = {
  schema: "openbuddy.coverage-report.v1",
  generatedAt: new Date().toISOString(),
  totals: {
    capabilities: capabilities.length,
    withLocalArtifactOnDisk: capabilities.filter((c) => c.hasLocalArtifactOnDisk).length,
    withRealArtifactOnDisk: capabilities.filter((c) => c.hasRealArtifactOnDisk).length,
    withLocalEvidenceScript: capabilities.filter((c) => c.hasLocalEvidenceScript).length,
    withRealEvidenceScript: capabilities.filter((c) => c.hasRealEvidenceScript).length,
    withMatchedTests: capabilities.filter((c) => c.matchedTestCount > 0).length,
    withoutLocalArtifactAndNoTests: capabilities.filter((c) => !c.hasLocalArtifactOnDisk && c.matchedTestCount === 0).length,
  },
  capabilities,
};

const outPath = join(evidenceRoot, "coverage-report.json");
writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...summary, artifactPath: outPath }, null, 2));
