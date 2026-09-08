import { Github, Users as UsersIcon } from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SharedHeader } from './SharedHeader';

interface CTASectionProps {
  dict: Dict;
}

/**
 * CTASection —— tutti 严格对标 (深色 + 大字)
 *
 * - 暗色背景
 * - 文本链 CTA (不用按钮)
 * - 4 个数据 stat row
 */
export default function CTASection({ dict }: CTASectionProps) {
  return (
    <section
      data-section-theme="dark"
      className="relative bg-black py-32 text-white"
    >
      <div className="absolute inset-0 -z-10 opacity-20 bg-editor-grid" />

      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-end gap-6 md:grid-cols-[100px_1fr] md:gap-10">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/40">
              § 12
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/40">
              Get started
            </span>
          </div>
          <h2 className="text-display-2xl text-white text-balance">
            { dict.cta.title }
          </h2>
        </div>
        <p className="mt-8 max-w-2xl text-body-xl text-white/70 text-pretty md:ml-[120px]">
          { dict.cta.subtitle }
        </p>

        <div className="mt-12 flex flex-wrap items-center gap-x-10 gap-y-4 md:ml-[120px]">
          <a
            href="https://github.com/louloulin/OpenBuddy"
            target="_blank"
            rel="noreferrer"
            className="cta-link text-white"
          >
            <Github className="h-4 w-4" />
            <span>{ dict.cta.ctaPrimary }</span>
            <span className="cta-link-arrow">→</span>
          </a>
          <a
            href="https://github.com/louloulin/OpenBuddy/discussions"
            target="_blank"
            rel="noreferrer"
            className="cta-link text-white/80 hover:text-white"
          >
            <UsersIcon className="h-4 w-4" />
            <span>{ dict.cta.ctaSecondary }</span>
            <span className="cta-link-arrow">→</span>
          </a>
        </div>

        {/* Stat row */}
        <div className="mt-24 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-4">
          { [
            { value: '12.8k', label: 'GitHub stars' },
            { value: '64', label: 'capability packages' },
            { value: '455', label: 'tests in repo' },
            { value: 'MIT', label: 'forkable' }
          ].map((s) => (
            <div key={ s.label } className="bg-black p-6">
              <div className="font-display-serif text-[36px] leading-none tabular-nums text-white sm:text-[44px]">
                { s.value }
              </div>
              <div className="mt-3 font-mono text-[10.5px] uppercase tracking-wider text-white/[0.45]">
                { s.label }
              </div>
            </div>
          )) }
        </div>
      </div>
    </section>
  );
}
