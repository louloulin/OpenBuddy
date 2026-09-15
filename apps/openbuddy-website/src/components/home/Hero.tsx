import Link from 'next/link';
import Image from 'next/image';
import { GithubIcon } from '@/components/icons/BrandIcons';
import Logo from '@/components/icons/Logo';
import { localizedPath, type Locale } from '@/lib/i18n';

interface HeroProps {
  locale: Locale;
  dict: {
    hero: {
      chip: string;
      titlePre: string;
      titleHighlight: string;
      titlePost: string;
      subtitle: string;
      ctaPrimary: string;
      ctaSecondary: string;
      ctaGithub: string;
    };
    nav: { github: string; download: string; docs: string };
  };
}

const REAL_SIGNALS = {
  en: [
    { label: 'license', value: 'MIT' },
    { label: 'packages', value: '64' },
    { label: 'specs', value: '634' },
    { label: 'stars', value: '8' }
  ],
  'zh-CN': [
    { label: '许可证', value: 'MIT' },
    { label: '包', value: '64' },
    { label: '测试', value: '634' },
    { label: 'Star', value: '8' }
  ]
} as const;

export default function Hero({ locale, dict }: HeroProps) {
  const signals = REAL_SIGNALS[locale];

  return (
    <section className="relative pt-24 pb-16 md:pt-32 md:pb-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-16 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          {/* Left — copy */}
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-muted)]">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--wb-brand)]" />
              <span>{ dict.hero.chip }</span>
            </div>

            <h1 className={ locale === 'zh-CN' ? 'font-display-serif text-[clamp(32px,4.2vw,52px)] font-normal leading-[1.08] tracking-[-0.025em] text-[var(--wb-fg)]' : 'font-display-serif text-[clamp(48px,7vw,96px)] font-normal leading-[1.02] tracking-[-0.035em] text-[var(--wb-fg)]' }>
              { dict.hero.titlePre }
              <span className="block">{ dict.hero.titleHighlight }</span>
              <span className="block italic text-[var(--wb-fg-muted)]">{ dict.hero.titlePost }</span>
            </h1>

            <p className="mt-8 max-w-xl text-[18px] leading-[1.55] text-[var(--wb-fg-muted)]">
              { dict.hero.subtitle }
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href={ localizedPath('/download', locale) }
                className="cta-link cta-link-primary bg-[var(--wb-fg)] px-5 py-3 text-[var(--wb-bg)]"
              >
                <span>{ dict.hero.ctaPrimary }</span>
                <span className="cta-link-arrow">→</span>
              </Link>
              <a
                href="https://github.com/louloulin/OpenBuddy"
                target="_blank"
                rel="noreferrer"
                className="cta-link border border-[var(--wb-border-strong)] px-5 py-3 text-[var(--wb-fg)]"
              >
                <GithubIcon size={ 14 } />
                <span>{ dict.hero.ctaGithub }</span>
              </a>
              <Link
                href={ localizedPath('/docs', locale) }
                className="cta-link px-2 py-3 text-[var(--wb-fg-muted)]"
              >
                <span>{ dict.hero.ctaSecondary }</span>
              </Link>
            </div>

            {/* Trust signals */}
            <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              { signals.map((s) => (
                <div key={ s.label } className="flex items-baseline gap-2 border-l border-[var(--wb-border)] pl-3">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
                    { s.label }
                  </dt>
                  <dd className="font-display-serif text-[20px] text-[var(--wb-fg)]">{ s.value }</dd>
                </div>
              )) }
            </dl>
          </div>

          {/* Right — product visual */}
          <div className="relative">
            <div className="absolute -inset-6 -z-10 rounded-[32px] bg-gradient-to-br from-[var(--wb-brand-soft)] via-transparent to-transparent blur-2xl" />
            <div className="overflow-hidden rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] shadow-[0_24px_80px_-24px_rgba(21,43,67,0.18)]">
              <div className="flex items-center gap-2 border-b border-[var(--wb-border)] px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--wb-border-strong)]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--wb-border-strong)]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--wb-border-strong)]" />
                <div className="ml-3 flex flex-1 items-center gap-2 font-mono text-[11px] text-[var(--wb-fg-faint)]">
                  <Logo size={ 14 } showWordmark={ false } />
                  <span>openbuddy://chat</span>
                </div>
              </div>
              <Image
                src="/screenshots/desktop-main.png"
                alt="OpenBuddy desktop — primary workspace with conversation and tool sidebar"
                width={ 1400 }
                height={ 900 }
                priority
                className="block h-auto w-full"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}