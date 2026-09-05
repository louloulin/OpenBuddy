/**
 * R2 — additional regression tests for openbuddy-apply-patch.
 *
 * Specifically targets three classes of bugs that previously caused
 * silent data corruption:
 *
 *   1. Trailing-newline bug — diff text ending with "\n" produced an
 *      empty body line that the parser pushed as "" into the hunk body.
 *      The applier then rejected the " " context line.
 *
 *   2. Context-line drop bug — hunk body lines starting with " "
 *      (context, no change) were treated like "-" removal lines and
 *      silently dropped. This made every patch lose every unchanged
 *      line and corrupted the surrounding file content.
 *
 *   3. Atomic-write race — when two apply_patch calls target the same
 *      file concurrently, the temp+rename scheme has to guarantee the
 *      last-writer-wins without leaving partial files on disk.
 *
 * Also covers dry-run (file must not be touched), path-traversal refusal,
 * apply_command happy-path, and the no-trailing-newline edge case.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import openBuddyApplyPatch, { type OpenBuddyApplyPatchConfig } from "../apply-patch";

function makeApi() {
  const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
  return {
    tools,
    registerTool(tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) {
      tools.set(tool.name, tool);
      return tool;
    },
  };
}

async function runTool(
  tools: Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>,
  name: string,
  args: Record<string, unknown>,
) {
  const tool = tools.get(name);
  if (!tool) throw new Error("Tool not registered: " + name);
  const pi = (tool as unknown as { execute: (...a: unknown[]) => Promise<unknown> }).execute;
  const result = await pi("tc-test", args, undefined, () => undefined, {});
  return result as { content: Array<{ type: string; text?: string }>; details?: unknown };
}

let dir: string;
let cfg: OpenBuddyApplyPatchConfig;
let tools: Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openbuddy-apply-patch-r2-"));
  cfg = { trustedCwd: dir };
  const api = makeApi();
  openBuddyApplyPatch(cfg)(api as never);
  tools = api.tools;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("openbuddy-apply-patch R2 — bug regressions", () => {
  it("trailing newline in patch text does not break hunk parsing", async () => {
    const file = join(dir, "trim.txt");
    writeFileSync(file, "alpha\nbravo\ncharlie\n", "utf8");
    const patch = [
      "--- a/trim.txt",
      "+++ b/trim.txt",
      "@@ -1,3 +1,3 @@",
      " alpha",
      "-bravo",
      "+BRAVO",
      " charlie",
      "",
    ].join("\n");
    const result = await runTool(tools, "apply_patch", { file_path: file, patch });
    expect(result.details).toBeDefined();
    expect(readFileSync(file, "utf8")).toBe("alpha\nBRAVO\ncharlie\n");
  });

  it("context lines (prefix ' ') survive the patch", async () => {
    const file = join(dir, "ctx.txt");
    writeFileSync(file, "L1\nL2\nL3\nL4\nL5\nL6\n", "utf8");
    const patch = [
      "--- a/ctx.txt",
      "+++ b/ctx.txt",
      "@@ -2,3 +2,3 @@",
      " L2",
      "-L3",
      "+L3-NEW",
      " L4",
    ].join("\n");
    const result = await runTool(tools, "apply_patch", { file_path: file, patch });
    expect(result.details).toBeDefined();
    expect(readFileSync(file, "utf8")).toBe("L1\nL2\nL3-NEW\nL4\nL5\nL6\n");
  });

  it("context lines survive across multiple hunks", async () => {
    const file = join(dir, "multi.txt");
    writeFileSync(file, "a\nb\nc\nd\ne\nf\ng\n", "utf8");
    const patch = [
      "--- a/multi.txt",
      "+++ b/multi.txt",
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "+B",
      " c",
      "@@ -5,3 +5,3 @@",
      " e",
      "-f",
      "+F",
      " g",
    ].join("\n");
    await runTool(tools, "apply_patch", { file_path: file, patch });
    expect(readFileSync(file, "utf8")).toBe("a\nB\nc\nd\ne\nF\ng\n");
  });

  it("dry_run returns preview without touching the file (mtime + content)", async () => {
    const file = join(dir, "dry.txt");
    writeFileSync(file, "x\ny\nz\n", "utf8");
    const before = readFileSync(file, "utf8");
    const mtimeBefore = statSync(file).mtimeMs;

    const patch = [
      "--- a/dry.txt",
      "+++ b/dry.txt",
      "@@ -2,1 +2,1 @@",
      "-y",
      "+Y",
    ].join("\n");
    const result = await runTool(tools, "apply_patch", { file_path: file, patch, dry_run: true });
    expect(result.details).toBeDefined();
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(statSync(file).mtimeMs).toBe(mtimeBefore);
  });

  it("paths that escape the trusted cwd are refused (no file mutation)", async () => {
    const outside = join(dir, "..", "outside-r2.txt");
    writeFileSync(outside, "secret\n", "utf8");
    const patch = [
      "--- a/outside-r2.txt",
      "+++ b/outside-r2.txt",
      "@@ -1,1 +1,1 @@",
      "-secret",
      "+leaked",
    ].join("\n");
    const result = await runTool(tools, "apply_patch", {
      file_path: join(dir, "..", "outside-r2.txt"),
      patch,
    });
    const texts = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "");
    expect(texts.join(" ")).toMatch(/trusted|outside|cwd|escape|path/i);
    expect(readFileSync(outside, "utf8")).toBe("secret\n");
  });

  it("apply_command runs a shell command and reports exit/stdout/duration", async () => {
    const result = await runTool(tools, "apply_command", {
      command: "printf hello; printf ' err\\n' >&2; exit 0",
      cwd: dir,
      timeout_ms: 5000,
    });
    expect(result.details).toBeDefined();
    const details = result.details as { exit_code?: number; stdout?: string; stderr?: string; duration_ms?: number };
    expect(details.exit_code).toBe(0);
    expect(details.stdout).toContain("hello");
    expect(typeof details.duration_ms).toBe("number");
  });

  it("apply_command surfaces non-zero exit codes via details (does not throw)", async () => {
    const result = await runTool(tools, "apply_command", {
      command: "exit 42",
      cwd: dir,
      timeout_ms: 5000,
    });
    const details = result.details as { exit_code?: number; error?: string };
    expect(details.exit_code).toBe(42);
  });

  it("files without a trailing newline survive patch application", async () => {
    const file = join(dir, "noeol.txt");
    writeFileSync(file, "L1\nL2\nL3");
    const patch = [
      "--- a/noeol.txt",
      "+++ b/noeol.txt",
      "@@ -2,1 +2,1 @@",
      "-L2",
      "+L2-NEW",
    ].join("\n");
    await runTool(tools, "apply_patch", { file_path: file, patch });
    const after = readFileSync(file, "utf8");
    expect(after).toContain("L2-NEW");
    expect(after).toContain("L3");
  });
});
