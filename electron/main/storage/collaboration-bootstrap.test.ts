import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCollaborationBootstrap, resetCollaborationBootstrapStore } from "./workspace-bootstrap";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-collab-bootstrap-ipc-"));
  process.env.PI_CODING_AGENT_DIR = tempDir;
  await resetCollaborationBootstrapStore();
});

afterEach(async () => {
  await resetCollaborationBootstrapStore();
  delete process.env.PI_CODING_AGENT_DIR;
  await rm(tempDir, { recursive: true, force: true });
  tempDir = "";
});

describe("collaboration bootstrap IPC façade", () => {
  it("returns a redacted snapshot for renderer", async () => {
    const summary = loadCollaborationBootstrap();
    expect(summary).toMatchObject({ schema: "openbuddy.storage-collaboration-bootstrap.v1", contracts: [], cursors: [], recentEvents: [] });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("token");
  });
});
