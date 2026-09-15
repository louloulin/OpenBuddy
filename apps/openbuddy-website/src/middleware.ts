import { NextResponse, type NextRequest } from 'next/server';
import { defaultLocale, locales } from '@/lib/i18n';

/**
 * middleware —— 根据 Accept-Language 自动选 locale,只作用于根路径。
 *
 * 规则:
 * - 用户访问 / → 检查 Accept-Language → 匹配 locales 则重定向 /<locale>,否则走 defaultLocale(英文)
 * - 已有 /[locale]/* 的路径不动(留给 [locale]/page.tsx 等)
 * - 静态资源、API、_next 等直接放行
 *
 * 用户随时可以通过 LocaleSwitcher 手动覆盖(URL 中已带 locale)。
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 只处理根路径,其他全部放行
  if (pathname !== '/') return NextResponse.next();

  const acceptLanguage = request.headers.get('accept-language') ?? '';
  const preferred = acceptLanguage
    .split(',')
    .map((entry) => {
      const [tag, q = 'q=1'] = entry.trim().split(';');
      return { tag: tag.toLowerCase(), q: parseFloat(q.split('=')[1] ?? '1') };
    })
    .sort((a, b) => b.q - a.q);

  const match = preferred.find((entry) =>
    locales.some((locale) => entry.tag === locale.toLowerCase() || entry.tag.startsWith(`${ locale.toLowerCase() }-`))
  );

  const target = match ? (match.tag.startsWith('zh') ? 'zh-CN' : defaultLocale) : defaultLocale;

  const url = request.nextUrl.clone();
  url.pathname = `/${ target }`;
  return NextResponse.redirect(url);
}

export const config = {
  // 只跑在根路径;_next、API、静态资源自动跳过
  matcher: ['/((?!_next/|api/|favicon|.*\\..*).*)']
};