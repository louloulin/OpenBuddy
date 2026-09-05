import { describe, expect, it } from "vitest"
import {
  createUnifiedPluginManifest,
  updateUnifiedPluginManifest,
  unifiedPluginManifestSchema,
  unifiedPluginSurfaceKinds,
  type UnifiedPluginManifest,
} from "./plugin-manifest"

describe("unified plugin manifest", () => {
  it("normalizes an OpenBuddy bundle with client + pi surfaces", () => {
    const manifest = createUnifiedPluginManifest({
      name: "@openbuddy/sample",
      path: "/tmp/sample",
      version: "1.0.0",
      manifest: {
        openbuddy: {
          bundle: { version: "1" },
          client: { id: "ui" },
        },
        pi: {
          extensions: ["a.js", "b.js"],
          skills: ["x"],
        },
      },
    })
    expect(manifest.schema).toBe(unifiedPluginManifestSchema)
    expect(manifest.namespaces).toEqual(["openbuddy", "pi"])
    expect(manifest.surfaces.map((s) => s.kind).sort()).toEqual(["bundle", "pi", "renderer"])
    expect(manifest.surfaces.find((s) => s.kind === "pi")?.resources).toEqual(["a.js", "b.js", "x"])
    expect(manifest.listed).toBe(false)
    expect(manifest.health).toBe("healthy")
  })

  it("recognizes dsh/typert/cordis surfaces via package.json exports", () => {
    const manifest = createUnifiedPluginManifest({
      name: "@deepseek-ai/dsh-toolbox",
      path: "/tmp/dsh",
      manifest: {
        exports: {
          "./remote": "./dist/remote.js",
          "./typert": "./dist/typert.js",
        },
        peerDependencies: { "@deepseek-ai/cordis": "^1.0.0" },
      },
    })
    const kinds = manifest.surfaces.map((s) => s.kind).sort()
    expect(kinds).toContain("remote")
    expect(kinds).toContain("typert")
    expect(kinds).toContain("cordis")
  })

  it("flags degraded health and missing surfaces", () => {
    const initial = createUnifiedPluginManifest({
      name: "@openbuddy/sample",
      path: "/tmp",
      manifest: {
        openbuddy: { bundle: {} },
        pi: { extensions: ["e.js"] },
      },
    })
    expect(initial.missing).toContain("bundle")
    expect(initial.missing).toContain("pi")

    const updated = updateUnifiedPluginManifest(initial, {
      loaded: ["bundle"],
      health: "degraded",
    })
    expect(updated.loaded).toEqual(["bundle"])
    expect(updated.health).toBe("degraded")
    expect(updated.missing).toContain("pi")
  })

  it("updateUnifiedPluginManifest keeps listed flag when not given", () => {
    const initial: UnifiedPluginManifest = {
      schema: unifiedPluginManifestSchema,
      name: "x",
      path: "/x",
      namespaces: ["openbuddy"],
      surfaces: [],
      listed: true,
      health: "healthy",
      loaded: [],
      missing: [],
    }
    const next = updateUnifiedPluginManifest(initial, { loaded: ["bundle"] })
    expect(next.listed).toBe(true)
    expect(next.loaded).toEqual(["bundle"])
    expect(unifiedPluginSurfaceKinds).toContain("bundle")
  })

  it("treats pi convention flag as pi surface even without declaration", () => {
    const manifest = createUnifiedPluginManifest({
      name: "@earendil-works/sample",
      path: "/tmp/e",
      manifest: {},
      piConvention: true,
    })
    expect(manifest.surfaces.map((s) => s.kind)).toContain("pi")
  })
})
