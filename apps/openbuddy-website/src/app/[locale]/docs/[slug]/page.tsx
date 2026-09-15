import { notFound } from 'next/navigation';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import DocsSidebar from '@/components/docs/DocsSidebar';
import DocsMobileNav from '@/components/docs/DocsMobileNav';
import DocArticle from '@/components/docs/DocArticle';
import { getAllDocs } from '@/lib/docs-meta';
import { getDocBySlug } from '@/lib/docs-server';
import { locales, getDictionary, type Locale } from '@/lib/i18n';

export const dynamicParams = false;

export function generateStaticParams() {
  const out: Array<{ locale: string; slug: string }> = [];
  for (const locale of locales) {
    for (const doc of getAllDocs()) {
      out.push({ locale, slug: doc.slug });
    }
  }
  return out;
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const content = getDocBySlug(slug, locale as Locale);
  if (!content) return { title: 'Not Found' };
  return {
    title: content.meta.title,
    description: content.meta.description
  };
}

export default async function DocPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!locales.includes(locale as Locale)) notFound();

  const content = getDocBySlug(slug, locale as Locale);
  if (!content) notFound();

  const dict = getDictionary(locale as Locale);

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale as Locale } />
      <main id="main-content" className="pt-12">
        <section className="relative py-10 md:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <DocsMobileNav locale={ locale as Locale } label={ dict.docsPage.browseDocs } />
            <div className="grid gap-12 lg:grid-cols-[260px_1fr]">
              <aside className="hidden lg:block">
                <DocsSidebar locale={ locale as Locale } activeSlug={ slug } />
              </aside>
              <div className="min-w-0">
                <DocArticle content={ content } locale={ locale as Locale } />
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter dict={ dict } locale={ locale as Locale } />
    </>
  );
}