import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import Hero from '@/components/home/Hero';
import InstallBlock from '@/components/home/InstallBlock';
import LiveStats from '@/components/home/LiveStats';
import ProductTabs from '@/components/home/ProductTabs';
import CapabilityGrid from '@/components/home/CapabilityGrid';
import Architecture from '@/components/home/Architecture';
import LogoWall from '@/components/home/LogoWall';
import CTAFinal from '@/components/home/CTAFinal';
import { buildMetadata } from '@/lib/build-metadata';
import { locales, getDictionary, type Locale } from '@/lib/i18n';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const typed = (locales.includes(locale as Locale) ? locale : 'en') as Locale;
  const dict = getDictionary(typed);
  return {
    ...buildMetadata({
      locale: typed,
      path: '/',
      // Already carries the brand — bypass the root layout's ' · OpenBuddy' template.
      title: dict.meta.title,
      absoluteTitle: true,
      description: dict.meta.description
    }),
    keywords: dict.meta.keywords,
    openGraph: {
      title: dict.meta.title,
      description: dict.meta.ogDescription,
      locale: typed === 'zh-CN' ? 'zh_CN' : 'en_US'
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
        <LogoWall locale={ typed } />
        <InstallBlock locale={ typed } dict={ dict.installBlock } />
        <LiveStats locale={ typed } />
        <ProductTabs locale={ typed } />
        <CapabilityGrid locale={ typed } />
        <Architecture locale={ typed } />
        <CTAFinal locale={ typed } />
      </main>
      <SiteFooter dict={ dict } locale={ typed } />
    </>
  );
}
