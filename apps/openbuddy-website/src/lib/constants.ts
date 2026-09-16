/**
 * Site-wide stats — the single source of truth.
 *
 * Every number here is verifiable from the repo:
 *   packages              — `find packages -name package.json` → 63 carry the @openbuddy/ prefix
 *   uiPackages            — the @openbuddy/ui-* subset
 *   collaborationPackages — the @openbuddy/collaboration-* subset
 *   testFiles             — `find packages apps src -name '*.test.*' -o -name '*.spec.*'` → 469
 *   stars                 — https://api.github.com/repos/louloulin/OpenBuddy
 *
 * Do NOT hardcode these numbers elsewhere — not in components, and not in the
 * i18n dictionary. The dictionary interpolates this object with template
 * literals, so a change here propagates to both locales at once. Numbers the
 * repo cannot verify (download counts, contributor counts, "specs passed") are
 * deliberately absent; do not reintroduce them.
 */
export const SITE_STATS = {
  packages: 63,
  uiPackages: 27,
  collaborationPackages: 8,
  testFiles: 469,
  stars: 9
} as const;

export const SITE_LICENSE = 'MIT' as const;
