import { headers } from 'next/headers';
import NotFoundView from '@/components/NotFoundView';
import { getAllDocs } from '@/lib/docs-meta';
import { locales, type Locale } from '@/lib/i18n';

/**
 * 根级 404 —— 没有路由匹配时由 Next 渲染,并且**只有这一份能正确返回 404 状态**。
 *
 * 试过在 `[locale]` 下加 catch-all 让它落到 `app/[locale]/not-found.tsx`,但那会
 * 先流出 layout 外壳再抛 `notFound()`,响应头已经发成 200 —— 软 404,对 SEO 比
 * 英文文案更糟。所以本地化改成在这里读 middleware 透传的 `x-locale`。
 */
export default function NotFound() {
  const headerLocale = headers().get('x-locale') ?? '';
  const locale: Locale = locales.includes(headerLocale as Locale)
    ? (headerLocale as Locale)
    : 'en';
  return <NotFoundView locale={ locale } docs={ getAllDocs() } />;
}
