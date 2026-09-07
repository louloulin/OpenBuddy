import type { Metadata } from 'next';
import { Heart, ArrowRight, CheckCircle2 } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import SharedHeader from '@/components/SharedHeader';
import { getDictionary, type Locale } from '@/lib/i18n';
import Link from 'next/link';
import RevealOnScroll from '@/components/RevealOnScroll';
import BackToTop from '@/components/BackToTop';

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
        <section className="relative section-pad">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <SharedHeader
              label="Sponsor"
              number="01"
              title={ copy.title }
              subtitle={ copy.subtitle }
            />

            <div className="grid gap-px overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-border)] md:grid-cols-3">
              { tiers.map((tier) => {
                const accent = tier.popular ? 'var(--wb-accent)' : 'var(--wb-fg-faint)';
                return (
                  <RevealOnScroll key={ tier.name }>
                    <article
                      className="group flex h-full flex-col gap-4 bg-[var(--wb-bg-pure)] p-6 transition-colors hover:bg-[var(--wb-bg-soft)]"
                    >
                      <header className="flex items-center justify-between border-b border-[var(--wb-border)] pb-4">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={ { background: accent } }
                          />
                          <h3 className="font-display-serif text-[20px] leading-tight text-[var(--wb-fg)]">
                            { tier.name }
                          </h3>
                        </div>
                        { tier.popular ? (
                          <span className="rounded-full bg-[var(--wb-accent)] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-white">
                            popular
                          </span>
                        ) : null }
                      </header>

                      <div className="font-display-serif text-[36px] leading-none tracking-tight text-[var(--wb-fg)]">
                        { tier.amount }
                      </div>

                      <ul className="mt-2 flex-1 space-y-2.5 border-t border-[var(--wb-border)] pt-4">
                        { tier.perks.map((perk) => (
                          <li
                            key={ perk }
                            className="flex items-start gap-2 text-[13px] leading-relaxed text-[var(--wb-fg-muted)]"
                          >
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--wb-working)]" />
                            <span>{ perk }</span>
                          </li>
                        )) }
                      </ul>

                      <a
                        href="https://github.com/sponsors/louloulin"
                        target="_blank"
                        rel="noreferrer"
                        className={ `mt-4 inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-semibold transition-colors ${
                          tier.popular
                            ? 'bg-[var(--wb-accent)] text-white hover:bg-[var(--wb-accent-hover)]'
                            : 'border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] text-[var(--wb-fg)] hover:bg-[var(--wb-bg-soft)]'
                        }` }
                      >
                        <Heart className="h-3.5 w-3.5" />
                        <span>{ copy.ctaPrimary }</span>
                      </a>
                    </article>
                  </RevealOnScroll>
                );
              }) }
            </div>

            <div className="mt-12 rounded-lg border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-6">
              <h2 className="font-display-serif text-[20px] leading-tight text-[var(--wb-fg)]">
                { copy.whyTitle }
              </h2>
              <ul className="mt-4 space-y-2">
                { copy.whyItems.map((item) => (
                  <li key={ item } className="flex items-start gap-2 text-[13.5px] leading-relaxed text-[var(--wb-fg-muted)]">
                    <span
                      className="mt-2 inline-block h-1 w-1 flex-shrink-0 rounded-full"
                      style={ { background: 'var(--wb-working)' } }
                    />
                    <span>{ item }</span>
                  </li>
                )) }
              </ul>
              <a
                href="https://github.com/louloulin/OpenBuddy/blob/main/SPONSORS.md"
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--wb-accent)] hover:underline"
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
      <BackToTop />
    </>
  );
}