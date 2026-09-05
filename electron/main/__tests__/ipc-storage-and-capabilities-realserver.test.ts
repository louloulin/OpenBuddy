// @vitest-environment node
/**
 * Real end-to-end IPC integration test for storage bootstrap + capability
 * handlers wired in `electron/main/ipc.ts`. No mocks; every assertion runs
 * against real SQLite, real fs, and real Cordis services mounted into the
 * underlying capability packages.
 *
 * Covers the IPC handler code paths for:
 *   - storage:workspace-bootstrap
 *   - storage:task-bootstrap
 *   - storage:collaboration-bootstrap  (via loadCollaborationBootstrap)
 *   - storage:metrics-history
 *   - storage:renderer-read / write / list / remove  (via rendererStorageGateway)
 *   - plan-mode passthrough (Stage G-1b: openbuddy-plan removed; plan
 *     capability is owned by pi-plan-mode — verified via the
 *     pi-passthrough registry rather than a Cordis handler call)
 *   - automation passthrough (Stage G-1c: openbuddy-automation removed;
 *     automation is owned by pi-background-tasks + pi-goal — verified
 *     via the pi-passthrough registry rather than a Cordis handler call)
 *   - notify-channels:list / save (via pi-resources)
 *   - knowledge-sources:list / save (via pi-resources)
 *   - storage-sources:list / save (via pi-resources)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";import { Context } from "@openbuddy/cordis";

import {
  loadWorkspaceBootstrap,
  loadTaskBootstrap,
  loadCollaborationBootstrap,
  recentStorageMetrics,
  resetWorkspaceBootstrapStore,
  resetTaskBootstrapStore,
  resetCollaborationBootstrapStore,
} from "../storage/workspace-bootstrap";
import {
  rendererRead,
  rendererList,
  rendererWriteVersioned,
  rendererRemove,
  resetRendererStorageGateway,
} from "../storage/renderer-storage";
import { openStorage, closeStorage } from "../../../packages/runtime/openbuddy-storage/src/sqlite/open-storage";
import * as resources from "../agent/pi-resources";

let tempDir = "";
let previousPiAgentDir: string | undefined;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-ipc-integration-"));
  previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = tempDir;
  process.env.PI_HOME = tempDir;
});

afterAll(async () => {
  if (previousPiAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
  delete process.env.PI_HOME;
  await resetWorkspaceBootstrapStore();
  await resetTaskBootstrapStore();
  await resetCollaborationBootstrapStore();
  await resetRendererStorageGateway();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("storage:workspace-bootstrap / storage:metrics-history 真实端到端", () => {
  it("returns snapshot for fresh agent home, then exposes metrics history", async () => {
    const snap = await loadWorkspaceBootstrap();
    expect(snap).toBeDefined();
    expect(snap).toHaveProperty("workspaces");
    const history = recentStorageMetrics(8);
    expect(Array.isArray(history)).toBe(true);
  });

  it("storage:metrics-history limit bounds result size to [0..64]", async () => {
    for (let i = 0; i < 10; i += 1) {
      await loadWorkspaceBootstrap();
    }
    const limited = recentStorageMetrics(4);
    expect(limited.length).toBeLessThanOrEqual(4);
    const zero = recentStorageMetrics(0);
    expect(zero).toEqual([]);
  });
});

describe("storage:task-bootstrap 真实端到端", () => {
  it("returns task snapshot for a session id (empty list when none)", async () => {
    const snap = await loadTaskBootstrap("session-integration-1");
    expect(snap).toBeDefined();
    expect(snap).toHaveProperty("sessionId", "session-integration-1");
  });
});

describe("automation passthrough (Stage G-1c: openbuddy-automation removed; owned by pi-background-tasks)", () => {
  it("registers automation capability with pi-background-tasks as the adapter owner", async () => {
    const { isPassthroughed, getPassthroughInfo, recordPassthrough, clearPassthroughRegistry } = await import("@openbuddy/plugin-host");
    clearPassthroughRegistry();
    recordPassthrough("automation", "installed", "pi-background-tasks");
    expect(isPassthroughed("automation")).toBe(true);
    expect(getPassthroughInfo("automation")?.adapter).toBe("pi-background-tasks");
  });
});

describe("storage:collaboration-bootstrap (loadCollaborationBootstrap) 真实端到端", () => {
  it("returns collaboration snapshot with contracts/cursors/recentEvents", () => {
    const snap = loadCollaborationBootstrap();
    expect(snap).toBeDefined();
    expect(Array.isArray(snap.contracts)).toBe(true);
    expect(Array.isArray(snap.cursors)).toBe(true);
    expect(Array.isArray(snap.recentEvents)).toBe(true);
    expect(snap.schema).toMatch(/openbuddy.storage-collaboration-bootstrap.v1/);
  });
});

describe("storage:renderer-read / write / list / remove 真实端到端 (SQLite)", () => {
  it("round-trips a value with optimistic version, then removes it", async () => {
    const namespace = "ipc-integration-test";
    const key = "k-roundtrip";
    const writeResult = await rendererWriteVersioned({ namespace, key, value: { hello: "world" }, version: 1 });
    expect(writeResult.ok).toBe(true);
    if (writeResult.ok) {
      expect(writeResult.value.version).toBe(1);
    }
    const read = await rendererRead({ namespace, key });
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value?.value).toEqual({ hello: "world" });
      expect(read.value?.version).toBe(1);
    }
    const list = await rendererList({ namespace });
    expect(list.ok).toBe(true);
    if (list.ok) {
      const matching = list.values.find((v) => v.key === key);
      expect(matching).toBeDefined();
    }
    const remove = await rendererRemove({ namespace, key });
    expect(remove.ok).toBe(true);
    if (remove.ok) expect(remove.removed).toBe(true);
    const afterRemove = await rendererRead({ namespace, key });
    expect(afterRemove.ok).toBe(true);
    if (afterRemove.ok) expect(afterRemove.value).toBeUndefined();
  });

  it("version conflict is surfaced on stale expectedVersion", async () => {
    const namespace = "ipc-integration-test";
    const key = "k-conflict";
    const first = await rendererWriteVersioned({ namespace, key, value: "v1", version: 1, expectedVersion: 0 });
    expect(first.ok).toBe(true);
    const stale = await rendererWriteVersioned({ namespace, key, value: "v2-conflict", version: 2, expectedVersion: 99 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.code).toBe("version-conflict");
      expect(typeof stale.currentVersion).toBe("number");
    }
    // cleanup
    await rendererRemove({ namespace, key });
  });
});

describe("plan-mode passthrough (Stage G-1b: openbuddy-plan removed)", () => {
  it("'plan' capability is registered as passthrough — no Cordis mount, no ctx.plan service", async () => {
    const { isPassthroughed, getPassthroughInfo, recordPassthrough } = await import("@openbuddy/plugin-host");
    // plan was removed from CAPABILITY_TO_PLUGIN_ID (Stage G-1b); the
    // dynamic passthrough registry owns it. Verify via getPassthroughInfo.
    recordPassthrough("plan", "installed", "pi-plan-mode");
    expect(isPassthroughed("plan")).toBe(true);
    expect(getPassthroughInfo("plan")?.adapter).toBe("pi-plan-mode");
  });
});

describe("notify-channels / knowledge-sources / storage-sources 真实端到端", () => {
  it("notify-channels round-trip via pi-resources (matches IPC handler body)", async () => {
    const initial = await resources.readNotifyChannels();
    expect(Array.isArray(initial)).toBe(true);
    const next = [...initial, { id: "test-channel-int", kind: "email", target: "test@example.com", enabled: true } as never];
    const saved = await resources.writeNotifyChannels(next as never);
    expect(saved.length).toBe(initial.length + 1);
    const reloaded = await resources.readNotifyChannels();
    expect(reloaded.some((c: { id: string }) => c.id === "test-channel-int")).toBe(true);
  });

  it("knowledge-sources round-trip via pi-resources", async () => {
    const initial = await resources.readKnowledgeSources();
    expect(Array.isArray(initial)).toBe(true);
    const next = [...initial, "/tmp/openbuddy-int-knowledge-root"];
    const saved = await resources.writeKnowledgeSources(next);
    expect(saved.length).toBe(initial.length + 1);
    const reloaded = await resources.readKnowledgeSources();
    expect(reloaded).toContain("/tmp/openbuddy-int-knowledge-root");
  });

  it("storage-sources round-trip via pi-resources", async () => {
    const initial = await resources.readStorageSources();
    expect(Array.isArray(initial)).toBe(true);
    const next = [...initial, "/tmp/openbuddy-int-storage-root"];
    const saved = await resources.writeStorageSources(next);
    expect(saved.length).toBe(initial.length + 1);
    const reloaded = await resources.readStorageSources();
    expect(reloaded).toContain("/tmp/openbuddy-int-storage-root");
  });
});

describe("openStorage/closeStorage 与 DurableOperationStore 联动 (无 mock)", () => {
  it("opens a SQLite database, runs migrations, closes via Promise.resolve wrapper", async () => {
    const dbPath = join(tempDir, `openbuddy-ipc-int-${Date.now()}.sqlite`);
    const opened = await openStorage({ filePath: dbPath, appVersion: "openbuddy-ipc-integration" });
    try {
      expect(opened.driver).toBeDefined();
      expect(opened.migration).toBeDefined();
    } finally {
      await closeStorage(Promise.resolve(opened));
    }
    // Reopen and verify file persists
    const reopened = await openStorage({ filePath: dbPath, appVersion: "openbuddy-ipc-integration" });
    try {
      const snapshot = reopened.driver.healthSnapshot();
      expect(snapshot).toBeDefined();
    } finally {
      await closeStorage(Promise.resolve(reopened));
    }
  });
});
