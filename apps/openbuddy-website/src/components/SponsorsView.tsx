import type { Metadata } from 'next';
import { Heart, ArrowRight, CheckCircle2 } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { PageHeader, SectionHeader } from '@/components/PageHeader';
import { getDictionary, type Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Sponsors',
  description: 'OpenBuddy is free, MIT, and ad-free. Sponsors keep the lights on and the codebase growing.'
};

interface Tier {
  name: string;
  amount: string;
  perks: string[];
  popular?: boolean;
}

const TIERS_EN: Tier[] = [
  { name: 'Backer', amount: '$5 / month', perks: ['Your name on the README', 'Early access to release notes', 'Our gratitude'] },
  { name: 'Sponsor', amount: '$25 / month', perks: ['Everything in Backer', 'Logo on the website footer', 'Priority issue triage', 'Invite to monthly Office Hours'], popular: true },
  { name: 'Enterprise', amount: 'Custom', perks: ['Everything in Sponsor', 'Dedicated support channel', 'Casdoor + NewAPI integration help', 'Quarterly roadmap review'] }
];

const TIERS_ZH: Tier[] = [
  { name: '支持者', amount: '¥30 / 月', perks: ['README 中列出你的名字', '提前获取发布说明', '我们的感谢'] },
  { name: '赞助商', amount: '¥150 / 月', perks: ['支持者全部权益', '官网 footer 展示 Logo', '优先处理 Issue', '受邀参加每月 Office Hours'], popular: true },
  { name: '企业', amount: '定制', perks: ['赞助商全部权益', '专属支持频道', 'Casdoor + NewAPI 集成协助', '季度路线图复盘'] }
];

const COPY_EN = {
  title: 'Sponsors',
  subtitle: 'OpenBuddy is free, MIT, and ad-free. Sponsors keep the lights on and the codebase growing.',
  whyTitle: 'Where the money goes',
  whyItems: [
    'CI minutes for macOS / Windows / Linux builds',
    'Domain + DNS + Vercel + GitHub Actions',
    'Maintainer time for issue triage and reviews',
    'Translation, design, and community events'
  ],
  ctaPrimary: 'Sponsor on GitHub',
  ctaSecondary: 'View full transparency log'
};

const COPY_ZH = {
  title: '赞助',
  subtitle: 'OpenBuddy 免费、MIT 协议、无广告。赞助让我们保持运转并持续构建。',
  whyTitle: '资金去向',
  whyItems: [
    'macOS / Windows / Linux 构建的 CI 时间',
    '域名 + DNS + Vercel + GitHub Actions',
    '维护者处理 Issue 与评审的时间',
    '翻译、设计与社区活动'
  ],
  ctaPrimary: '在 GitHub 上赞助',
  ctaSecondary: '查看完整透明账本'
};

export function SponsorsView({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const tiers = locale === 'zh-CN' ? TIERS_ZH : TIERS_EN;
  const copy = locale === 'zh-CN' ? COPY_ZH : COPY_EN;
  const isZh = locale === 'zh-CN';

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative py-20 md:py-28">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <PageHeader
              eyebrow={ isZh ? '赞助' : 'Sponsors' }
              title={ copy.title }
              subtitle={ copy.subtitle }
              compact={ isZh }
            />

            <div className="mt-16 grid gap-5 md:grid-cols-3">
              { tiers.map((tier) => (
                <article key={ tier.name } className={ `flex h-full flex-col gap-5 rounded-2xl border p-7 transition-all ${
                  tier.popular
                    ? 'border-[var(--wb-brand)] bg-[var(--wb-bg-pure)] shadow-[0_0_0_4px_var(--wb-brand-soft)]'
                    : 'border-[var(--wb-border)] bg-[var(--wb-bg-pure)]'
                }` }>
                  { tier.popular ? (
                    <span className="self-start rounded-full bg-[var(--wb-brand)] px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-white">
                      { isZh ? '推荐' : 'Popular' }
                    </span>
                  ) : null }
                  <div>
                    <h3 className="font-display-serif text-[28px] leading-tight tracking-[-0.02em] text-[var(--wb-fg)]">{ tier.name }</h3>
                    <div className="mt-2 font-display-serif text-[20px] leading-none text-[var(--wb-fg-muted)]">{ tier.amount }</div>
                  </div>
                  <ul className="flex-1 space-y-2.5 border-t border-[var(--wb-border)] pt-4">
                    { tier.perks.map((perk) => (
                      <li key={ perk } className="flex items-start gap-3 text-[13px] leading-snug text-[var(--wb-fg)]">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--wb-working)]" />
                        <span>{ perk }</span>
                      </li>
                    )) }
                  </ul>
                  <a href="https://github.com/sponsors/louloulin" target="_blank" rel="noreferrer" className={ `inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-semibold transition-all ${
                    tier.popular
                      ? 'bg-[var(--wb-brand)] text-white hover:bg-[var(--wb-brand-hover)]'
                      : 'border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] text-[var(--wb-fg)] hover:border-[var(--wb-border-strong)]'
                  }` }>
                    <Heart className="h-3.5 w-3.5" />
                    <span>{ copy.ctaPrimary }</span>
                  </a>
                </article>
              )) }
            </div>

            <div className="mt-16 rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-7 sm:p-8">
              <SectionHeader eyebrow={ isZh ? '透明' : 'Transparency' } title={ copy.whyTitle } />
              <ul className="grid gap-3 sm:grid-cols-2">
                { copy.whyItems.map((item) => (
                  <li key={ item } className="flex items-start gap-3 rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] p-4 text-[13.5px] leading-snug text-[var(--wb-fg)]">
                    <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full" style={ { background: 'var(--wb-working)' } } />
                    <span>{ item }</span>
                  </li>
                )) }
              </ul>
              <a href="https://github.com/louloulin/OpenBuddy/blob/main/SPONSORS.md" target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--wb-brand)] hover:underline">
                { copy.ctaSecondary }
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="mt-12">
              <Link href={ localizedPath('/', locale) } className="cta-link text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)] text-[14px]">
                <span>← { isZh ? '返回首页' : 'Back to home' }</span>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter dict={ dict } locale={ locale } />
    </>
  );
}
