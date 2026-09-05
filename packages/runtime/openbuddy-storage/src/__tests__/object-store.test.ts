import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentAddressedObjectStore } from "../index";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ContentAddressedObjectStore", () => {
  it("deduplicates concurrent writes and round-trips content metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-object-store-"));
    roots.push(root);
    const store = new ContentAddressedObjectStore(root);
    const data = Buffer.from("same object");

    const stored = await Promise.all(Array.from({ length: 4 }, () => store.put(data, "text/plain")));

    expect(new Set(stored.map((item) => item.hash)).size).toBe(1);
    expect(new Set(stored.map((item) => item.relativePath)).size).toBe(1);
    expect(stored[0]).toMatchObject({ mediaType: "text/plain", sizeBytes: data.length });
    expect(await store.get(stored[0].hash)).toEqual(data);
    await expect(stat(store.pathFor(stored[0].hash))).resolves.toMatchObject({ size: data.length });
    await expect(readdir(join(root, stored[0].hash.slice(0, 2), stored[0].hash.slice(2, 4)))).resolves.toEqual([stored[0].hash]);
  });

  it("rejects malformed object hashes", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-object-store-invalid-"));
    roots.push(root);
    const store = new ContentAddressedObjectStore(root);

    await expect(store.get("not-a-hash")).rejects.toThrow("Invalid object hash");
    expect(() => store.pathFor("not-a-hash")).toThrow("Invalid object hash");
  });

  it("detects tampering on reads and existing-path writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-object-store-corrupt-"));
    roots.push(root);
    const store = new ContentAddressedObjectStore(root);
    const stored = await store.put(Buffer.from("original"));
    await writeFile(store.pathFor(stored.hash), "tampered");
    await expect(store.get(stored.hash)).rejects.toThrow("corruption detected");
    await expect(store.put(Buffer.from("original"))).rejects.toThrow("corruption detected");
  });
});
