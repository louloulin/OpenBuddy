import { notFound } from 'next/navigation';
import Hero from '@/components/Hero';
import ShowcaseSection from '@/components/ShowcaseSection';
import FeaturesSection from '@/components/FeaturesSection';
import ArchitectureSection from '@/components/ArchitectureSection';
import StatsSection from '@/components/StatsSection';
import ComparisonSection from '@/components/ComparisonSection';
import CapabilitiesSection from '@/components/CapabilitiesSection';
import TechStackSection from '@/components/TechStackSection';
import CLISection from '@/components/CLISection';
import TestimonialsSection from '@/components/TestimonialsSection';
import FAQSection from '@/components/FAQSection';
import CommunitySection from '@/components/CommunitySection';
import CTASection from '@/components/CTASection';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { locales, getDictionary, type Locale } from '@/lib/i18n';

/**
 * /[locale] —— 国际化首页
 * 根 `/` 是英文版；`/zh-CN` 是中文版
 */
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
  if (!locales.includes(locale as Locale)) notFound();
  const dict = getDictionary(locale as Locale);

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale as Locale } />
      <main id="main-content">
        <Hero dict={ dict } locale={ locale as Locale } />
        <ShowcaseSection dict={ dict } />
        <FeaturesSection dict={ dict } />
        <ArchitectureSection dict={ dict } />
        <StatsSection dict={ dict } />
        <ComparisonSection dict={ dict } />
        <CapabilitiesSection dict={ dict } />
        <TechStackSection dict={ dict } />
        <CLISection dict={ dict } />
        <TestimonialsSection dict={ dict } />
        <FAQSection dict={ dict } />
        <CommunitySection dict={ dict } />
        <CTASection dict={ dict } />
      </main>
      <SiteFooter dict={ dict } />
    </>
  );
}