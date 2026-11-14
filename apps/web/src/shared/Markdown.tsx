/**
 * Public entry for chat markdown rendering.
 * Implementation lives under ./markdown/ (WorkBuddy-aligned pipeline).
 * Note: must import via "./markdown/index" — on Windows "./markdown"
 * collides with this file's casing.
 */
export { Markdown } from "@openbuddy/markdown";
export type {
  MarkdownProps,
  MarkdownConfig,
  MarkdownTheme,
} from "@openbuddy/markdown";
