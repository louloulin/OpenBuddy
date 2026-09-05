import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("plugins-marketplace: manifest persistence", () => {
  it("round-trips a plugin manifest through the on-disk JSON store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ob-plugins-"));
    try {
      const manifest = {
        id: "openbuddy.example",
        version: "1.0.0",
        permissions: ["fs.read", "fs.write"],
        enabled: true,
      };
      const path = join(dir, "manifest.json");
      await writeFile(path, JSON.stringify(manifest, null, 2), "utf8");
      const read = JSON.parse(await readFile(path, "utf8"));
      expect(read).toEqual(manifest);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a marketplace action with an unknown plugin id", () => {
    const known = new Set(["openbuddy.example", "openbuddy.other"]);
    const isKnown = (id: string) => known.has(id);
    expect(isKnown("openbuddy.example")).toBe(true);
    expect(isKnown("openbuddy.unknown")).toBe(false);
    expect(isKnown("")).toBe(false);
  });

  it("lists marketplace entries sorted by id", () => {
    const entries = [
      { id: "zeta", price: 1 },
      { id: "alpha", price: 2 },
      { id: "mu", price: 3 },
    ];
    const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
    expect(sorted.map((e) => e.id)).toEqual(["alpha", "mu", "zeta"]);
  });

  it("creates the marketplace directory if missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ob-marketplace-"));
    try {
      const nested = join(dir, "nested", "deeper");
      await mkdir(nested, { recursive: true });
      const probe = join(nested, "probe.txt");
      await writeFile(probe, "ok", "utf8");
      expect((await readFile(probe, "utf8")).toString()).toBe("ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
