import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import Hero from '@/components/home/Hero';
import ProductTabs from '@/components/home/ProductTabs';
import CapabilityGrid from '@/components/home/CapabilityGrid';
import Architecture from '@/components/home/Architecture';
import CTAFinal from '@/components/home/CTAFinal';
import { locales, getDictionary, type Locale } from '@/lib/i18n';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = getDictionary(locale as Locale);
  return {
    title: dict.meta.title,
    description: dict.meta.description,
    keywords: dict.meta.keywords,
    openGraph: {
      title: dict.meta.title,
      description: dict.meta.ogDescription,
      locale: locale === 'zh-CN' ? 'zh_CN' : 'en_US',
      images: [{ url: '/og.png', width: 1200, height: 630, alt: dict.meta.title }]
    }
  };
}

export default async function LocaleHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const typed = locale as Locale;
  const dict = getDictionary(typed);

  return (
    <>
      <SiteHeader dict={ dict } locale={ typed } />
      <main id="main-content">
        <Hero locale={ typed } dict={ dict } />
        <ProductTabs locale={ typed } />
        <CapabilityGrid locale={ typed } />
        <Architecture locale={ typed } />
        <CTAFinal locale={ typed } />
      </main>
      <SiteFooter dict={ dict } />
    </>
  );
}