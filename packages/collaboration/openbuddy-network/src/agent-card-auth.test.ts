import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonAgentCardTrustStore } from "./agent-card-auth";

describe("JsonAgentCardTrustStore — async I/O", () => {
  let root: string;
  let path: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-agent-card-async-"));
    path = join(root, "trust.json");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("persists after flush() and round-trips a public key on reopen", async () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const store = new JsonAgentCardTrustStore(path);
    const record = store.add(publicKey, "2026-08-30T12:00:00.000Z");
    expect(store.resolvePublicKey(record.keyRef)).toBeDefined();
    await store.flush();

    const onDisk = JSON.parse(await readFile(path, "utf8")) as { version: number; keys: { keyRef: string }[] };
    expect(onDisk.version).toBe(1);
    expect(onDisk.keys).toHaveLength(1);
    expect(onDisk.keys[0]?.keyRef).toBe(record.keyRef);

    const restored = new JsonAgentCardTrustStore(path);
    await restored.flush();
    expect(restored.resolvePublicKey(record.keyRef)).toBeDefined();
  });

  it("revocation survives a reopen after flush()", async () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const store = new JsonAgentCardTrustStore(path);
    const record = store.add(publicKey);
    await store.flush();

    const reopened = new JsonAgentCardTrustStore(path);
    await reopened.flush();
    expect(reopened.resolvePublicKey(record.keyRef)).toBeDefined();

    reopened.revoke(record.keyRef, "2026-08-30T12:01:00.000Z");
    await reopened.flush();
    expect(reopened.resolvePublicKey(record.keyRef)).toBeUndefined();

    const finalStore = new JsonAgentCardTrustStore(path);
    await finalStore.flush();
    expect(finalStore.resolvePublicKey(record.keyRef)).toBeUndefined();
  });

  it("starts with an empty cache when the file does not exist", async () => {
    const store = new JsonAgentCardTrustStore(path);
    expect(store.records()).toEqual([]);
    await store.flush();
    expect(store.records()).toEqual([]);
  });
});
