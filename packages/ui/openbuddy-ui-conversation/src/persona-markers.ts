/**
 * Hidden expert persona block markers.
 *
 * These mirror the constants exported from `src/App.tsx` (`EXPERT_PERSONA_BEGIN`,
 * `EXPERT_PERSONA_END`). They were originally co-located in App.tsx, but
 * importing those from a ui-* package would drag the entire root App.tsx
 * (which depends on dozens of panels / capability packages that haven't
 * fully migrated yet) into the type-check program. The constants are
 * stable marker strings; if App.tsx ever changes them, the next chat
 * type-check will surface a usage mismatch in the conversation tests.
 */

export const EXPERT_PERSONA_BEGIN = "<!--EXPERT_PERSONA_BEGIN-->";
export const EXPERT_PERSONA_END = "<!--EXPERT_PERSONA_END-->";
