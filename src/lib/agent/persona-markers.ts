/**
 * Hidden markers wrapping the expert persona in the text sent to pi.
 *
 * The renderer (MessageItem, history replay) strips everything between
 * these markers so the user never sees the persona boilerplate — pi
 * receives it as system-style instructions.
 *
 * Extracted from `App.tsx` so `newSessionFlow` (a pure non-React module)
 * can reference the constants without dragging React into its
 * dependency graph. `App.tsx` re-exports these symbols for backward
 * compatibility with any existing consumers (none in production as of
 * Phase 2; only the original `App.tsx:103` definitions existed).
 */
export const EXPERT_PERSONA_BEGIN = "<!--EXPERT_PERSONA_BEGIN-->";
export const EXPERT_PERSONA_END = "<!--EXPERT_PERSONA_END-->";