/**
 * Phase 6 e2e — `core-session`'s `mountSession(ctx).list(cwd)` reads from
 * the isolated PI_CODING_AGENT_DIR. With no JSONL files on disk, list()
 * must return an array (possibly empty) without throwing.
 *
 * Pairs with `electron/main/__tests__/session-lifecycle-pi.test.ts` which
 * exercises the JSONL producer side; this file exercises the consumer side
 * (Cordis mount → list → empty workspace).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Context } from "@openbuddy/cordis";
import { mountSession } from "../src";
import type { Session } from "../src";

describe("core-session: list() round-trip on empty isolated agent dir", () => {
  let tempDir: string;
  let originalAgentDir: string | undefined;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ob-session-svc-"));
    originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = tempDir;
  });

  afterAll(async () => {
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    await rm(tempDir, { recursive: true, force: true });
  });

  test("list(cwd) on an empty isolated dir returns an array", async () => {
    const ctx = new Context();
    try {
      const svc = mountSession(ctx) as Session;
      const list = await svc.list(join(tempDir, "workspace"));
      expect(Array.isArray(list)).toBe(true);
    } finally {
      await ctx.stop();
    }
  });

  test("listWorkspaces() on an empty isolated dir returns an array", async () => {
    const ctx = new Context();
    try {
      const svc = mountSession(ctx) as Session;
      const workspaces = await svc.listWorkspaces();
      expect(Array.isArray(workspaces)).toBe(true);
    } finally {
      await ctx.stop();
    }
  });
});