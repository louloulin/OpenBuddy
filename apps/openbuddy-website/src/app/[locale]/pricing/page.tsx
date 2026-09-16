import { notFound } from 'next/navigation';
import { PricingView } from '@/components/PricingView';
import { buildMetadata } from '@/lib/build-metadata';
import { getDictionary, locales, type Locale } from '@/lib/i18n';

export const dynamicParams = false;

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const typed = (locales.includes(locale as Locale) ? locale : 'en') as Locale;
  const dict = getDictionary(typed);
  return buildMetadata({
    locale: typed,
    path: '/pricing',
    title: dict.pricing.title,
    description: dict.pricing.subtitle
  });
}

export default async function LocalePricingPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) notFound();
  return <PricingView locale={ locale as Locale } />;
}
