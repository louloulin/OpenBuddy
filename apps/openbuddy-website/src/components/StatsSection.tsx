import type { Dict } from '@/lib/i18n';
import { SectionHeader } from './FeaturesSection';

interface StatsSectionProps {
  dict: Dict;
}

/**
 * StatsSection —— 数据指标区
 *
 * 设计要点：
 * - 6 个数字卡片，3 列 × 2 行
 * - 每个数字 + 标签 + 描述
 * - 渐变文字 + 等宽字体大数字
 * - 深色背景
 */
export default function StatsSection({ dict }: StatsSectionProps) {
  return (
    <section className="relative overflow-hidden bg-[var(--wb-bg-dark)] py-24 text-white sm:py-32">
      {/* Background pattern */}
      <div className="absolute inset-0 -z-10 bg-editor-grid opacity-20" />
      <div className="absolute -left-32 top-1/2 -z-10 h-64 w-64 rounded-full bg-brand-8 opacity-10 blur-3xl" />
      <div className="absolute -right-32 top-1/4 -z-10 h-48 w-48 rounded-full bg-accent opacity-10 blur-3xl" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 justify-center text-white/60">
            <span className="h-px w-6 bg-white/30" />
            <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
              { dict.stats.sectionLabel }
            </span>
            <span className="h-px w-6 bg-white/30" />
          </div>
          <h2 className="mt-4 font-display text-display-lg text-balance text-white">
            { dict.stats.title }
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-[15px] leading-relaxed text-white/70 sm:text-[16px]">
            { dict.stats.subtitle }
          </p>
        </div>

        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/5 sm:grid-cols-2 lg:grid-cols-3">
          { dict.stats.items.map((s) => (
            <div
              key={ s.label }
              className="group relative bg-[var(--wb-bg-dark)] p-8 transition-colors hover:bg-[#161B22]"
            >
              <div className="flex items-baseline gap-1">
                <span className="font-display text-[44px] font-semibold leading-none tracking-tight text-white sm:text-[56px]">
                  { s.value }
                </span>
                { s.suffix ? (
                  <span className="font-display text-[28px] font-semibold text-brand-8 sm:text-[36px]">
                    { s.suffix }
                  </span>
                ) : null }
              </div>
              <div className="mt-3 text-[13px] font-semibold text-white">{ s.label }</div>
              <div className="mt-1 text-[12px] text-white/55">{ s.description }</div>

              {/* Bottom accent line */}
              <div className="absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-brand-8/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          )) }
        </div>
      </div>
    </section>
  );
}