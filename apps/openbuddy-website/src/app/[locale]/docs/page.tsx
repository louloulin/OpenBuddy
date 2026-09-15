import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import DocsSidebar from '@/components/docs/DocsSidebar';
import DocsOverview from '@/components/docs/DocsOverview';
import { locales, getDictionary, type Locale } from '@/lib/i18n';

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = getDictionary(locale as Locale);
  return {
    title: dict.nav.docs,
    description:
      locale === 'zh-CN'
        ? 'OpenBuddy 完整文档 —— 安装、架构、插件开发、运维部署。仓库即文档。'
        : 'Complete OpenBuddy documentation — setup, architecture, plugin development, operations. The repo is the docs.'
  };
}

export default async function DocsLandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) return null;
  const dict = getDictionary(locale as Locale);

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale as Locale } />
      <main id="main-content" className="pt-12">
        <section className="relative section-pad">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-12 lg:grid-cols-[260px_1fr]">
              <aside className="hidden lg:block">
                <DocsSidebar locale={ locale as Locale } />
              </aside>
              <DocsOverview locale={ locale as Locale } />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter dict={ dict } />
    </>
  );
}