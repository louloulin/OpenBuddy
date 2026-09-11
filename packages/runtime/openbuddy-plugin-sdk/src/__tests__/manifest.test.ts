import { describe, expect, it } from "vitest";
import {
  OPENBUDDY_PLUGIN_SCHEMA,
  PluginManifestError,
  detectTracks,
  parseFrontmatter,
  parsePluginManifest,
  parsePluginManifestFromString,
  parsePluginPackageJson,
  parseSlotContribution,
  pluginManifestSchema,
  stripFrontmatter,
} from "../manifest";

describe("plugin.json parser", () => {
  it("accepts a minimal manifest with a pi track", () => {
    const raw = {
      schema: OPENBUDDY_PLUGIN_SCHEMA,
      name: "sample-plugin",
      version: "1.0.0",
      pi: { handlers: { session_start: "./handlers/session-start.js" } },
    };
    const parsed = parsePluginManifest(raw);
    expect(parsed.name).toBe("sample-plugin");
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.pi?.handlers?.session_start).toBe("./handlers/session-start.js");
  });

  it("accepts a manifest declaring all four tracks", () => {
    const raw = {
      schema: OPENBUDDY_PLUGIN_SCHEMA,
      name: "@openbuddy/full",
      version: "0.2.0",
      engines: { openbuddy: ">=0.14.0" },
      main: "./index.js",
      pi: { tools: ["./tools/index.js"], commands: ["./commands/index.js"] },
      ui: {
        "chat-header:status": {
          type: "react-component",
          component: "./components/StatusBadge.jsx",
        },
        "file-menu:open": {
          type: "menu-item",
          label: "Open Sample",
          accelerator: "CmdOrCtrl+O",
          onClick: "./commands/open.js",
        },
      },
      harness: { contributes: { "dsh.service": { name: "sample" } } },
    };
    const parsed = parsePluginManifest(raw);
    expect(parsed.engines?.openbuddy).toBe(">=0.14.0");
    expect(Object.keys(parsed.ui ?? {}).sort()).toEqual([
      "chat-header:status",
      "file-menu:open",
    ]);
    expect(parsed.harness?.contributes?.["dsh.service"]).toEqual({ name: "sample" });
  });

  it("rejects manifests with unknown top-level keys", () => {
    const raw = {
      name: "x",
      version: "1.0.0",
      pi: { handlers: { session_start: "./a.js" } },
      not_a_field: true,
    };
    expect(() => parsePluginManifest(raw)).toThrow(PluginManifestError);
  });

  it("rejects manifests without any track", () => {
    const raw = { name: "empty", version: "1.0.0" };
    expect(() => parsePluginManifest(raw)).toThrow(/at least one track/);
  });

  it("rejects malformed version strings", () => {
    const raw = {
      name: "bad-version",
      version: "v1",
      pi: { handlers: { session_start: "./a.js" } },
    };
    expect(() => parsePluginManifest(raw)).toThrow(/semver/);
  });

  it("rejects slot contributions with the wrong shape", () => {
    expect(() =>
      parseSlotContribution({ type: "menu-item", label: "x" }),
    ).toThrow(PluginManifestError);
  });

  it("exposes a zod schema that mirrors the parser", () => {
    const raw = {
      name: "zod-shape",
      version: "0.1.0",
      ui: { x: { type: "status-bar", id: "y", getText: "./get-text.js" } },
    };
    const safe = pluginManifestSchema.safeParse(raw);
    expect(safe.success).toBe(true);
  });

  it("detectTracks surfaces declared tracks and skips runtime ones", () => {
    const tracks = detectTracks({
      name: "x",
      version: "1.0.0",
      pi: { handlers: {} },
      ui: { x: { type: "status-bar", id: "y", getText: "./a.js" } },
    });
    expect([...tracks].sort()).toEqual(["pi", "ui"]);
  });
});

describe("package.json parser", () => {
  it("reads the openbuddy block and falls back to package name/version", () => {
    const raw = {
      name: "@scope/sample",
      version: "1.2.3",
      openbuddy: {
        main: "./index.js",
        pi: { commands: ["./commands/index.js"] },
      },
    };
    const parsed = parsePluginPackageJson(raw);
    expect(parsed.name).toBe("@scope/sample");
    expect(parsed.version).toBe("1.2.3");
    expect(parsed.main).toBe("./index.js");
    expect(parsed.pi?.commands?.[0]).toBe("./commands/index.js");
  });

  it("throws when the package has no openbuddy field", () => {
    expect(() => parsePluginPackageJson({ name: "x", version: "1.0.0" })).toThrow(
      /`openbuddy` field/,
    );
  });

  it("rejects packages whose openbuddy block is malformed", () => {
    expect(() =>
      parsePluginPackageJson({
        name: "x",
        version: "1.0.0",
        openbuddy: { version: "not-semver" },
      }),
    ).toThrow(PluginManifestError);
  });
});

describe("markdown frontmatter parser (parsePluginManifestFromString)", () => {
  it("accepts a minimal PLUGIN.md with a pi track in YAML frontmatter", () => {
    const content = [
      "---",
      `schema: ${OPENBUDDY_PLUGIN_SCHEMA}`,
      "name: sample-plugin",
      "version: 1.0.0",
      "pi:",
      "  handlers:",
      "    session_start: ./handlers/session-start.js",
      "---",
      "# Sample plugin",
      "Long-form markdown body.",
      "",
    ].join("\n");
    const parsed = parsePluginManifestFromString(content);
    expect(parsed.name).toBe("sample-plugin");
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.pi?.handlers?.session_start).toBe("./handlers/session-start.js");
  });

  it("accepts all four tracks in frontmatter", () => {
    const content = [
      "---",
      "name: '@openbuddy/full'",
      "version: 0.2.0",
      "engines:",
      "  openbuddy: '>=0.14.0'",
      "main: ./index.js",
      "pi:",
      "  tools:",
      "    - ./tools/index.js",
      "  commands:",
      "    - ./commands/index.js",
      "ui:",
      "  'chat-header:status':",
      "    type: react-component",
      "    component: ./components/StatusBadge.jsx",
      "  'file-menu:open':",
      "    type: menu-item",
      "    label: Open Sample",
      "    accelerator: CmdOrCtrl+O",
      "    onClick: ./commands/open.js",
      "harness:",
      "  contributes:",
      "    dsh.service:",
      "      name: sample",
      "---",
      "# full plugin",
      "",
    ].join("\n");
    const parsed = parsePluginManifestFromString(content, {
      sourcePath: "<PLUGIN.md>",
    });
    expect(parsed.engines?.openbuddy).toBe(">=0.14.0");
    expect(Object.keys(parsed.ui ?? {}).sort()).toEqual([
      "chat-header:status",
      "file-menu:open",
    ]);
    expect(parsed.harness?.contributes?.["dsh.service"]).toEqual({ name: "sample" });
  });

  it("rejects content with no frontmatter delimiters", () => {
    expect(() =>
      parsePluginManifestFromString("# plain markdown\n\nNo frontmatter here."),
    ).toThrow(/no YAML frontmatter/);
  });

  it("rejects frontmatter that does not declare any track", () => {
    const content = "---\nname: empty\nversion: 1.0.0\n---\nbody\n";
    expect(() => parsePluginManifestFromString(content)).toThrow(/at least one track/);
  });

  it("rejects malformed frontmatter (zod errors surface)", () => {
    const content = "---\nname: bad-version\nversion: v1\npi: {}\n---\nbody\n";
    expect(() => parsePluginManifestFromString(content)).toThrow(/semver/);
  });

  it("rejects non-string content", () => {
    // Cast through `unknown` so TS does not block the runtime check.
    expect(() => parsePluginManifestFromString(null as unknown as string)).toThrow(
      /must be a string/,
    );
  });

  it("withBody=true exposes the markdown body for opt-in callers", () => {
    const content = [
      "---",
      "name: sample-plugin",
      "version: 1.0.0",
      "pi:",
      "  handlers:",
      "    session_start: ./a.js",
      "---",
      "# heading",
      "",
      "paragraph body",
      "",
    ].join("\n");
    const parsed = parsePluginManifestFromString(content, { withBody: true }) as ReturnType<
      typeof parsePluginManifestFromString
    > & { body?: string };
    expect(parsed.body).toContain("# heading");
    expect(parsed.body).toContain("paragraph body");
  });

  it("parseFrontmatter and stripFrontmatter are pi re-exports", () => {
    // Sanity check: the re-exports call through to pi's parser, not a
    // local copy. Any non-empty frontmatter should yield the same shape
    // pi documents (`{ frontmatter, body }`).
    const content = "---\nname: x\n---\nbody\n";
    const parsed = parseFrontmatter(content);
    expect(parsed.frontmatter).toEqual({ name: "x" });
    expect(parsed.body).toBe("body");
    // stripFrontmatter returns just the body.
    expect(stripFrontmatter(content)).toBe("body");
  });
});
