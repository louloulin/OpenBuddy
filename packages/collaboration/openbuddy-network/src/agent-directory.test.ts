import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonAgentDirectoryAdapter, MemoryAgentDirectoryAdapter, type PeerRecord } from "./agent-directory";

const peer: PeerRecord = {
  identity: {
    id: "buddy-x",
    handle: "x",
    displayName: "Buddy X",
    ownerUserId: "user-1",
    trustLevel: "local",
    status: "working",
  },
  trust: "known",
  capabilities: [],
  agentCardStatus: "missing",
  firstSeenAt: "2026-08-30T12:00:00.000Z",
  lastSeenAt: "2026-08-30T12:00:00.000Z",
};

describe("JsonAgentDirectoryAdapter — async I/O", () => {
  let root: string;
  let path: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-agent-directory-async-"));
    path = join(root, "directory.json");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips upserts through the write chain on flush + reopen", async () => {
    const adapter = new JsonAgentDirectoryAdapter(path);
    adapter.upsert(peer);
    expect(adapter.list()).toHaveLength(1);
    await adapter.flush();

    const onDisk = JSON.parse(await readFile(path, "utf8")) as { version: number; peers: PeerRecord[] };
    expect(onDisk.version).toBe(1);
    expect(onDisk.peers).toHaveLength(1);
    expect(onDisk.peers[0]?.identity.id).toBe(peer.identity.id);

    const reopened = new JsonAgentDirectoryAdapter(path);
    await reopened.flush();
    expect(reopened.list()).toEqual([peer]);
  });

  it("serializes concurrent upserts through the write chain", async () => {
    const adapter = new JsonAgentDirectoryAdapter(path);
    const peers: PeerRecord[] = [
      { ...peer, identity: { ...peer.identity, id: "buddy-a" } },
      { ...peer, identity: { ...peer.identity, id: "buddy-b" } },
      { ...peer, identity: { ...peer.identity, id: "buddy-c" } },
    ];
    for (const p of peers) adapter.upsert(p);
    await adapter.flush();
    const reopened = new JsonAgentDirectoryAdapter(path);
    await reopened.flush();
    expect(reopened.list().map((p) => p.identity.id).sort()).toEqual(["buddy-a", "buddy-b", "buddy-c"]);
  });

  it("removal is durable after flush + reopen", async () => {
    const adapter = new JsonAgentDirectoryAdapter(path);
    adapter.upsert(peer);
    await adapter.flush();
    const reopened = new JsonAgentDirectoryAdapter(path);
    await reopened.flush();
    reopened.remove(peer.identity.id);
    await reopened.flush();
    const final = new JsonAgentDirectoryAdapter(path);
    await final.flush();
    expect(final.list()).toEqual([]);
  });

  it("starts with an empty directory when the file does not exist", async () => {
    const adapter = new JsonAgentDirectoryAdapter(path);
    expect(adapter.list()).toEqual([]);
    await adapter.flush();
    expect(adapter.list()).toEqual([]);
  });

  it("rejects invalid peer projections from the in-memory checks", () => {
    const adapter = new MemoryAgentDirectoryAdapter();
    expect(() => adapter.upsert({ ...peer, identity: { ...peer.identity, id: "" } })).toThrow();
  });
});
