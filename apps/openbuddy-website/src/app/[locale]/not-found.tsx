import { headers } from 'next/headers';
import NotFoundView from '@/components/NotFoundView';
import { getAllDocs } from '@/lib/docs-meta';
import { locales, type Locale } from '@/lib/i18n';

/**
 * 本地化 404 —— `[locale]` 段内任何丢失的路径都落在这一份。
 *
 * `not-found.tsx` 拿不到路由 `params`,所以 locale 由 middleware 通过
 * `x-locale` 请求头传进来(见 `src/middleware.ts`)。
 */
export default function LocaleNotFound() {
  const headerLocale = headers().get('x-locale') ?? '';
  const locale: Locale = locales.includes(headerLocale as Locale) ? (headerLocale as Locale) : 'en';
  return <NotFoundView locale={ locale } docs={ getAllDocs() } />;
}

/**
 * `/en/docs/<乱输>` 这类"路由匹配上了、参数非法"的 404 只能返回 200 ——
 * `[locale]/docs/[slug]` 设了 `dynamicParams = false`,Next 先流出 layout 外壳
 * 才渲染 404 边界,响应头那时已经是 200(软 404)。状态码改不了,至少要挡住
 * 索引,否则每个拼错的 slug 都会变成一份可收录的重复页。
 */
export const metadata = {
  robots: { index: false, follow: true }
};
