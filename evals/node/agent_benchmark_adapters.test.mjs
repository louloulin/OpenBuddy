import { describe, expect, it, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const evidenceRoot = join(root, "evidence", "_test_run");

function runAdapter(scriptPath, evidenceDir) {
  const result = spawnSync("node", [scriptPath], {
    cwd: root,
    env: {
      ...process.env,
      OPENBUDDY_EVIDENCE_DIR: evidenceDir,
      OPENBUDDY_E2E_REQUIRED: "", // never require external
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return { ok: false, stdout: result.stdout, stderr: result.stderr, status: result.status };
  }
  return { ok: true, stdout: result.stdout, stderr: result.stderr, artifact: join(evidenceDir, JSON.parse(result.stdout).artifactPath.split("/").pop()) };
}

describe("Real-no-mock top-tier AI Agent benchmark adapters", () => {
  beforeAll(() => {
    mkdirSync(evidenceRoot, { recursive: true });
  });

  it("GAIA-style adapter produces real evidence artifact", () => {
    const dir = join(evidenceRoot, "gaia");
    const r = runAdapter(join(root, "evals/node/run_gaia_local.mjs"), dir);
    expect(r.ok, r.stderr).toBe(true);
    const artifact = readFileSync(r.artifact, "utf8");
    const json = JSON.parse(artifact);
    expect(json.schema).toBe("openbuddy.gaia-local-evidence.v1");
    expect(json.datasetRows).toBeGreaterThan(0);
    expect(json.structuralFindings).toEqual([]);
    expect(Object.keys(json.categories).length).toBeGreaterThan(0);
    expect(json.mode).toBe("local-evidence-only");
    expect(json.pass).toBe(true);
  });

  it("AgentBench/ToolBench-style adapter produces real evidence artifact", () => {
    const dir = join(evidenceRoot, "agentbench");
    const r = runAdapter(join(root, "evals/node/run_agentbench_tools.mjs"), dir);
    expect(r.ok, r.stderr).toBe(true);
    const artifact = readFileSync(r.artifact, "utf8");
    const json = JSON.parse(artifact);
    expect(json.schema).toBe("openbuddy.agentbench-tools-local.v1");
    expect(json.datasetRows).toBeGreaterThan(0);
    expect(json.structuralFindings).toEqual([]);
    expect(json.cases.length).toBe(json.datasetRows);
    expect(json.pass).toBe(true);
  });

  it("AgentDojo-style safety adapter produces real evidence artifact", () => {
    const dir = join(evidenceRoot, "agentdojo");
    const r = runAdapter(join(root, "evals/node/run_agentdojo_safety.mjs"), dir);
    expect(r.ok, r.stderr).toBe(true);
    const artifact = readFileSync(r.artifact, "utf8");
    const json = JSON.parse(artifact);
    expect(json.schema).toBe("openbuddy.agentdojo-safety-local.v1");
    expect(json.datasetRows).toBeGreaterThan(0);
    expect(json.structuralFindings).toEqual([]);
    expect(json.safetyProperties.length).toBeGreaterThan(0);
    expect(json.pass).toBe(true);
  });

  it("All adapters fail-closed when OPENBUDDY_E2E_REQUIRED=1 without credentials", () => {
    const dir = join(evidenceRoot, "failclosed");
    for (const script of ["run_gaia_local.mjs", "run_agentbench_tools.mjs", "run_agentdojo_safety.mjs"]) {
      const result = spawnSync("node", [join(root, "evals/node", script)], {
        cwd: root,
        env: {
          ...process.env,
          OPENBUDDY_EVIDENCE_DIR: dir,
          OPENBUDDY_E2E_REQUIRED: "1",
          OPENBUDDY_HARNESS_URL: "",
          OPENBUDDY_HARNESS_TOKEN: "",
          OPENBUDDY_E2E_API_KEY: "",
          OPENBUDDY_E2E_BASE_URL: "",
          OPENBUDDY_E2E_MODEL_ID: "",
        },
        encoding: "utf8",
      });
      // Without credentials and with REQUIRED=1, exit code MUST be 2 (fail-closed).
      expect(result.status, `${script} should fail-closed with status 2: ${result.stderr}`).toBe(2);
    }
  });
});

describe("Top-tier AI Agent benchmark orchestrator", () => {
  it("runs all 7 adapters and produces a unified evidence artifact", () => {
    const dir = join(evidenceRoot, "orchestrator");
    const result = spawnSync("node", [join(root, "evals/node/run_top_tier_local.mjs")], {
      cwd: root,
      env: { ...process.env, OPENBUDDY_EVIDENCE_DIR: dir, OPENBUDDY_E2E_REQUIRED: "" },
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.schema).toBe("openbuddy.top-tier-local-orchestrator.v1");
    expect(json.adapters).toHaveLength(7);
    expect(json.adapters.map((a) => a.id)).toEqual([
      "gaia-style",
      "agentbench-toolbench",
      "agentdojo-safety",
      "mt-bench-style",
      "bfcl-style",
      "nl2bash-style",
      "swe-bench-style",
    ]);
    expect(json.totals.passed).toBe(7);
    expect(json.totals.structuralFindings).toBe(0);
    expect(json.pass).toBe(true);
  });

  it("orchestrator fails when any adapter fails (simulated by injecting bad dataset)", () => {
    const dir = join(evidenceRoot, "orchestrator_fail");
    // Create a temp dataset that fails validation
    const datasetPath = join(root, "evals/datasets/gaia_style_tasks.jsonl");
    const original = readFileSync(datasetPath, "utf8");
    const broken = original.replace(/"id":"gaia\.local\.multi-step-reason"/, "\"id\":\"\"");
    writeFileSync(datasetPath, broken);
    try {
      const result = spawnSync("node", [join(root, "evals/node/run_top_tier_local.mjs")], {
        cwd: root,
        env: { ...process.env, OPENBUDDY_EVIDENCE_DIR: dir, OPENBUDDY_E2E_REQUIRED: "" },
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.totals.structuralFindings).toBeGreaterThan(0);
    } finally {
      writeFileSync(datasetPath, original);
    }
  });
});

describe("Coverage report (real-no-mock)", () => {
  it("produces a coverage report artifact with capability matches", () => {
    const result = spawnSync("node", [join(root, "evals/node/coverage_report.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.schema).toBe("openbuddy.coverage-report.v1");
    expect(json.totals.capabilities).toBe(30);
    expect(json.capabilities.length).toBe(30);
    // every capability must declare either local evidence or be disabled-by-policy
    for (const cap of json.capabilities) {
      expect(cap.id).toBeTruthy();
      expect(typeof cap.hasLocalEvidenceScript).toBe("boolean");
    }
  });

  it("matches at least 15 capabilities against real test files", () => {
    const result = spawnSync("node", [join(root, "evals/node/coverage_report.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
    const json = JSON.parse(result.stdout);
    const matched = json.capabilities.filter((c) => c.matchedTestCount > 0).length;
    expect(matched).toBeGreaterThanOrEqual(15);
  });
});
