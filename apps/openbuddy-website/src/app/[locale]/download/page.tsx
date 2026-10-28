import { notFound } from 'next/navigation';
import { DownloadView, DOWNLOAD_COPY } from '@/components/DownloadView';
import { buildMetadata } from '@/lib/build-metadata';
import { getLatestRelease } from '@/lib/releases-server';
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
  // 下载页展示**真实**的 release 资产与 SHA-256(而不是写死的文件名/编造的
  // 校验和)。没有 release 时如实显示"尚未发布版本"。
  const release = await getLatestRelease();
  return <DownloadView locale={ locale as Locale } release={ release } />;
}
