import { getDictionary, type Locale } from '@/lib/i18n';
import CountUp from '@/components/motion/CountUp';

interface LiveStatsProps {
  locale: Locale;
}

/**
 * LiveStats —— KPI strip。
 * 数值来自 dict.stats.items,而 dict 的数值又由 lib/constants.ts 的 SITE_STATS
 * 插值而来 —— 改一处即可,不存在第二份硬编码副本。
 */
export default function LiveStats({ locale }: LiveStatsProps) {
  const { items } = getDictionary(locale).stats;

  return (
    <section className="relative py-12 md:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-border)] md:grid-cols-4">
          { items.map((s) => (
            <div
              key={ s.label }
              className="flex flex-col gap-1 bg-[var(--wb-bg-pure)] p-6 md:p-7"
            >
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
                { s.label }
              </dt>
              <dd className="font-display-serif text-[clamp(28px,3.4vw,40px)] font-normal leading-none tracking-[-0.025em] text-[var(--wb-fg)]">
                <CountUp value={ s.value } />{ s.suffix }
              </dd>
              <dd className="mt-1 font-mono text-[11px] text-[var(--wb-fg-faint)]">
                { s.description }
              </dd>
            </div>
          )) }
        </dl>
      </div>
    </section>
  );
}
