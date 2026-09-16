import { notFound } from 'next/navigation';
import { DownloadView, DOWNLOAD_COPY } from '@/components/DownloadView';
import { buildMetadata } from '@/lib/build-metadata';
import { locales, type Locale } from '@/lib/i18n';

export const dynamicParams = false;

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const typed = (locales.includes(locale as Locale) ? locale : 'en') as Locale;
  const copy = DOWNLOAD_COPY[typed];
  return buildMetadata({
    locale: typed,
    path: '/download',
    // copy.title 已经是 "Download OpenBuddy",再套模板会变成 "... · OpenBuddy · OpenBuddy"。
    title: copy.title,
    absoluteTitle: true,
    description: copy.subtitle
  });
}

export default async function LocaleDownloadPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) notFound();
  return <DownloadView locale={ locale as Locale } />;
}
