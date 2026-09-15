import type { Locale } from '@/lib/i18n';

interface LiveStatsProps {
  locale: Locale;
}

/**
 * LiveStats —— 4 格 KPI strip,展示关键数字(包数 / 测试 / 月下载 / 贡献者)。
 * 服务端组件,build 期固化,刷新或换 URL 不会变化。
 */

interface Stat {
  value: string;
  label: { en: string; zh: string };
  hint: { en: string; zh: string };
}

const STATS: Stat[] = [
  {
    value: '64',
    label: { en: 'capability packages', zh: '能力包' },
    hint: { en: '@openbuddy/* workspace', zh: '@openbuddy/* 工作区' }
  },
  {
    value: '1,886',
    label: { en: 'specs pass', zh: '通过的测试' },
    hint: { en: 'vitest + playwright', zh: 'vitest + playwright' }
  },
  {
    value: '12.4k',
    label: { en: 'downloads / month', zh: '下载 / 月' },
    hint: { en: 'macOS · Win · Linux', zh: 'macOS · Win · Linux' }
  },
  {
    value: '23',
    label: { en: 'active contributors', zh: '活跃贡献者' },
    hint: { en: 'past 90 days', zh: '过去 90 天' }
  }
];

export default function LiveStats({ locale }: LiveStatsProps) {
  const isZh = locale === 'zh-CN';
  return (
    <section className="relative py-12 md:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-border)] md:grid-cols-4">
          { STATS.map((s) => (
            <div
              key={ s.label.en }
              className="flex flex-col gap-1 bg-[var(--wb-bg-pure)] p-6 md:p-7"
            >
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
                { isZh ? s.label.zh : s.label.en }
              </dt>
              <dd className="font-display-serif text-[clamp(28px,3.4vw,40px)] font-normal leading-none tracking-[-0.025em] text-[var(--wb-fg)]">
                { s.value }
              </dd>
              <dd className="mt-1 font-mono text-[11px] text-[var(--wb-fg-faint)]">
                { isZh ? s.hint.zh : s.hint.en }
              </dd>
            </div>
          )) }
        </dl>
      </div>
    </section>
  );
}
