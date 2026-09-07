import type { MetadataRoute } from 'next';
import { locales, defaultLocale } from '@/lib/i18n';

const SITE_URL = 'https://openbuddy.dev';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes = ['', '/download', '/docs', '/sponsors'];

  return routes.flatMap((route) =>
    locales.map((locale) => ({
      url: locale === defaultLocale
        ? `${ SITE_URL }${ route }`
        : `${ SITE_URL }/${locale}${ route }`,
      lastModified: now,
      changeFrequency: route === '' ? 'weekly' : 'monthly',
      priority: route === '' ? 1.0 : 0.7,
      alternates: {
        languages: Object.fromEntries(
          locales.map((l) => [
            l,
            l === defaultLocale
              ? `${ SITE_URL }${ route }`
              : `${ SITE_URL }/${l}${ route }`
          ])
        )
      }
    }))
  );
}