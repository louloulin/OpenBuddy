/**
 * Site-wide stats — the single source of truth.
 *
 * Every number here is verifiable from the repo:
 *   packages              — `find packages -name package.json` → 63 carry the @openbuddy/ prefix
 *   uiPackages            — the @openbuddy/ui-* subset
 *   collaborationPackages — the @openbuddy/collaboration-* subset
 *   testFiles             — **从 docs/stats.json 读**(见下)
 *   stars                 — https://api.github.com/repos/louloulin/OpenBuddy
 *
 * Do NOT hardcode these numbers elsewhere — not in components, and not in the
 * i18n dictionary. The dictionary interpolates this object with template
 * literals, so a change here propagates to both locales at once. Numbers the
 * repo cannot verify (download counts, contributor counts, "specs passed") are
 * deliberately absent; do not reintroduce them.
 *
 * testFiles 为什么不写死:
 *   它此前写死 469,而实测早就不是这样了(现在 1000+)。这类数字每加一个
 *   测试文件就开始撒谎,而且没人会发现。仓里已经有唯一的数字来源 ——
 *   `docs/stats.json`,由 `scripts/docs-stats.mjs` 生成,CI 的
 *   `scripts/check-doc-stats.mjs` 保证它不过期。官网直接读它。
 */
import repoStats from '../../../../docs/stats.json';

export const SITE_STATS = {
  packages: 63,
  uiPackages: 27,
  collaborationPackages: 8,
  testFiles: repoStats.testFiles,
  stars: 9
} as const;

export const SITE_LICENSE = 'MIT' as const;

/**
 * Canonical origin for absolute URLs (canonical tags, hreflang, sitemap,
 * robots). Read from the environment so a preview deploy advertises its own
 * origin instead of the production one; the literal is the production
 * fallback for builds that do not set it.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://openbuddy.dev').replace(/\/+$/, '');
