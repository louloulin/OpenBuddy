import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runPreflightCli } from "../../../../../scripts/storage/run-migration-preflight.mjs";

let root = "";
const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  root = "";
});

describe("preflight CLI", () => {
  it("inspects a manifest and returns a redacted manifest", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-preflight-cli-"));
    const jsonPath = join(root, "settings.json");
    const jsonlPath = join(root, "events.jsonl");
    const missingPath = join(root, "missing.json");
    await writeFile(jsonPath, JSON.stringify({ theme: "dark", apiKey: "fixture-secret" }));
    await writeFile(jsonlPath, `${JSON.stringify({ sequence: 1 })}\nbad\n${JSON.stringify({ token: "Bearer fixture-token" })}\n`);
    const manifestPath = join(root, "manifest.json");
    await writeFile(manifestPath, JSON.stringify([
      { path: jsonPath, kind: "json", label: "settings" },
      { path: jsonlPath, kind: "jsonl", label: "events" },
      { path: missingPath, kind: "markdown", label: "missing" },
    ]));

    const out = await runPreflightCli(manifestPath);
    expect(out).toMatchObject({ schema: "openbuddy.storage-legacy-preflight.v1" });
    expect(out.sources).toHaveLength(3);
    expect(out.sources[0]).toMatchObject({ label: "settings", status: "read", secretRisk: { detected: true, matches: 1 } });
    expect(out.sources[1]).toMatchObject({ label: "events", status: "read", recordCount: 2, parseErrors: 1 });
    expect(out.sources[2]).toMatchObject({ label: "missing", status: "missing", issues: ["read:ENOENT"] });
    expect(JSON.stringify(out)).not.toContain("fixture-secret");
    expect(JSON.stringify(out)).not.toContain("fixture-token");
  });

  it("rejects malformed manifest input without leaking filesystem paths", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-preflight-cli-error-"));
    const manifestPath = join(root, "manifest.json");
    await mkdir(root, { recursive: true });
    await writeFile(manifestPath, "{not-json");
    await expect(runPreflightCli(manifestPath)).rejects.toBeDefined();
  });
});
