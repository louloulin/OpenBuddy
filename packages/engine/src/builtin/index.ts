import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { EngineContext } from "../engine-context.js";

/**
 * Built-in extension channel (20261116-pii §5, W0.5): trusted, app-provided Pi extensions such as
 * mode persistence, expert persona, todo/plan, memory and sub-agents.
 *
 * - They are registered after the permission gate, checkpoints and MCP, and before user
 *   extensions, so every tool they add still goes through the permission gate.
 * - They are NOT governed by the user-extension master switch or folder trust (they are the
 *   app's own code), but each can be turned off individually through `enabled` (W0.4 settings).
 * - Tools they register must start with `ob_`; the session tool allowlist admits `ob_*`.
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
  /** Tool names it registers (each must start with `ob_`), for documentation and settings UI. */
  tools?: readonly string[];
  create(ctx: BuiltinContext): ExtensionFactory;
}

/** Each built-in appends itself here (one file per built-in under `builtin/`). */
export const BUILTIN_EXTENSIONS: BuiltinExtension[] = [];

/** Factories for one session, in registration order, skipping the ones switched off. */
export function builtinFactories(ctx: BuiltinContext, enabled: (id: string) => boolean = () => true): ExtensionFactory[] {
  return BUILTIN_EXTENSIONS.filter((b) => enabled(b.id)).map((b) => b.create(ctx));
}
export { readBranchHistory, readBranchState, writeBranchState } from "./session-state.js";
export type { BranchReader, EntryWriter } from "./session-state.js";
