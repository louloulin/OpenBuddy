import type { MetadataRoute } from 'next';
import { locales } from '@/lib/i18n';
import { getAllDocs } from '@/lib/docs-meta';

const SITE_URL = 'https://openbuddy.dev';

/**
 * Sitemap —— 静态页面 + 全部 docs slug(每篇 × 每个 locale)。
 * 所有 URL 都带 locale 前缀,与 `[locale]/...` 路由结构一致;
 * 之前 docs slug 完全没进 sitemap(22 篇 × 2 = 44 条 URL 对搜索引擎不可见)。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes = ['', '/download', '/docs', '/sponsors', '/changelog', '/roadmap', '/pricing'];
  const docRoutes = getAllDocs().map((doc) => `/docs/${doc.slug}`);
  const routes = [...staticRoutes, ...docRoutes];

  function urlFor(route: string, locale: string): string {
    return `${SITE_URL}/${locale}${route}`;
  }

  return routes.flatMap((route) =>
    locales.map((locale) => {
      const isHome = route === '';
      const isDocPage = route.startsWith('/docs/');
      return {
        url: urlFor(route, locale),
        lastModified: now,
        changeFrequency: isHome ? 'weekly' : isDocPage ? 'weekly' : 'monthly',
        priority: isHome ? 1.0 : route === '/docs' ? 0.8 : isDocPage ? 0.6 : 0.7,
        alternates: {
          languages: {
            ...Object.fromEntries(locales.map((l) => [l, urlFor(route, l)])),
            'x-default': urlFor(route, 'en')
          }
        }
      };
    })
  );
}
