/**
 * @openbuddy/ui-theme — pi-native theme adapter (G6 PR 1).
 *
 * Delegates to pi's real theme exports (`initTheme`, `getMarkdownTheme`,
 * `getSelectListTheme`, `getEditorTheme`) and exposes a typed facade that
 * matches the G6 spec's intent without forcing consumers to import
 * `@earendil-works/pi-coding-agent` directly.
 *
 * Spec note (Round 11 audit): the G6 spec assumed pi's API took an object
 * `initTheme({ baseTokens: ... })` and `getMarkdownTheme(theme)`. pi's
 * actual exports take positional args and return theme objects directly.
 * This file adapts to the real signature, documented in §"Spec audit"
 * of the G6 spec / `plan4.1.md` v3.8 increment.
 *
 * Why an adapter rather than a direct re-export?
 *
 *  1. Centralizes the "which pi symbol maps to which concept" choice
 *     here, so consumers can call `markdownTheme()` without caring
 *     about the package rename.
 *  2. Lets us swap implementations (e.g. for tests, or for a future
 *     pi major bump) by editing one file.
 *  3. Mirrors the G11 pattern (`parseFrontmatter` re-export) so both
 *     adopt the same shape across the monorepo.
 */
import {
  initTheme as piInitTheme,
  getMarkdownTheme as piGetMarkdownTheme,
  getSelectListTheme as piGetSelectListTheme,
  getEditorTheme as piGetEditorTheme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";

/** Re-export the pi `ThemeColor` type so consumers do not import pi directly. */
export type { ThemeColor };

/**
 * Initialize pi's interactive-mode theme. Pass `themeName` to switch
 * (e.g. `"dark"`, `"light"`, or a custom registered name); pass
 * `enableWatcher=true` so pi re-applies the theme whenever the user
 * toggles the OS color scheme.
 *
 * The spec assumed a config object; the real signature is positional.
 * Two-argument form mirrors pi's docs and keeps the call sites short.
 */
export function initTheme(themeName?: string, enableWatcher?: boolean): void {
  return piInitTheme(themeName, enableWatcher);
}

/** Markdown syntax-highlighting theme. No args — pi resolves from current init. */
export function getMarkdownTheme() {
  return piGetMarkdownTheme();
}

/** Select-list theme (the popup / menu palette pi renders). */
export function getSelectListTheme() {
  return piGetSelectListTheme();
}

/**
 * Editor theme (settings-list / text-editor palette).
 *
 * Spec audit: the G6 doc named this `getSettingsListTheme`; pi's actual
 * export is `getEditorTheme`. We expose it under the spec's name so
 * downstream consumers do not have to change when they migrate, while
 * the underlying call is the pi-defined symbol.
 */
export function getSettingsListTheme() {
  return piGetEditorTheme();
}