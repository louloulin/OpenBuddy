import { NextResponse, type NextRequest } from 'next/server';
import { defaultLocale, locales } from '@/lib/i18n';

/**
 * middleware —— locale 归一化。
 *
 * 规则:
 * - `/` → 检查 Accept-Language → 重定向到 `/en` 或 `/zh-CN`
 * - 任何没有 locale 前缀的路径 → 重定向到 `/<defaultLocale>/...`
 *   (路由结构是 `[locale]/...`,无前缀路径会被当成 locale 名而崩溃或 404)
 * - 静态资源、API、_next 等直接放行
 *
 * 用户随时可以通过 LocaleSwitcher 手动覆盖(URL 中已带 locale)。
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 根路径:按 Accept-Language 选一个 locale
  if (pathname === '/') {
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

  // 无 locale 前缀的路径:补上默认语言,避免落到 `[locale]` 的错误分支。
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  if (firstSegment && !locales.includes(firstSegment as (typeof locales)[number])) {
    const url = request.nextUrl.clone();
    url.pathname = `/${ defaultLocale }${ pathname }`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // 只跑在根路径;_next、API、静态资源自动跳过
  matcher: ['/((?!_next/|api/|favicon|.*\\..*).*)']
};