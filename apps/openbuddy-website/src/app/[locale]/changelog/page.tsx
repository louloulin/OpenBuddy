import { notFound } from 'next/navigation';
import { ChangelogView } from '@/components/ChangelogView';
import { getChangelogReleases } from '@/lib/changelog-server';
import { locales, type Locale } from '@/lib/i18n';

export const dynamicParams = false;

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return {
    title: locale === 'zh-CN' ? '更新日志 · OpenBuddy' : 'Changelog · OpenBuddy',
    description:
      locale === 'zh-CN'
        ? 'OpenBuddy 每次发布、每次修复、每次破坏性变更 —— 仓库即真实来源。订阅 GitHub Releases 以获取通知。'
        : 'Every OpenBuddy release, fix, and breaking change — sourced from the repo. Subscribe to GitHub Releases for notifications.'
  };
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