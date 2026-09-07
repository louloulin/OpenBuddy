import { ArrowRight, Github, Users as UsersIcon } from 'lucide-react';
import type { Dict } from '@/lib/i18n';

interface CTASectionProps {
  dict: Dict;
}

/**
 * CTASection —— tutti 风格重做
 *
 * - 简洁标题 + 描述
 * - 黑色 primary CTA + ghost secondary
 * - 4 个关键数字 (monospace tabular-nums)
 */
export default function CTASection({ dict }: CTASectionProps) {
  return (
    <section className="relative section-pad">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-end gap-8 md:grid-cols-[auto_1fr] md:gap-16">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
              10 · Get started
            </span>
          </div>
          <h2 className="font-display-serif text-[clamp(2.5rem,5vw,4rem)] leading-[1.05] text-balance text-[var(--wb-fg)]">
            { dict.cta.title }
          </h2>
        </div>

        <p className="mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)]">
          { dict.cta.subtitle }
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <a
            href="https://github.com/louloulin/OpenBuddy"
            target="_blank"
            rel="noreferrer"
            className="btn-primary group !px-5 !py-3"
          >
            <Github className="h-4 w-4" />
            <span>{ dict.cta.ctaPrimary }</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href="https://github.com/louloulin/OpenBuddy/discussions"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary !px-5 !py-3"
          >
            <UsersIcon className="h-4 w-4" />
            <span>{ dict.cta.ctaSecondary }</span>
          </a>
        </div>

        {/* Stat row — bordered, monospace */}
        <div className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-border)] sm:grid-cols-4">
          { [
            { value: '12.8k', label: 'GitHub stars' },
            { value: '64', label: 'capability packages' },
            { value: '455', label: 'tests in repo' },
            { value: 'MIT', label: 'forkable' }
          ].map((s) => (
            <div key={ s.label } className="bg-[var(--wb-bg-pure)] p-5">
              <div className="font-display-serif text-[32px] leading-none tabular-nums text-[var(--wb-fg)] sm:text-[40px]">
                { s.value }
              </div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-[var(--wb-fg-faint)]">
                { s.label }
              </div>
            </div>
          )) }
        </div>
      </div>
    </section>
  );
}