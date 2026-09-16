import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/constants';
import { locales } from '@/lib/i18n';
import { getAllDocs } from '@/lib/docs-meta';

/**
 * Sitemap —— 静态页面 + docs slug。
 *
 * 只有真正存在独立中文译文的文档才发 `/zh-CN` 条目。`files.zh` 为 null,
 * 或与 `files.en` 指向同一份文件时,中文路径渲染的是英文兜底,与英文页构成
 * 重复内容 —— 那种情况下只发英文条目,hreflang 也只声明真实存在的语言。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes = ['', '/download', '/docs', '/sponsors', '/changelog', '/roadmap', '/pricing'];

  function urlFor(route: string, locale: string): string {
    return `${SITE_URL}/${locale}${route}`;
  }

  function entry(route: string, locale: string, available: readonly string[]) {
    const isHome = route === '';
    const isDocPage = route.startsWith('/docs/');
    return {
      url: urlFor(route, locale),
      lastModified: now,
      changeFrequency: (isHome ? 'weekly' : isDocPage ? 'weekly' : 'monthly') as 'weekly' | 'monthly',
      priority: isHome ? 1.0 : route === '/docs' ? 0.8 : isDocPage ? 0.6 : 0.7,
      alternates: {
        languages: {
          ...Object.fromEntries(available.map((l) => [l, urlFor(route, l)])),
          'x-default': urlFor(route, 'en')
        }
      }
    };
  }

  const staticEntries = staticRoutes.flatMap((route) => locales.map((locale) => entry(route, locale, locales)));

  const docEntries = getAllDocs().flatMap((doc) => {
    const route = `/docs/${doc.slug}`;
    const hasZh = doc.files.zh !== null && doc.files.zh !== doc.files.en;
    const available = hasZh ? locales : (['en'] as const);
    return available.map((locale) => entry(route, locale, available));
  });

  return [...staticEntries, ...docEntries];
}
