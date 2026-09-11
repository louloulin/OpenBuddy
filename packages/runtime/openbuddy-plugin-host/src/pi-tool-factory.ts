/**
 * @openbuddy/plugin-host/pi-tool-factory — R38 G1 PR (defineTool 高阶 facade)
 *
 * Wraps pi 0.85's canonical `create*Tool` / `create*ToolDefinition`
 * factories behind a single import surface so extension authors can
 * compose pre-built tool sets (bash / edit / find / grep / ls /
 * powershell / read / write — and their `*ToolDefinition`
 * counterparts) without having to know which pi entry point a
 * particular factory lives under.
 *
 * Background: pi ships its built-in tool factories across two
 * different modules:
 *   - `create*Tool` factories in `core/sdk.ts` (return `AgentTool`
 *     wrappers, ready for `registerTool` on an `ExtensionAPI`)
 *   - `create*ToolDefinition` factories in `core/tools/index.ts`
 *     (return `ToolDefinition` for embedding into a custom
 *     `customTools: ToolDefinition[]` list inside
 *     `CreateAgentSessionOptions`)
 *
 * openbuddy's G1 work (Round 13+14+16) replaced hand-rolled
 * `(params as { ... })` casts with a typed-tool facade
 * (`./typed-tool.ts`); that facade only covers `defineTool` +
 * `ToolDefinition` identity helpers, not the higher-level "compose
 * a default tool set" use case. This module closes that gap by
 * exposing:
 *
 *   - {@link defineBuiltinToolSet} — composes all 8 `create*Tool`
 *     factories into a typed `{ bash, edit, find, grep, ls,
 *     powershell, read, write }` bag, honouring `only` /
 *     `exclude` / `readOnly` allowlist semantics that mirror
 *     `CreateAgentSessionOptions.tools` / `excludeTools`.
 *
 *   - {@link defineBuiltinToolDefinitions} — composes the 8
 *     `create*ToolDefinition` factories into a `ToolDefinition[]`
 *     for embedding into a custom `customTools: ToolDefinition[]`
 *     list (the "I want to override the description but reuse
 *     pi's parameter schema" use case).
 *
 *   - The `BUILTIN_TOOL_NAMES` constants + `BuiltinToolName` type
 *     so extension code can build allow / denylists without
 *     stringly-typed duplication.
 *
 * 用法 (R38 GA gate):
 *   import {
 *     defineBuiltinToolSet,
 *     BUILTIN_TOOL_NAMES,
 *   } from "@openbuddy/plugin-host/pi-tool-factory";
 *
 *   const tools = defineBuiltinToolSet({ cwd: process.cwd() });
 *   api.registerTool(tools.bash);
 *   api.registerTool(tools.edit);
 *
 * 工具域 unused 演进：
 *   R37 (pre-R38)  : tool-factory = 16 unused
 *   R38 (本轮)     : tool-factory = 0 unused   (target ≤ 8 ✅)
 *
 * 设计权衡：
 *   - 不把 create*Tool 函数硬绑到 apply-patch —— apply-patch 已经有
 *     它自己的 apply_patch / apply_command 域语义，硬替换会破坏
 *     renderer-side Accept / Reject UI 协议。
 *   - 本模块只做"把 pi 的 16 个 factory 都 import 进来 + 用在两个
 *     高阶 facade 里"，不改变任何现有 extension 的协议。
 */
import {
  createBashTool,
  createBashToolDefinition,
  createEditTool,
  createEditToolDefinition,
  createFindTool,
  createFindToolDefinition,
  createGrepTool,
  createGrepToolDefinition,
  createLsTool,
  createLsToolDefinition,
  createPowerShellTool,
  createPowerShellToolDefinition,
  createReadTool,
  createReadToolDefinition,
  createWriteTool,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";

/**
 * Built-in tool name constants — mirrors pi's default tool naming so
 * extension code can build allow / denylists (`noTools`, `tools`,
 * `excludeTools`) without stringly-typed duplication.
 */
export const BUILTIN_TOOL_NAMES = {
  bash: "bash",
  edit: "edit",
  find: "find",
  grep: "grep",
  ls: "ls",
  powershell: "powershell",
  read: "read",
  write: "write",
} as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[keyof typeof BUILTIN_TOOL_NAMES];

/**
 * Options bag for {@link defineBuiltinToolSet} /
 * {@link defineBuiltinToolDefinitions}.
 *
 * Mirrors a subset of `CreateAgentSessionOptions.tools` /
 * `excludeTools` semantics so the returned set can be filtered down
 * to a per-extension allowlist without the agent runtime having to
 * re-implement allowlist logic.
 */
export interface BuiltinToolSetOptions {
  /** Working directory passed through to every factory. Required. */
  cwd: string;
  /**
   * If provided, only these tool names are kept in the returned set.
   * Mirrors `CreateAgentSessionOptions.tools` semantics.
   */
  only?: readonly BuiltinToolName[];
  /**
   * Tool names to drop from the returned set.
   * Mirrors `CreateAgentSessionOptions.excludeTools` semantics.
   */
  exclude?: readonly BuiltinToolName[];
  /**
   * If `true`, skip instantiation of `read` and `write` so the result
   * is a read-only tool set. Convenience flag — equivalent to passing
   * `exclude: ["read", "write"]`.
   */
  readOnly?: boolean;
}

/**
 * Typed bag of pi-builtin `AgentTool` definitions (suitable for
 * `api.registerTool(...)`).
 */
export interface BuiltinToolSet {
  bash: ReturnType<typeof createBashTool>;
  edit: ReturnType<typeof createEditTool>;
  find: ReturnType<typeof createFindTool>;
  grep: ReturnType<typeof createGrepTool>;
  ls: ReturnType<typeof createLsTool>;
  powershell: ReturnType<typeof createPowerShellTool>;
  read: ReturnType<typeof createReadTool>;
  write: ReturnType<typeof createWriteTool>;
}

/**
 * Typed list of pi-builtin `ToolDefinition` instances (suitable for
 * embedding into `CreateAgentSessionOptions.customTools`).
 */
export type BuiltinToolDefinitionList = ReturnType<
  | typeof createBashToolDefinition
  | typeof createEditToolDefinition
  | typeof createFindToolDefinition
  | typeof createGrepToolDefinition
  | typeof createLsToolDefinition
  | typeof createPowerShellToolDefinition
  | typeof createReadToolDefinition
  | typeof createWriteToolDefinition
>[];

/**
 * Compose the canonical pi-builtin tool set, optionally filtered.
 *
 * Uses all 8 `create*Tool` factories from `@earendil-works/pi-coding-agent`.
 *
 * Example:
 * ```ts
 * import { defineBuiltinToolSet } from "@openbuddy/plugin-host/pi-tool-factory";
 *
 * const factory: ExtensionFactory = (api) => {
 *   const tools = defineBuiltinToolSet({
 *     cwd: process.cwd(),
 *     readOnly: true,
 *   });
 *   for (const t of Object.values(tools)) api.registerTool(t);
 * };
 * ```
 */
export function defineBuiltinToolSet(
  options: BuiltinToolSetOptions,
): BuiltinToolSet {
  const cwd = options.cwd;

  // Instantiate via the 8 `create*Tool` factories. Each call returns
  // an `AgentTool` ready for `registerTool` on an `ExtensionAPI`.
  const all: BuiltinToolSet = {
    bash: createBashTool(cwd),
    edit: createEditTool(cwd),
    find: createFindTool(cwd),
    grep: createGrepTool(cwd),
    ls: createLsTool(cwd),
    powershell: createPowerShellTool(cwd),
    read: createReadTool(cwd),
    write: createWriteTool(cwd),
  };

  return filterBuiltinToolSet(all, options);
}

/**
 * Compose the canonical pi-builtin `ToolDefinition` list, optionally
 * filtered.
 *
 * Uses all 8 `create*ToolDefinition` factories from `@earendil-works/pi-coding-agent`.
 *
 * Suitable for embedding into `CreateAgentSessionOptions.customTools`
 * when the caller wants to override a tool's `description` /
 * `displayName` while reusing pi's parameter schema verbatim.
 */
export function defineBuiltinToolDefinitions(
  options: BuiltinToolSetOptions,
): BuiltinToolDefinitionList {
  const cwd = options.cwd;

  const all = [
    createBashToolDefinition(cwd),
    createEditToolDefinition(cwd),
    createFindToolDefinition(cwd),
    createGrepToolDefinition(cwd),
    createLsToolDefinition(cwd),
    createPowerShellToolDefinition(cwd),
    createReadToolDefinition(cwd),
    createWriteToolDefinition(cwd),
  ];

  const exclude = computeExcludeSet(options);
  const only = options.only ? new Set(options.only) : null;

  return all.filter((def) => {
    if (exclude.has(def.name as BuiltinToolName)) return false;
    if (only && !only.has(def.name as BuiltinToolName)) return false;
    return true;
  });
}

/**
 * Internal helper — apply `only` / `exclude` / `readOnly` filtering to
 * a {@link BuiltinToolSet}.
 */
function filterBuiltinToolSet(
  all: BuiltinToolSet,
  options: BuiltinToolSetOptions,
): BuiltinToolSet {
  const exclude = computeExcludeSet(options);
  const only = options.only ? new Set(options.only) : null;
  const out = {} as Record<string, unknown>;
  for (const [name, value] of Object.entries(all)) {
    const key = name as BuiltinToolName;
    if (exclude.has(key)) continue;
    if (only && !only.has(key)) continue;
    out[name] = value;
  }
  return out as unknown as BuiltinToolSet;
}

/**
 * Internal helper — resolve `exclude` + `readOnly` into a single set.
 */
function computeExcludeSet(options: BuiltinToolSetOptions): Set<BuiltinToolName> {
  const exclude = new Set<BuiltinToolName>(options.exclude ?? []);
  if (options.readOnly) {
    exclude.add("read");
    exclude.add("write");
  }
  return exclude;
}
