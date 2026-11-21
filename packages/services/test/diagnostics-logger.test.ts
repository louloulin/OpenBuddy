// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactText, redactValue, StructuredLogger } from "../src/support/logger";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "openbuddy-log-"));
  dirs.push(dir);
  return dir;
};

describe("结构化日志 (O1)", () => {
  it("redacts keys, Bearer tokens, emails and absolute paths (text and nested data)", () => {
    const text = redactText("Bearer local-fixture-only sk-live-abcdefghi alice@example.com /Users/alice/project/app.ts");
    expect(text).not.toContain("local-fixture-only");
    expect(text).not.toContain("sk-live-abcdefghi");
    expect(text).not.toContain("alice@example.com");
    expect(text).not.toContain("/Users/alice");
    expect(text).toContain("[redacted]");
    expect(text).toContain("[email]");
    expect(text).toContain("[path]");

    const nested = redactValue({ apiKey: "secret-value", headers: { authorization: "Bearer abcdefghijk" }, path: "/home/bob/x" }) as Record<string, unknown>;
    expect(nested.apiKey).toBe("[redacted]");
    expect((nested.headers as Record<string, unknown>).authorization).toBe("[redacted]");
    expect(nested.path).toBe("[path]");
  });

  it("writes JSONL records with level, scope and redacted data", () => {
    const dir = tempDir();
    const logger = new StructuredLogger(dir);
    logger.info("engine", "session started", { sessionId: "s1", apiKey: "sk-test-abcdefgh" });
    const [file] = readdirSync(dir);
    const record = JSON.parse(readFileSync(join(dir, file), "utf8").trim());
    expect(record).toMatchObject({ level: "info", scope: "engine", message: "session started" });
    expect(record.data).toMatchObject({ sessionId: "s1", apiKey: "[redacted]" });
    expect(logger.files()).toHaveLength(1);
  });

  it("rotates the day file when it would exceed maxBytes", () => {
    const dir = tempDir();
    const logger = new StructuredLogger(dir, { maxBytes: 180 });
    for (let i = 0; i < 8; i += 1) logger.warn("rotation", `entry ${i} ${"x".repeat(40)}`);
    expect(readdirSync(dir).length).toBeGreaterThan(1);
  });

  it("prunes files older than the retention window", () => {
    const dir = tempDir();
    const old = join(dir, "openbuddy-2026-01-01.log");
    writeFileSync(old, "{}\n");
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    utimesSync(old, tenDaysAgo, tenDaysAgo);
    const logger = new StructuredLogger(dir, { retainDays: 7 });
    expect(existsSyncSafe(old)).toBe(false);
    logger.info("retention", "still writes");
    expect(logger.files().length).toBe(1);
  });
});

function existsSyncSafe(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
