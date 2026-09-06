import { describe, expect, it } from "vitest";
import {
  discoverRendererPluginManifest,
  discoverRendererPluginManifestUncached,
} from "./renderer-manifest";
import { createDefaultAgentHostState } from "../_default-state";
import type { AgentHostState } from "../_state-shape";

/**
 * A loader with zero plugin entries — the uncached path then only returns
 * the builtin DeepSeek client entries, which is deterministic and needs no
 * real plugins loaded.
 */
function makeEmptyLoaderState(): AgentHostState {
  const state = createDefaultAgentHostState();
  (state as unknown as { loader: unknown }).loader = {
    entries: () => [],
  };
  return state;
}

const profileArtifactModuleUrl = (path: string) => `openbuddy://${path}`;

describe("discoverRendererPluginManifestUncached", () => {
  it("returns the builtin DeepSeek client entries when loader is empty", async () => {
    const state = makeEmptyLoaderState();
    const entries = await discoverRendererPluginManifestUncached(state, profileArtifactModuleUrl);
    expect(entries.length).toBeGreaterThan(0);
    // every builtin entry points at the static module URL scheme
    for (const entry of entries) {
      expect(entry.moduleUrl?.startsWith("openbuddy:static/")).toBe(true);
    }
  });

  it("returns [] when loader is null", async () => {
    const state = createDefaultAgentHostState();
    const entries = await discoverRendererPluginManifestUncached(state, profileArtifactModuleUrl);
    expect(entries).toEqual([]);
  });
});

describe("discoverRendererPluginManifest (cache + stale retry)", () => {
  it("caches the promise for the current generation and reuses it", async () => {
    const state = makeEmptyLoaderState();
    // seed an existing cache with a distinct marker value to prove the cache-hit
    // fast path (uncached would return builtin DeepSeek entries, not this marker)
    const seededValue = [{ id: "@test/seeded", moduleUrl: "openbuddy:static/seeded" }] as never;
    const seeded = Promise.resolve(seededValue);
    state.rendererPluginManifestCache = { generation: state.profileArtifactGeneration, promise: seeded };
    const first = await discoverRendererPluginManifest(state, profileArtifactModuleUrl);
    const second = await discoverRendererPluginManifest(state, profileArtifactModuleUrl);
    expect(first).toBe(seededValue);
    expect(second).toBe(seededValue);
  });

  it("invalidates the cache when discovery rejects", async () => {
    const state = createDefaultAgentHostState();
    (state as unknown as { loader: unknown }).loader = {
      entries: () => {
        throw new Error("boom");
      },
    };
    // generation is fresh so discoverRendererPluginManifestUncached runs and rejects;
    // the matching cache entry must be cleared afterward.
    await expect(discoverRendererPluginManifest(state, profileArtifactModuleUrl)).rejects.toThrow("boom");
    expect(state.rendererPluginManifestCache).toBeNull();
  });
});
