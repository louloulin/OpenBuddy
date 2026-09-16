import { NextResponse, type NextRequest } from 'next/server';
import { defaultLocale, locales } from '@/lib/i18n';

/**
 * middleware —— locale 归一化。
 *
 * 规则:
 * - `/` → 检查 Accept-Language → 重定向到 `/en` 或 `/zh-CN`
 * - locale 别名(`/zh`、`/zh-Hans`、`/cn` …)→ 规范 locale
 * - 任何没有 locale 前缀的路径 → 重定向到 `/<defaultLocale>/...`
 *   (路由结构是 `[locale]/...`,无前缀路径会被当成 locale 名而崩溃或 404)
 * - 静态资源、API、_next 等直接放行
 *
 * 用户随时可以通过 LocaleSwitcher 手动覆盖(URL 中已带 locale)。
 */

/** 常见的中文 locale 写法都收敛到 `zh-CN`,否则 `/zh` 会被当成普通路径补成 `/en/zh`。 */
const LOCALE_ALIASES: Record<string, string> = {
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-sg': 'zh-CN',
  cn: 'zh-CN',
  'zh-hant': 'zh-CN',
  'zh-tw': 'zh-CN',
  'zh-hk': 'zh-CN',
  en_us: 'en',
  'en-us': 'en',
  'en-gb': 'en'
};

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

  // 无 locale 前缀的路径:先折叠 locale 别名,否则补上默认语言,
  // 避免落到 `[locale]` 的错误分支(`/zh` 曾被补成 `/en/zh`)。
  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = segments[0];
  if (firstSegment && !locales.includes(firstSegment as (typeof locales)[number])) {
    const aliased = LOCALE_ALIASES[firstSegment.toLowerCase()];
    const url = request.nextUrl.clone();
    const rest = segments.slice(1).join('/');
    url.pathname = aliased
      ? `/${ aliased }${ rest ? `/${ rest }` : '' }`
      : `/${ defaultLocale }${ pathname }`;
    return NextResponse.redirect(url);
  }

  // 把命中的 locale 透传给下游:`not-found.tsx` 拿不到路由 params,
  // 只能靠这个头决定 404 页面用哪种语言渲染。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-locale', firstSegment ?? defaultLocale);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // 只跑在根路径;_next、API、静态资源自动跳过
  matcher: ['/((?!_next/|api/|favicon|.*\\..*).*)']
};