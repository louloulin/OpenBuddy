import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPluginStateStore, type PluginStateSnapshot } from "./persistence";

describe("plugin state persistence", () => {
  it("round-trips a single override through read / write", async () => {
    let stored: PluginStateSnapshot | null = null;
    const store = createPluginStateStore({
      read: async () => stored,
      write: async (snapshot) => {
        stored = snapshot;
      },
    });
    const result = await store.patch("openbuddy-email", { disabled: true });
    expect(result.overrides["openbuddy-email"]).toEqual({ disabled: true });
    const reloaded = await store.read();
    expect(reloaded?.overrides["openbuddy-email"]?.disabled).toBe(true);
  });

  it("merges multiple overrides on the same id without losing siblings", async () => {
    let stored: PluginStateSnapshot | null = null;
    const store = createPluginStateStore({
      read: async () => stored,
      write: async (snapshot) => {
        stored = snapshot;
      },
    });
    await store.patch("openbuddy-email", { disabled: true });
    await store.patch("openbuddy-email", { config: { enabled: false } });
    const final = await store.read();
    expect(final?.overrides["openbuddy-email"]).toEqual({
      disabled: true,
      config: { enabled: false },
    });
  });

  it("composePatches emits one patch per stored id (only", async () => {
    let stored: PluginStateSnapshot | null = null;
    const store = createPluginStateStore({
      read: async () => stored,
      write: async (snapshot) => {
        stored = snapshot;
      },
    });
    await store.patch("openbuddy-email", { disabled: true });
    await store.patch("openbuddy-automation", { config: { enabled: false } });
    const layers = await store.composePatches();
    expect(layers).toHaveLength(1);
    expect(layers[0]).toHaveLength(2);
    expect(layers[0]?.find((p) => p.id === "openbuddy-email")).toMatchObject({ disabled: true });
    expect(layers[0]?.find((p) => p.id === "openbuddy-automation")).toMatchObject({
      config: { enabled: false },
    });
  });

  it("reset removes an override entirely", async () => {
    let stored: PluginStateSnapshot | null = null;
    const store = createPluginStateStore({
      read: async () => stored,
      write: async (snapshot) => {
        stored = snapshot;
      },
    });
    await store.patch("openbuddy-email", { disabled: true });
    await store.reset("openbuddy-email");
    expect((await store.read())?.overrides["openbuddy-email"]).toBeUndefined();
  });

  it("composePatches returns [] when no overrides are stored", async () => {
    const store = createPluginStateStore({
      read: async () => null,
      write: async () => undefined,
    });
    const layers = await store.composePatches();
    expect(layers).toEqual([]);
  });

  it("uses injected `now` for the snapshot timestamp", async () => {
    let captured: PluginStateSnapshot | null = null;
    const store = createPluginStateStore({
      read: async () => null,
      write: async (snapshot) => {
        captured = snapshot;
      },
      now: () => "2026-08-27T07:00:00.000Z",
    });
    await store.patch("openbuddy-email", { disabled: true });
    expect((captured as PluginStateSnapshot | null)?.updatedAt).toBe("2026-08-27T07:00:00.000Z");
  });

  it("stores Pi extension overrides separately from Cordis plugin patches", async () => {
    let stored: PluginStateSnapshot | null = null;
    const store = createPluginStateStore({
      read: async () => stored,
      write: async (snapshot) => { stored = snapshot; },
    });
    await store.patchPiExtension("pi-context-prune", { disabled: true, config: { maxTokens: 1000 } });
    expect((await store.read())?.piExtensions?.["pi-context-prune"]).toEqual({ disabled: true, config: { maxTokens: 1000 } });
    await store.resetPiExtension("pi-context-prune");
    expect((await store.read())?.piExtensions?.["pi-context-prune"]).toBeUndefined();
  });

  it("preserves Pi extension overrides while patching or resetting Cordis plugins", async () => {
    let stored: PluginStateSnapshot | null = null;
    const store = createPluginStateStore({
      read: async () => stored,
      write: async (snapshot) => { stored = snapshot; },
    });
    await store.patchPiExtension("pi-context-prune", { enabled: false });
    await store.patch("openbuddy-email", { config: { enabled: false } });
    expect((await store.read())?.piExtensions?.["pi-context-prune"]).toEqual({ enabled: false });
    await store.reset("openbuddy-email");
    expect((await store.read())?.piExtensions?.["pi-context-prune"]).toEqual({ enabled: false });
  });

  it("preserves the committed transaction marker across override mutations", async () => {
    let stored: PluginStateSnapshot | null = {
      updatedAt: "2026-08-27T07:00:00.000Z",
      overrides: {},
      piExtensions: {},
      commit: {
        generation: 4,
        transactionId: "plugin-commit-4",
        kind: "profile-reload",
        target: "profile",
        committedAt: "2026-08-27T07:00:00.000Z",
      },
    };
    const store = createPluginStateStore({
      read: async () => stored,
      write: async (snapshot) => { stored = snapshot; },
    });
    await store.patch("openbuddy-email", { disabled: true });
    await store.patchPiExtension("pi-context-prune", { enabled: false });
    await store.reset("openbuddy-email");
    expect((await store.read())?.commit).toMatchObject({ generation: 4, transactionId: "plugin-commit-4" });
  });
});

describe("plugin state persistence — default JSON adapter", () => {
  it("writes and reads snapshots through the default filesystem adapter", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbuddy-plugin-state-"));
    try {
      const filePath = join(directory, "openbuddy-plugins.json");
      const store = createPluginStateStore({ path: filePath });
      const persisted = await store.patch("openbuddy-email", { disabled: true });
      expect(persisted.overrides["openbuddy-email"]).toEqual({ disabled: true });
      const onDisk = JSON.parse(await readFile(filePath, "utf8")) as PluginStateSnapshot;
      expect(onDisk.overrides["openbuddy-email"]).toEqual({ disabled: true });
      const reloaded = await createPluginStateStore({ path: filePath }).read();
      expect(reloaded?.overrides["openbuddy-email"]).toEqual({ disabled: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
