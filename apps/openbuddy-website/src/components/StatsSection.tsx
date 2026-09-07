import type { Dict } from '@/lib/i18n';
import { SharedHeader } from './SharedHeader';

interface StatsSectionProps {
  dict: Dict;
}

/**
 * StatsSection —— tutti 严格对标 (浅色)
 *
 * - 6 个数据, 2-3 列网格
 * - 大字 serif 显示, monospace 标签
 * - 浅色背景, 暗/亮交替
 */
export default function StatsSection({ dict }: StatsSectionProps) {
  const accents = ['#16A34A', '#5266E8', '#6B7280', '#16A34A', '#D97706', '#5266E8'];

  return (
    <section data-section-theme="light" className="relative section-pad bg-[var(--wb-bg)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SharedHeader
          number="06"
          label={ dict.stats.sectionLabel }
          title={ dict.stats.title }
          subtitle={ dict.stats.subtitle }
        />

        <div className="mt-16 grid gap-px overflow-hidden rounded-xl border border-[var(--wb-border)] bg-[var(--wb-border)] sm:grid-cols-2 lg:grid-cols-3">
          { dict.stats.items.map((s, idx) => {
            const accent = accents[idx] ?? '#6B7280';
            return (
              <div
                key={ s.label }
                className="group relative bg-[var(--wb-bg-pure)] p-7 transition-colors hover:bg-[var(--wb-bg-soft)]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={ { background: accent } }
                    />
                    <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--wb-fg-faint)]">
                      { String(idx + 1).padStart(2, '0') }
                    </span>
                  </div>
                </div>

                <div className="mt-6 flex items-baseline gap-1">
                  <span className="font-display-serif text-[56px] leading-none tracking-tight text-[var(--wb-fg)] sm:text-[64px]">
                    { s.value }
                  </span>
                  { s.suffix ? (
                    <span className="font-display-serif text-[28px] text-[#16A34A] sm:text-[36px]">
                      { s.suffix }
                    </span>
                  ) : null }
                </div>

                <div className="mt-4 text-[13.5px] font-semibold text-[var(--wb-fg)]">
                  { s.label }
                </div>
                <div className="mt-1.5 text-[13px] leading-relaxed text-[var(--wb-fg-muted)]">
                  { s.description }
                </div>
              </div>
            );
          }) }
        </div>
      </div>
    </section>
  );
}
