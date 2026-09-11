/**
 * @openbuddy/plugin-host — pi-tool-factory facade tests (R38 G1 PR 5).
 *
 * Verifies:
 *   1. defineBuiltinToolSet() returns a valid BuiltinToolSet with all
 *      8 pi-canonical tools (`bash`, `edit`, `find`, `grep`, `ls`,
 *      `powershell`, `read`, `write`).
 *   2. defineBuiltinToolDefinitions() returns 8 `ToolDefinition`s by
 *      default.
 *   3. `exclude` option drops the named tools.
 *   4. `only` option keeps only the named tools.
 *   5. `readOnly: true` is a shortcut for `exclude: ["read", "write"]`.
 */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_TOOL_NAMES,
  defineBuiltinToolDefinitions,
  defineBuiltinToolSet,
  type BuiltinToolSet,
} from "../pi-tool-factory";

const TOOL_KEYS: (keyof BuiltinToolSet)[] = [
  "bash",
  "edit",
  "find",
  "grep",
  "ls",
  "powershell",
  "read",
  "write",
];

const CWD = "/tmp/openbuddy-r38-pi-tool-factory-test";

describe("R38 G1 PR 5 — pi-tool-factory facade", () => {
  it("exports BUILTIN_TOOL_NAMES with all 8 canonical pi tools", () => {
    expect(Object.keys(BUILTIN_TOOL_NAMES).sort()).toEqual(
      ["bash", "edit", "find", "grep", "ls", "powershell", "read", "write"].sort(),
    );
  });

  it("defineBuiltinToolSet returns all 8 built-in tools by default", () => {
    const tools = defineBuiltinToolSet({ cwd: CWD });
    for (const k of TOOL_KEYS) {
      expect(tools[k]).toBeDefined();
      // Pi's AgentTool always carries a string `name`.
      expect(typeof (tools[k] as { name: string }).name).toBe("string");
    }
  });

  it("defineBuiltinToolDefinitions returns all 8 tool definitions by default", () => {
    const defs = defineBuiltinToolDefinitions({ cwd: CWD });
    expect(defs).toHaveLength(8);
    const names = new Set(defs.map((d) => (d as { name: string }).name));
    expect(names).toEqual(
      new Set([
        "bash",
        "edit",
        "find",
        "grep",
        "ls",
        "powershell",
        "read",
        "write",
      ]),
    );
  });

  it("exclude drops the named tools", () => {
    const tools = defineBuiltinToolSet({
      cwd: CWD,
      exclude: ["bash", "powershell"],
    });
    expect(tools.bash).toBeUndefined();
    expect(tools.powershell).toBeUndefined();
    expect(tools.edit).toBeDefined();
    expect(tools.read).toBeDefined();
  });

  it("only keeps the named tools", () => {
    const tools = defineBuiltinToolSet({
      cwd: CWD,
      only: ["read", "grep"],
    });
    expect(Object.keys(tools).sort()).toEqual(["grep", "read"]);
  });

  it("readOnly: true drops both read and write", () => {
    const tools = defineBuiltinToolSet({ cwd: CWD, readOnly: true });
    expect(tools.read).toBeUndefined();
    expect(tools.write).toBeUndefined();
    expect(tools.bash).toBeDefined();
    expect(tools.edit).toBeDefined();
  });

  it("only + exclude combine (intersection semantics)", () => {
    const tools = defineBuiltinToolSet({
      cwd: CWD,
      only: ["bash", "edit", "read"],
      exclude: ["edit"],
    });
    expect(Object.keys(tools).sort()).toEqual(["bash", "read"]);
  });
});
