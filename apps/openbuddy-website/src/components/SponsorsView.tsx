import type { Metadata } from 'next';
import { Heart, Github, ArrowRight, CheckCircle2 } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { getDictionary, type Locale } from '@/lib/i18n';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Sponsors',
  description:
    'OpenBuddy is free, MIT, and ad-free. Sponsors keep the lights on and the codebase growing.'
};

interface Tier {
  name: string;
  amount: string;
  perks: string[];
  popular?: boolean;
}

const TIERS_EN: Tier[] = [
  {
    name: 'Backer',
    amount: '$5 / month',
    perks: ['Your name on the README', 'Early access to release notes', 'Our gratitude']
  },
  {
    name: 'Sponsor',
    amount: '$25 / month',
    perks: [
      'Everything in Backer',
      'Logo on the website footer',
      'Priority issue triage',
      'Invite to monthly Office Hours'
    ],
    popular: true
  },
  {
    name: 'Enterprise',
    amount: 'Custom',
    perks: [
      'Everything in Sponsor',
      'Dedicated support channel',
      'Casdoor + NewAPI integration help',
      'Quarterly roadmap review'
    ]
  }
];

const TIERS_ZH: Tier[] = [
  {
    name: '支持者',
    amount: '¥30 / 月',
    perks: ['README 中列出你的名字', '提前获取发布说明', '我们的感谢']
  },
  {
    name: '赞助商',
    amount: '¥150 / 月',
    perks: [
      '支持者全部权益',
      '官网 footer 展示 Logo',
      '优先处理 Issue',
      '受邀参加每月 Office Hours'
    ],
    popular: true
  },
  {
    name: '企业',
    amount: '定制',
    perks: [
      '赞助商全部权益',
      '专属支持频道',
      'Casdoor + NewAPI 集成协助',
      '季度路线图复盘'
    ]
  }
];

const COPY_EN = {
  title: 'Sponsors',
  subtitle:
    'OpenBuddy is free, MIT, and ad-free. Sponsors keep the lights on and the codebase growing.',
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

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-radial-glow opacity-40" />
          <div className="mx-auto max-w-7xl px-4 pb-16 pt-12 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 justify-center text-[var(--wb-fg-muted)]">
                <Heart className="h-4 w-4 text-brand-9" />
                <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
                  { copy.title }
                </span>
              </div>
              <h1 className="mt-4 font-display text-display-lg text-balance text-[var(--wb-fg)]">
                { copy.title }
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-pretty text-[16px] leading-relaxed text-[var(--wb-fg-muted)]">
                { copy.subtitle }
              </p>
            </div>

            {/* Tier grid */}
            <div className="mt-16 grid md:grid-cols-3">
              { tiers.map((tier, idx) => (
                <article
                  key={ tier.name }
                  className={ `relative flex flex-col rounded-2xl border p-8 transition-all ${
                    tier.popular
                      ? 'border-brand-9 bg-[var(--wb-bg)] shadow-wb-glow-brand md:-my-4 md:scale-105'
                      : 'border-[var(--wb-border)] bg-[var(--wb-bg)]'
                  } ${idx > 0 ? 'md:ml-[-1px]' : ''}` }
                >
                  { tier.popular ? (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-9 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
                      { locale === 'zh-CN' ? '热门' : 'Most popular' }
                    </span>
                  ) : null }
                  <h3 className="font-display text-[20px] font-semibold tracking-tight text-[var(--wb-fg)]">
                    { tier.name }
                  </h3>
                  <p className="mt-1 font-mono text-[14px] text-brand-9">{ tier.amount }</p>
                  <ul className="mt-6 flex-1 space-y-3 border-t border-[var(--wb-border)] pt-5">
                    { tier.perks.map((perk) => (
                      <li key={ perk } className="flex items-start gap-2 text-[13px] text-[var(--wb-fg-muted)]">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-8" />
                        <span>{ perk }</span>
                      </li>
                    )) }
                  </ul>
                  <a
                    href="https://github.com/sponsors/louloulin"
                    target="_blank"
                    rel="noreferrer"
                    className={ `mt-6 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                      tier.popular
                        ? 'bg-brand-9 text-white hover:bg-brand-10'
                        : 'border border-[var(--wb-border)] bg-[var(--wb-bg)] text-[var(--wb-fg)] hover:bg-[var(--wb-bg-soft-2)]'
                    }` }
                  >
                    <Heart className="h-3.5 w-3.5" />
                    <span>{ copy.ctaPrimary }</span>
                  </a>
                </article>
              )) }
            </div>

            {/* Why */}
            <div className="mx-auto mt-20 max-w-3xl rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-8">
              <h2 className="font-display text-[20px] font-semibold tracking-tight text-[var(--wb-fg)]">
                { copy.whyTitle }
              </h2>
              <ul className="mt-4 space-y-3">
                { copy.whyItems.map((item) => (
                  <li key={ item } className="flex items-start gap-2 text-[14px] text-[var(--wb-fg-muted)]">
                    <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-8" />
                    <span>{ item }</span>
                  </li>
                )) }
              </ul>
              <a
                href="https://github.com/louloulin/OpenBuddy/blob/main/SPONSORS.md"
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-9 hover:underline"
              >
                { copy.ctaSecondary }
                <ArrowRight className="h-3 w-3" />
              </a>
            </div>

            <div className="mt-12 text-center">
              <Link
                href={ locale === 'zh-CN' ? '/zh-CN' : '/' }
                className="inline-flex items-center gap-2 text-[13px] text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
              >
                ← { locale === 'zh-CN' ? '返回首页' : 'Back to home' }
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter dict={ dict } />
    </>
  );
}