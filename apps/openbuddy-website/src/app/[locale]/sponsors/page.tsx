import { notFound } from 'next/navigation';
import { SponsorsView, SPONSORS_COPY } from '@/components/SponsorsView';
import { buildMetadata } from '@/lib/build-metadata';
import { locales, type Locale } from '@/lib/i18n';

export const dynamicParams = false;

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const typed = (locales.includes(locale as Locale) ? locale : 'en') as Locale;
  const copy = SPONSORS_COPY[typed];
  return buildMetadata({
    locale: typed,
    path: '/sponsors',
    title: copy.title,
    description: copy.subtitle
  });
}

export default async function LocaleSponsorsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) notFound();
  return <SponsorsView locale={ locale as Locale } />;
}
