import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { EngineContext } from "../engine-context.js";
import { todoBuiltin } from "./todo.js";
import { modeExtension } from "./mode.js";
import { persona } from "./persona.js";
import { memoryBuiltin } from "./memory.js";
import { subagentBuiltin } from "./subagent.js";
import { officeBuiltin } from "./office.js";
import { trackBuiltinTools } from "./reserved-tools.js";

/**
 * Built-in extension channel (20261116-pii §5, W0.5): trusted, app-provided Pi extensions such as
 * mode persistence, expert persona, todo/plan, memory and sub-agents.
 *
 * - They are registered after the permission gate, checkpoints and MCP, and before user
 *   extensions, so every tool they add still goes through the permission gate.
 * - They are NOT governed by the user-extension master switch or folder trust (they are the
 *   app's own code), but each can be turned off individually through `enabled` (W0.4 settings).
 * - Tools they register must start with `ob_` and be declared in `tools`; the session tool
 *   allowlist names the declared tools of the enabled built-ins, and extensions loaded from disk
 *   cannot register `ob_*` names (reserved-tools.ts).
 * - Per-session state belongs in session entries (custom entries or tool-result `details`), so
 *   forks, branch switches and regenerations stay correct; only cross-session data (experts,
 *   memory) lives in files.
 */
export interface BuiltinContext {
  engine: EngineContext;
  sessionId: string;
  cwd: string;
}

export interface BuiltinExtension {
  /** Stable id; also the key used to switch it off in the agent settings. */
  id: string;
  /** Name and one-line explanation shown in 设置 · 智能体 (Chinese UI). */
  label?: string;
  description?: string;
  /** Tool names it registers (each must start with `ob_`), for documentation and settings UI. */
  tools?: readonly string[];
  create(ctx: BuiltinContext): ExtensionFactory;
}

/** Each built-in appends itself here (one file per built-in under `builtin/`). */
export const BUILTIN_EXTENSIONS: BuiltinExtension[] = [
  {
    id: "mode",
    label: "模式记忆",
    description: "把做一做 / 想一想 / 问一问记在会话里：重新打开、分叉或切换分支后自动恢复",
    create: (ctx) => modeExtension(ctx),
  },
  persona, // 专家人设 (W2.2)
];
// W3.1 plan / todo (`ob_todo`).
BUILTIN_EXTENSIONS.push(todoBuiltin);
// W5.2 / W5.3 memory injection and `ob_remember`.
BUILTIN_EXTENSIONS.push(memoryBuiltin);
// W3.4 sub-agents (`ob_subagent`): child sessions in the pool, parallel or chained.
BUILTIN_EXTENSIONS.push(subagentBuiltin);
// B2b office artifacts (`ob_docx` / `ob_xlsx` / `ob_pptx`): real OOXML through officegen.
BUILTIN_EXTENSIONS.push(officeBuiltin);

/**
 * Factories for one session, in registration order, skipping the ones switched off. Their tool
 * definitions are recorded (reserved-tools.ts) so the permission gate can tell them from look-alikes.
 */
export function builtinFactories(ctx: BuiltinContext, enabled: (id: string) => boolean = () => true): ExtensionFactory[] {
  return BUILTIN_EXTENSIONS.filter((b) => enabled(b.id)).map((b) => trackBuiltinTools(b.id, b.tools ?? [], b.create(ctx)));
}
/** Tool names of the enabled built-ins: the session tool allowlist names exactly these (no `ob_*`). */
export function builtinToolNames(enabled: (id: string) => boolean = () => true): string[] {
  return BUILTIN_EXTENSIONS.filter((b) => enabled(b.id)).flatMap((b) => [...(b.tools ?? [])]);
}
export { isBuiltinToolDefinition, reserveBuiltinToolNames } from "./reserved-tools.js";
export { readBranchHistory, readBranchState, writeBranchState } from "./session-state.js";
export type { BranchReader, EntryWriter } from "./session-state.js";
