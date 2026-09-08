import { notFound } from 'next/navigation';
import { SponsorsView } from '@/components/SponsorsView';
import { locales, type Locale } from '@/lib/i18n';

export const dynamicParams = false;

export async function generateStaticParams() {
  return locales.filter((l) => l !== 'en').map((locale) => ({ locale }));
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