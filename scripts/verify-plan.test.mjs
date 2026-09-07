import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyPlan, PLAN_CHECKS } from "./verify-plan.mjs";

const realRepoRoot = resolve(import.meta.dirname, "..");

function makeFakeRepo({ files, dirs = [], prefix = "verify-plan-fixture" } = {}) {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  for (const dir of dirs) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  for (const [relative, contents] of Object.entries(files || {})) {
    const absolute = join(root, relative);
    mkdirSync(resolve(absolute, ".."), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return root;
}

describe("verifyPlan", () => {
  it("passes every check against the real repo", async () => {
    const report = await verifyPlan({ repoRoot: realRepoRoot });
    expect(report.ok).toBe(true);
    expect(report.summary.failedRequired).toBe(0);
    expect(report.summary.total).toBeGreaterThanOrEqual(14);
    for (const result of report.results) {
      expect(result.ok, `check ${result.id} should pass against the real repo: ${result.detail}`).toBe(true);
    }
  });

  it("fails the missing-file checks against an empty repo", async () => {
    const root = makeFakeRepo({ files: {}, dirs: ["scripts", ".github/workflows", "docs"] });
    try {
      const report = await verifyPlan({ repoRoot: root });
      expect(report.ok).toBe(false);
      const failed = report.results.filter((r) => !r.ok);
      expect(failed.length).toBeGreaterThan(0);
      expect(report.summary.failedRequired).toBe(failed.length);
      expect(failed.some((f) => /does not exist on disk/.test(f.detail))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats a missing _section-credit-expiry.sh as a required failure", async () => {
    // Create a "repo" with the credit-expiry.sh file deliberately deleted,
    // but everything else intact, to prove the regression detector catches it.
    const root = makeFakeRepo({
      dirs: ["scripts", ".github/workflows", "docs"],
      files: {
        "scripts/check-macos-signing.mjs": "export function verifySignedArtifact() {}\n",
        "scripts/_section-credit-expiry.sh": "run_credit_expiry_check() { echo stub; }\n",
        "scripts/deploy-doctor.sh": "#!/bin/bash\n# uses _section-credit-expiry.sh\nsource scripts/_section-credit-expiry.sh\n",
        "scripts/build-release-bundle.sh": "# bundles\nscripts/_section-credit-expiry.sh\n",
        "scripts/verify-plan.mjs": "export async function verifyPlan() {}\n",
        ".github/workflows/release.yml": "name: Release\njobs:\n  build-macos:\n    steps:\n      - name: Verify\n        run: node scripts/check-macos-signing.mjs --verify\n      - name: Gate\n        env:\n          OPENBUDDY_ALLOW_UNSIGNED_MAC: ${{ vars.OPENBUDDY_ALLOW_UNSIGNED_MAC || '0' }}\n",
        "docs/release-ci.md": "# docs\nUses OPENBUDDY_ALLOW_UNSIGNED_MAC and check-macos-signing.mjs --verify\n",
      },
    });
    try {
      const baseline = await verifyPlan({ repoRoot: root });
      expect(baseline.ok).toBe(true);
      // Now delete the credit-expiry script and re-run.
      rmSync(join(root, "scripts/_section-credit-expiry.sh"));
      const regressed = await verifyPlan({ repoRoot: root });
      expect(regressed.ok).toBe(false);
      const ids = regressed.results.filter((r) => !r.ok).map((r) => r.id);
      expect(ids).toContain("p0-5.section-credit-expiry-script");
      expect(ids).toContain("p0-5.section-credit-expiry-fn");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("filters checks by id prefix", async () => {
    const report = await verifyPlan({ repoRoot: realRepoRoot, only: "p0-5" });
    expect(report.summary.total).toBeGreaterThan(0);
    for (const result of report.results) {
      expect(result.id.startsWith("p0-5.")).toBe(true);
    }
  });

  it("filters checks by id substring", async () => {
    const report = await verifyPlan({ repoRoot: realRepoRoot, only: "section-credit" });
    expect(report.summary.total).toBeGreaterThan(0);
    for (const result of report.results) {
      expect(result.id).toContain("section-credit");
    }
  });

  it("throws when no checks match --only", async () => {
    await expect(verifyPlan({ repoRoot: realRepoRoot, only: "this-check-does-not-exist" }))
      .rejects.toThrow(/no checks match/);
  });

  it("supports --only exact id", async () => {
    const report = await verifyPlan({
      repoRoot: realRepoRoot,
      only: "p0-5.section-credit-expiry-fn",
    });
    expect(report.results).toHaveLength(1);
    expect(report.results[0].id).toBe("p0-5.section-credit-expiry-fn");
  });

  it("flags a removed release.yml openbuddy-allow-unsigned path as required failure", async () => {
    const root = makeFakeRepo({
      dirs: ["scripts", ".github/workflows", "docs"],
      files: {
        "scripts/check-macos-signing.mjs": "export function verifySignedArtifact() {}\n",
        "scripts/_section-credit-expiry.sh": "run_credit_expiry_check() { echo stub; }\n",
        "scripts/deploy-doctor.sh": "#!/bin/bash\n# uses _section-credit-expiry.sh\nsource scripts/_section-credit-expiry.sh\n",
        "scripts/build-release-bundle.sh": "# bundles\nscripts/_section-credit-expiry.sh\n",
        "scripts/verify-plan.mjs": "export async function verifyPlan() {}\n",
        // release.yml without OPENBUDDY_ALLOW_UNSIGNED_MAC.
        ".github/workflows/release.yml": "name: Release\njobs:\n  build-macos:\n    steps:\n      - name: Verify\n        run: node scripts/check-macos-signing.mjs --verify\n      - name: Other step\n        run: echo hi\n",
        "docs/release-ci.md": "# docs\ncheck-macos-signing.mjs --verify\n",
      },
    });
    try {
      const report = await verifyPlan({ repoRoot: root });
      expect(report.ok).toBe(false);
      const ids = report.results.filter((r) => !r.ok).map((r) => r.id);
      expect(ids).toContain("p0-1.release-yml-allow-unsigned");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("PLAN_CHECKS contract", () => {
  it("uses unique ids", () => {
    const ids = PLAN_CHECKS.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all checks carry severity and a run() function", () => {
    for (const check of PLAN_CHECKS) {
      expect(["required", "nice"]).toContain(check.severity);
      expect(typeof check.run).toBe("function");
      expect(typeof check.label).toBe("string");
    }
  });
});