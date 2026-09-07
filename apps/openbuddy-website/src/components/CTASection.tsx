import { ArrowRight, Github, Users as UsersIcon } from 'lucide-react';
import type { Dict } from '@/lib/i18n';

interface CTASectionProps {
  dict: Dict;
}

/**
 * CTASection —— 页面底部号召性用语
 *
 * 设计要点：
 * - 大块背景 + brand 色光晕
 * - 双 CTA：主 GitHub + 次社区
 */
export default function CTASection({ dict }: CTASectionProps) {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl border border-[var(--wb-border)] bg-gradient-to-br from-[#0E1117] via-[#0C4A48] to-[#00614D] p-10 sm:p-16">
          {/* Background glow */}
          <div className="absolute -right-20 -z-10 h-60 w-60 rounded-full bg-brand-8 opacity-30 blur-3xl" />
          <div className="absolute -left-10 top-1/2 -z-10 h-40 w-40 rounded-full bg-brand-7 opacity-20 blur-3xl" />

          <div className="relative max-w-2xl">
            <h2 className="font-display text-display-md text-balance text-white">
              { dict.cta.title }
            </h2>
            <p className="mt-5 text-pretty text-[16px] leading-relaxed text-white/80">
              { dict.cta.subtitle }
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="https://github.com/louloulin/OpenBuddy"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 text-[14px] font-semibold text-[#0E1117] transition-all hover:bg-white/90 hover:shadow-xl"
              >
                <Github className="h-4 w-4" />
                <span>{ dict.cta.ctaPrimary }</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
              <a
                href="https://github.com/louloulin/OpenBuddy/discussions"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/30 bg-white/10 px-5 py-3 text-[14px] font-medium text-white backdrop-blur transition-colors hover:bg-white/15"
              >
                <UsersIcon className="h-4 w-4" />
                <span>{ dict.cta.ctaSecondary }</span>
              </a>
            </div>

            {/* Stat row */}
            <div className="mt-10 grid grid-cols-2 gap-4 border-t border-white/15 pt-8 sm:grid-cols-4">
              { [
                { value: '12.8k', label: 'GitHub stars' },
                { value: '64', label: 'capability packages' },
                { value: '455', label: 'tests in repo' },
                { value: 'MIT', label: 'forkable' }
              ].map((s) => (
                <div key={ s.label }>
                  <div className="font-mono text-[24px] font-semibold tabular-nums text-white sm:text-[28px]">
                    { s.value }
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-wider text-white/60">
                    { s.label }
                  </div>
                </div>
              )) }
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}