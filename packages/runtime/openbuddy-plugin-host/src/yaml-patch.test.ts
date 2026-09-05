import { describe, expect, it } from "vitest";
import { parseCordisPatch, patchRowsToOpenBuddy } from "./yaml-patch";
import { readFile } from "node:fs/promises";

describe("parseCordisPatch (deepseek-harness patch format)", () => {
  it("parses an `insert:` block into one patch row with an insert array", () => {
    const source = `
- insert:
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'
    - id: llm
      name: '@deepseek-ai/dsh-llm'
`;
    const parsed = parseCordisPatch(source);
    expect(parsed.layers).toHaveLength(1);
    const [layer] = parsed.layers;
    expect(layer?.rows).toHaveLength(1);
    const insert = layer?.rows[0];
    expect(insert).toMatchObject({
      insert: [
        { id: "timer", name: "@deepseek-ai/cordis-plugin-timer" },
        { id: "llm", name: "@deepseek-ai/dsh-llm" },
      ],
    });
  });

  it("parses a keyed update patch (id + name + config) into one row", () => {
    const source = `
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
`;
    const parsed = parseCordisPatch(source);
    const layer = parsed.layers[0]!;
    expect(layer.rows).toHaveLength(1);
    expect(layer.rows[0]).toMatchObject({
      id: "agent-default-model",
      name: "@deepseek-ai/dsh-agent-default-model",
      config: {
        provider: "deepseek-official",
        model: "deepseek-v4-flash",
      },
    });
  });

  it("parses a mix of insert + update rows in a single patch layer", () => {
    const source = `
- insert:
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'

- id: llm
  name: '@deepseek-ai/dsh-llm'
  config:
    provider: deepseek-official
`;
    const parsed = parseCordisPatch(source);
    const layer = parsed.layers[0]!;
    expect(layer.rows).toHaveLength(2);
    expect(layer.rows[0]).toMatchObject({
      insert: [{ id: "timer", name: "@deepseek-ai/cordis-plugin-timer" }],
    });
    expect(layer.rows[1]).toMatchObject({
      id: "llm",
      name: "@deepseek-ai/dsh-llm",
      config: { provider: "deepseek-official" },
    });
  });

  it("recognises !!js expressions and exposes them as JsExpr payloads", () => {
    const source = `
- id: session-persistence-jsonl
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: !!js dshHomePath('sessions')
`;
    const parsed = parseCordisPatch(source);
    const layer = parsed.layers[0]!;
    expect(layer.rawJsExprs).toHaveLength(1);
    const expr = layer.rawJsExprs[0]!;
    expect(expr.__jsExpr).toBe("dshHomePath('sessions')");
    expect((layer.rows[0] as { config: { root: unknown } }).config.root).toEqual({
      __jsExpr: "dshHomePath('sessions')",
    });
  });

  it("ignores comment lines and in-line comments", () => {
    const source = `
# leading comment
- insert:    # trailing comment
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'  # name comment
`;
    const parsed = parseCordisPatch(source);
    const layer = parsed.layers[0]!;
    expect(layer.rows[0]).toMatchObject({
      insert: [{ id: "timer", name: "@deepseek-ai/cordis-plugin-timer" }],
    });
  });

  it("handles flow-style arrays and inline JSON", () => {
    const source = `
- id: thresholds
  name: '@deepseek-ai/dsh-repeat-tool-reminder'
  config:
    thresholds: [3, 5, 8]
`;
    const parsed = parseCordisPatch(source);
    const layer = parsed.layers[0]!;
    const row = layer.rows[0] as { config: { thresholds: number[] } };
    expect(row.config.thresholds).toEqual([3, 5, 8]);
  });

  it("patchRowsToOpenBuddy evaluates !!js configs against a scope", () => {
    const source = `
- id: session-persistence-jsonl
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: !!js dshHomePath('sessions')
`;
    const parsed = parseCordisPatch(source);
    const [layer] = parsed.layers;
    const obPatches = patchRowsToOpenBuddy(layer!.rows, {
      dshHomePath: (sub: string) => `/home/me/.dsh/${sub}`,
    });
    expect(obPatches[0]).toMatchObject({
      id: "session-persistence-jsonl",
      config: { root: "/home/me/.dsh/sessions" },
    });
  });

  it("provides a safe default process snapshot for real Harness expressions", () => {
    const parsed = parseCordisPatch(`
- insert:
    - id: cwd
      name: '@scope/cwd'
      config:
        root: !!js process.cwd()
`);
    const patches = patchRowsToOpenBuddy(parsed.layers[0]!.rows);
    expect((patches[0]?.insert?.[0]?.config as { root?: unknown }).root).toBe(process.cwd());
  });

  it("fills missing process helpers without overriding a caller's platform or env", () => {
    const parsed = parseCordisPatch(`
- insert:
    - id: platform
      name: '@scope/platform'
      config:
        platform: !!js process.platform
        root: !!js process.cwd()
`);
    const patches = patchRowsToOpenBuddy(parsed.layers[0]!.rows, {
      process: { platform: "darwin", env: {} },
    });
    expect(patches[0]?.insert?.[0]?.config).toMatchObject({
      platform: "darwin",
      root: process.cwd(),
    });
  });


  it("parses the real deepseek-harness base/headless/web-app patch files", async () => {
    const paths = [
      "/Users/louloulin/appx/deepseek-harness/packages/bundle/base/cordis.patch.yml",
      "/Users/louloulin/appx/deepseek-harness/packages/bundle/headless/cordis.patch.yml",
      "/Users/louloulin/appx/deepseek-harness/packages/bundle/web-app/cordis.patch.yml",
    ];
    for (const path of paths) {
      const parsed = parseCordisPatch(await readFile(path, "utf-8"));
      expect(parsed.layers).toHaveLength(1);
      expect(parsed.layers[0]?.rows.length).toBeGreaterThan(0);
      expect(parsed.layers[0]?.rawJsExprs.length).toBeGreaterThan(0);
    }
  });

  it("returns zero layers for an empty document", () => {
    const parsed = parseCordisPatch("");
    expect(parsed.layers).toEqual([]);
  });

  it("preserves group children on keyed patch updates", () => {
    const parsed = parseCordisPatch(`
- id: extensions
  children:
    - id: logger
      name: '@scope/logger'
      config:
        enabled: !!js enabled
`);
    const rows = patchRowsToOpenBuddy(parsed.layers[0]!.rows, { enabled: true });
    expect(rows[0]).toMatchObject({
      id: "extensions",
      children: [{ id: "logger", name: "@scope/logger", config: { enabled: true } }],
    });
  });

  it("parses disabled / group / inject fields", () => {
    const source = `
- id: legacy
  name: './plugins/legacy'
  disabled: true
  group: false
  inject: ['session']
`;
    const parsed = parseCordisPatch(source);
    const layer = parsed.layers[0]!;
    expect(layer.rows[0]).toMatchObject({
      id: "legacy",
      name: "./plugins/legacy",
      disabled: true,
      group: false,
      inject: ["session"],
    });
  });

  it("evaluates `disabled: !!js <expr>` against the scope (deepseek platform/feature gates)", () => {
    const source = `
- insert:
    - id: bash-only
      name: '@scope/bash-only'
      disabled: !!js process.platform === 'win32'
    - id: always-on
      name: '@scope/always-on'
`;
    const parsed = parseCordisPatch(source);
    const [layer] = parsed.layers;
    const patches = patchRowsToOpenBuddy(layer!.rows, {
      // Reproduce the deepseek-harness scope shape: a bare `process`
      // reference in the YAML maps to Node's `process` global so
      // expressions like `process.platform === 'win32'` work the same
      // way as in the deepseek reference bundles.
      process: { platform: "linux" },
    });
    const insert = patches[0]?.insert ?? [];
    expect(insert[0]?.disabled).toBe(false);
    expect(insert[1]?.disabled).toBeUndefined();
  });

  it("evaluates `disabled: !!js <expr>` to true when the gate matches (Windows case)", () => {
    // `disabled: !!js process.platform === 'win32'` — disables the
    // entry on Windows and keeps it active elsewhere. We pass a
    // Windows scope so the gate fires.
    const source = `
- insert:
    - id: pwsh-only
      name: '@scope/pwsh-only'
      disabled: !!js process.platform === 'win32'
`;
    const parsed = parseCordisPatch(source);
    const [layer] = parsed.layers;
    const patches = patchRowsToOpenBuddy(layer!.rows, {
      process: { platform: "win32" },
    });
    expect(patches[0]?.insert?.[0]?.disabled).toBe(true);
  });
});
