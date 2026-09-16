import { notFound } from 'next/navigation';
import { ChangelogView } from '@/components/ChangelogView';
import { getChangelogReleases } from '@/lib/changelog-server';
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
    path: '/changelog',
    title: dict.changelog.title,
    description: dict.changelog.subtitle
  });
}

export default async function LocaleChangelogPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) notFound();
  const releases = getChangelogReleases(locale as Locale);
  return <ChangelogView locale={ locale as Locale } releases={ releases } />;
}