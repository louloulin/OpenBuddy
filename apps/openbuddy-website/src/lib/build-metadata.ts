import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/constants';
import type { Locale } from '@/lib/i18n';

export interface BuildMetadataInput {
  locale: Locale;
  /**
   * Route path without the locale prefix — '/' for the home page, '/pricing',
   * '/docs/getting-started', … The locale segment is prepended here so every
   * caller produces the same canonical/hreflang shape.
   */
  path: string;
  /** Bare title. The root layout's template appends ' · OpenBuddy'. */
  title: string;
  description: string;
  /** Skip the template — for titles that already carry the brand. */
  absoluteTitle?: boolean;
  /**
   * Locales that actually have their own content at this path. Docs pages
   * pass this because a zh-CN page without a zh source file renders the
   * English fallback — advertising it as an hreflang alternate would point
   * crawlers at duplicate content.
   */
  availableLocales?: Locale[];
}

/**
 * buildMetadata — canonical + hreflang + OpenGraph + Twitter in one place.
 *
 * Before this existed, no route emitted `rel="canonical"` and none emitted
 * hreflang, so /en/pricing and /zh-CN/pricing were two unlinked copies of the
 * same page to a crawler. Every localized route should go through here.
 */
export function buildMetadata({
  locale,
  path,
  title,
  description,
  absoluteTitle = false,
  availableLocales = ['en', 'zh-CN']
}: BuildMetadataInput): Metadata {
  const suffix = path === '/' ? '' : path;
  // A locale that is not in availableLocales is serving fallback content, so
  // its canonical is the primary locale's URL — not its own.
  const canonicalLocale = availableLocales.includes(locale) ? locale : availableLocales[0];
  const url = `${SITE_URL}/${canonicalLocale}${suffix}`;
  const enUrl = `${SITE_URL}/en${suffix}`;

  const languages = Object.fromEntries(
    availableLocales.map((l) => [l, `${SITE_URL}/${l}${suffix}`])
  ) as Record<string, string>;
  // Tells crawlers which locale to serve when none matches.
  languages['x-default'] = enUrl;

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url, languages },
    openGraph: {
      title,
      description,
      url,
      siteName: 'OpenBuddy',
      type: 'website',
      locale: locale === 'zh-CN' ? 'zh_CN' : 'en_US'
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description
    }
  };
}
