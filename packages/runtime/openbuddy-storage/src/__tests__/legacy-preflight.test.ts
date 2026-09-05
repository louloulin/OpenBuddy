import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { preflightLegacySource, preflightLegacySources } from "../adapters/legacy-preflight";

let root = "";

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  root = "";
});

describe("LegacySourcePreflight", () => {
  it("inspects JSON without persisting or returning source content", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-preflight-json-"));
    const path = join(root, "settings.json");
    await writeFile(path, JSON.stringify({ theme: "dark", apiKey: "fixture-secret" }));

    const report = await preflightLegacySource({ path, kind: "json", label: "settings" });

    expect(report).toMatchObject({ status: "read", bytes: expect.any(Number), recordCount: 1, parseErrors: 0, label: "settings" });
    expect(report.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.secretRisk).toEqual({ detected: true, matches: 1 });
    expect(JSON.stringify(report)).not.toContain("fixture-secret");
    expect(await readFile(path, "utf8")).toContain("fixture-secret");
  });

  it("counts valid and malformed JSONL rows with a deterministic hash", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-preflight-jsonl-"));
    const path = join(root, "events.jsonl");
    const contents = `${JSON.stringify({ type: "input", text: "hello" })}\nnot-json\n${JSON.stringify({ authorization: "Bearer fixture-token" })}\n`;
    await writeFile(path, contents);

    const first = await preflightLegacySource({ path, kind: "pi-session" });
    const second = await preflightLegacySource({ path, kind: "pi-session" });

    expect(first).toMatchObject({ status: "read", lineCount: 3, recordCount: 2, parseErrors: 1, issues: ["parse:invalid-jsonl:1"] });
    expect(first.sha256).toBe(second.sha256);
    expect(first.secretRisk).toEqual({ detected: true, matches: 1 });
    expect(JSON.stringify(first)).not.toContain("fixture-token");
  });

  it("classifies missing and unreadable sources without exposing filesystem errors", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-preflight-errors-"));
    const directory = join(root, "directory");
    await mkdir(directory);

    const report = await preflightLegacySources([
      { path: join(root, "missing.json"), kind: "json" },
      { path: directory, kind: "markdown" },
    ]);

    expect(report.schema).toBe("openbuddy.storage-legacy-preflight.v1");
    expect(report.sources[0]).toMatchObject({ status: "missing", bytes: 0, issues: ["read:ENOENT"] });
    expect(report.sources[1]).toMatchObject({ status: "error", bytes: 0, issues: ["read:EISDIR"] });
    expect(JSON.stringify(report)).not.toContain("Error:");
  });

  it("scans Markdown for risk signals while retaining only metadata", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-preflight-markdown-"));
    const path = join(root, "MEMORY.md");
    await writeFile(path, "# Memory\n\nAuthorization: Bearer fixture-secret\n");

    const report = await preflightLegacySource({ path, kind: "markdown" });

    expect(report).toMatchObject({ status: "read", lineCount: 4, recordCount: 1, parseErrors: 0 });
    expect(report.secretRisk.detected).toBe(true);
    expect(JSON.stringify(report)).not.toContain("fixture-secret");
  });
});
