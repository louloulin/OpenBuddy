/**
 * bootstrap/compute-active-adapter-ids.ts — extract active adapter ids.
 *
 * Phase 8.3 Batch D-9: split `agent-host.ts:initialize()` so the final
 * composition root reads as 8-10 stages of orchestration, not a wall of
 * inline closures. This stage owns:
 *   - walking `state.piExtensionStatuses` to compute the set of active
 *     adapter ids (used by `injectSystemPromptSections` to inject the
 *     adapter-commands markdown into the system prompt)
 *   - normalizing the `adapter` field by stripping the `openbuddy-`
 *     prefix (legacy compatibility shim)
 *
 * Why this stage exists:
 *   Pre-Batch-D-9 the 7-line `for (const entry of state.piExtensionStatuses)`
 *   loop lived inline between `initDeepSeek` and `injectSystemPromptSections`
 *   in `initialize()`. Moving it here:
 *   - Lets `injectSystemPromptSections` accept the set directly instead of
 *     recomputing it (single source of truth).
 *   - Lets tests assert the adapter-id resolution rules without standing
 *     up a full Cordis context.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
 */

import { type AgentHostState } from "../_state-shape";

/**
 * Dependencies required to compute active adapter ids.
 */
export interface ComputeActiveAdapterIdsDeps {
  state: AgentHostState;
}

/**
 * Walk `state.piExtensionStatuses` and return the set of adapter ids that
 * should be passed to `injectSystemPromptSections`. The set is computed by:
 *
 *   1. Including the entry id of every status with `mode === "adapter"`.
 *   2. Including the entry's `adapter` field, with the `openbuddy-` prefix
 *      stripped (legacy compatibility shim — older extension specs use
 *      the long form, newer ones use the short form).
 *
 * The returned set is a real `Set` (deduplicated) so callers can pass it
 * straight to `Set.has(...)` checks in the prompt-rendering path.
 */
export function computeActiveAdapterIds(deps: ComputeActiveAdapterIdsDeps): Set<string> {
  const { state } = deps;
  const ids = new Set<string>();
  for (const entry of state.piExtensionStatuses) {
    if (entry.mode !== "adapter") continue;
    ids.add(entry.id);
    if (entry.adapter) ids.add(entry.adapter.replace(/^openbuddy-/, ""));
  }
  return ids;
}
