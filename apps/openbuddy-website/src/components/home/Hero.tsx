import Link from 'next/link';
import Image from 'next/image';
import type { CSSProperties } from 'react';
import { GithubIcon } from '@/components/icons/BrandIcons';
import Logo from '@/components/icons/Logo';
import { localizedPath, type Locale } from '@/lib/i18n';

/**
 * Splits a title fragment into per-word spans carrying their stagger index.
 * The space between words is emitted as a sibling text node rather than inside
 * the span: trailing whitespace inside an inline-block is collapsed away, which
 * would run the words together and stop the heading from wrapping.
 */
function WordSpans({ text, offset }: { text: string; offset: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      { words.flatMap((word, i) => [
        <span
          key={ i }
          className="hero-word"
          style={ { '--i': offset + i } as CSSProperties }
        >
          { word }
        </span>,
        i < words.length - 1 ? ' ' : null
      ]) }
    </>
  );
}

/**
 * Separator to emit between two title fragments. English always needs one.
 * Chinese needs one only where a CJK glyph meets a Latin one — `开源的桌面` +
 * `AI 工作台,` must not render as `桌面AI`; the usual spacing rule applies
 * because the fragments happen to be split on exactly that boundary.
 */
function fragmentSeparator(locale: Locale, before: string, after: string): string {
  if (locale !== 'zh-CN') return ' ';
  const a = before.trim().slice(-1);
  const b = after.trim().slice(0, 1);
  const cjk = /[㐀-鿿]/;
  const latin = /[A-Za-z0-9]/;
  return (cjk.test(a) && latin.test(b)) || (latin.test(a) && cjk.test(b)) ? ' ' : '';
}

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
      metrics: Array<{ value: string; label: string }>;
    };
  };
}

export default function Hero({ locale, dict }: HeroProps) {
  const signals = dict.hero.metrics;
  // Word counts drive the stagger offset of each block so the reveal runs as
  // one continuous cascade instead of restarting at every line.
  const preCount = dict.hero.titlePre.split(/\s+/).filter(Boolean).length;
  const highlightCount = dict.hero.titleHighlight.split(/\s+/).filter(Boolean).length;

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
              <WordSpans text={ dict.hero.titlePre } offset={ 0 } />
              { /* The three fragments sit on separate lines, so JSX drops the
                   whitespace between them — `textContent` then reads
                   "desktopAI workspaceyou" for crawlers and screen readers. */ }
              { fragmentSeparator(locale, dict.hero.titlePre, dict.hero.titleHighlight) }
              <span className="block">
                <WordSpans text={ dict.hero.titleHighlight } offset={ preCount } />
              </span>
              { fragmentSeparator(locale, dict.hero.titleHighlight, dict.hero.titlePost) }
              <span className="block italic text-[var(--wb-fg-muted)]">
                <WordSpans
                  text={ dict.hero.titlePost }
                  offset={ preCount + highlightCount }
                />
              </span>
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