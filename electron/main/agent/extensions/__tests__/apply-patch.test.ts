/**
 * R1.4 — unit tests for the openbuddy-apply-patch Pi extension.
 *
 * Covers the unified-diff parser, hunk application, dry-run, path-trust check,
 * and atomic-write success path. The shell-execution `apply_command` tool is
 * integration-tested via the live shell harness, so it's not covered here.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import openBuddyApplyPatch from "../apply-patch";

/** Minimal Pi API stub — only `registerTool` is used by the extension. */
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

describe("openbuddy-apply-patch", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "openbuddy-apply-patch-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("registers apply_patch + apply_command tools", () => {
    const api = makeApi();
    openBuddyApplyPatch({ trustedCwd: dir })(api as never);
    expect(api.tools.has("apply_patch")).toBe(true);
    expect(api.tools.has("apply_command")).toBe(true);
  });

  it("applies a single-hunk patch atomically", async () => {
    const api = makeApi();
    openBuddyApplyPatch({ trustedCwd: dir })(api as never);
    const target = join(dir, "hello.txt");
    writeFileSync(target, "hello\nold line\nworld\n", "utf8");
    const tool = api.tools.get("apply_patch")!;
    const result = (await tool.execute("tc-1", {
      file_path: target,
      patch:
        "--- a/hello.txt\n+++ b/hello.txt\n@@ -1,3 +1,3 @@\n hello\n-old line\n+new line\n world\n",
    })) as { content: Array<{ type: "text"; text: string }>; details: { applied: boolean; hunks: number; file: string } };
    expect(result.details.applied).toBe(true);
    expect(result.details.hunks).toBe(1);
    expect(result.details.file).toBe(target);
    expect(readFileSync(target, "utf8")).toBe("hello\nnew line\nworld\n");
  });

  it("returns dry_run preview without writing", async () => {
    const api = makeApi();
    openBuddyApplyPatch({ trustedCwd: dir })(api as never);
    const target = join(dir, "a.txt");
    writeFileSync(target, "x\n", "utf8");
    const tool = api.tools.get("apply_patch")!;
    const result = (await tool.execute("tc-2", {
      file_path: target,
      patch: "@@ -1 +1 @@\n-x\n+y\n",
      dry_run: true,
    })) as { details: { applied: boolean; hunks: number; preview?: string } };
    expect(result.details.applied).toBe(false);
    expect(result.details.hunks).toBe(1);
    expect(result.details.preview).toBeDefined();
    expect(readFileSync(target, "utf8")).toBe("x\n"); // unchanged
  });

  it("refuses paths outside the trusted workspace", async () => {
    const api = makeApi();
    openBuddyApplyPatch({ trustedCwd: dir })(api as never);
    const tool = api.tools.get("apply_patch")!;
    const outside = join(dir, "..", "definitely-not-trusted.txt");
    const result = (await tool.execute("tc-3", {
      file_path: outside,
      patch: "@@ -1 +1 @@\n-x\n+y\n",
    })) as { details: { applied: boolean; error?: string } };
    expect(result.details.applied).toBe(false);
    expect(result.details.error).toMatch(/outside the trusted workspace/);
    expect(existsSync(outside)).toBe(false);
  });

  it("rejects non-absolute paths with a helpful error", async () => {
    const api = makeApi();
    openBuddyApplyPatch({ trustedCwd: dir })(api as never);
    const tool = api.tools.get("apply_patch")!;
    const result = (await tool.execute("tc-4", {
      file_path: "relative/path.txt",
      patch: "@@ -1 +1 @@\n-x\n+y\n",
    })) as { details: { error?: string } };
    expect(result.details.error).toMatch(/must be absolute/);
  });

  // Mirrors the production guard added after the openbuddy Settings panel
  // surfaced "TypeError: api.registerTool is not a function" whenever the
  // host runtime (older pi builds, RPC stubs) does not expose the legacy
  // registerTool method on the ExtensionAPI. The extension factory must
  // silently skip tool registration rather than throw, so `agent:init`
  // does not abort the entire settings/config read flow.
  it("does not throw when the runtime omits registerTool", () => {
    const apiWithoutRegisterTool = {
      on: () => undefined,
      registerCommand: () => undefined,
      // intentionally no registerTool
    };
    expect(() =>
      openBuddyApplyPatch({ trustedCwd: dir })(apiWithoutRegisterTool as never),
    ).not.toThrow();
  });
});
