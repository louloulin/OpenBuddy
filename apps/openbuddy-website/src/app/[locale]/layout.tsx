import HtmlLang from '@/components/HtmlLang';

/**
 * [locale] 段 layout —— 目前只负责把 <html lang> 修正成当前 locale。
 * 根 layout 不在 [locale] 段内,读不到路由参数,只能写死 lang="en"。
 */
export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <>
      <HtmlLang locale={ locale } />
      { children }
    </>
  );
}
