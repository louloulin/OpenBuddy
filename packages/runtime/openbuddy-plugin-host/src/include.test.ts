import { describe, expect, it } from "vitest";
import { Context } from "@openbuddy/cordis";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIncludePlugin, HarnessPluginLoader } from "./index";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "openbuddy-include-"));
  const path = join(dir, "entries.yml");
  const modules: Record<string, unknown> = {
    stable: { apply: () => undefined },
    replacement: { apply: () => undefined },
    include: createIncludePlugin(),
  };
  const loader = new HarnessPluginLoader({
    context: new Context(),
    importer: async (specifier) => modules[specifier],
  });
  return { dir, path, loader };
}

describe("DeepSeek Include facade", () => {
  it("loads initial entries and refreshes them transactionally", async () => {
    const { dir, path, loader } = await fixture();
    try {
      await loader.load([{ id: "include", name: "include", config: {
        path,
        initial: [{ id: "entry", name: "stable", config: { enabled: true } }],
      } }]);
      await (loader.getContext().get("include") as { refresh(): Promise<void> }).refresh();
      expect(loader.resolve("entry").status.state).toBe("loaded");
      await writeFile(path, "- id: entry\n  name: replacement\n");
      await (loader.getContext().get("include") as { refresh(): Promise<void> }).refresh();
      expect(loader.resolve("entry").options.name).toBe("replacement");
      expect((await readFile(path, "utf8"))).toContain("replacement");
    } finally {
      await loader.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("restores the previous entries when a refreshed plugin fails", async () => {
    const { dir, path, loader } = await fixture();
    try {
      const modules = loader.getContext();
      await writeFile(path, "- id: entry\n  name: stable\n");
      await loader.load([{ id: "include", name: "include", config: { path } }]);
      await (modules.get("include") as { refresh(): Promise<void> }).refresh();
      const original = loader.resolve("entry").options.name;
      await writeFile(path, "- id: entry\n  name: missing\n");
      await expect((modules.get("include") as { refresh(): Promise<void> }).refresh()).rejects.toThrow();
      expect(loader.resolve("entry").options.name).toBe(original);
    } finally {
      await loader.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes overlapping refreshes and disposes the mounted tree", async () => {
    const { dir, path, loader } = await fixture();
    try {
      await writeFile(path, "- id: entry\n  name: stable\n");
      await loader.load([{ id: "include", name: "include", config: { path } }]);
      const include = loader.getContext().get("include") as { refresh(): Promise<void> };
      await Promise.all([
        (async () => { await writeFile(path, "- id: entry\n  name: replacement\n"); await include.refresh(); })(),
        include.refresh(),
      ]);
      expect(loader.resolve("entry").options.name).toBe("replacement");
      await loader.dispose();
      expect(loader.list().map((status) => status.id)).not.toContain("entry");
      expect(loader.list().find((status) => status.id === "include")?.state).toBe("unloaded");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
