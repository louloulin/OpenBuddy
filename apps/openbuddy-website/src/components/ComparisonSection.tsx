import { Check, X, Minus } from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SharedHeader } from './SharedHeader';

interface ComparisonSectionProps {
  dict: Dict;
}

/**
 * ComparisonSection —— tutti 严格对标版
 *
 * 关键变化 (vs 旧版):
 * - 双栏 side-by-side 大字对比 (tutti 风格)
 * - 不再使用繁复的 table 布局
 * - 用 serif 突出关键比较点
 * - cream 背景, 暗/亮交替
 */
export default function ComparisonSection({ dict }: ComparisonSectionProps) {
  return (
    <section
      id="comparison"
      data-section-theme="cream"
      className="relative section-pad bg-[var(--wb-bg)]"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SharedHeader
          number="04"
          label={ dict.comparison.sectionLabel }
          title={ dict.comparison.title }
          subtitle={ dict.comparison.subtitle }
        />

        {/* 双栏大字对比 */}
        <div className="mt-16 grid gap-8 lg:grid-cols-2">
          {/* OpenBuddy 栏 */}
          <div className="rounded-xl border border-[var(--wb-accent)]/20 bg-[var(--wb-bg-pure)] p-8">
            <div className="flex items-center gap-3 border-b border-[var(--wb-border)] pb-5">
              <span className="flex h-3 w-3 rounded-full bg-[var(--wb-accent)]" />
              <h3 className="font-display-serif text-[28px] leading-tight text-[var(--wb-fg)]">
                { dict.comparison.openbuddyLabel }
              </h3>
              <span className="ml-auto rounded-full bg-[var(--wb-accent)]/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--wb-accent)]">
                100% MIT
              </span>
            </div>
            <ul className="mt-6 space-y-4">
              { dict.comparison.rows.map((row) => (
                <li key={ row.capability } className="flex items-start gap-3">
                  <Check className="mt-1 h-4 w-4 flex-shrink-0 text-[var(--wb-working)]" />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[12px] uppercase tracking-wider text-[var(--wb-fg-faint)]">
                      { row.capability }
                    </div>
                    <div className="mt-1 text-[14.5px] leading-snug text-[var(--wb-fg)]">
                      { stripMarker(row.openbuddy) }
                    </div>
                  </div>
                </li>
              )) }
            </ul>
          </div>

          {/* WorkBuddy 栏 */}
          <div className="rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-8 opacity-90">
            <div className="flex items-center gap-3 border-b border-[var(--wb-border)] pb-5">
              <span className="flex h-3 w-3 rounded-full bg-[var(--wb-idle)]" />
              <h3 className="font-display-serif text-[28px] leading-tight text-[var(--wb-fg-muted)]">
                { dict.comparison.workbuddyLabel }
              </h3>
              <span className="ml-auto rounded-full bg-[var(--wb-bg-soft)] px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--wb-fg-muted)]">
                proprietary
              </span>
            </div>
            <ul className="mt-6 space-y-4">
              { dict.comparison.rows.map((row) => (
                <li key={ row.capability } className="flex items-start gap-3">
                  { row.advantage === 'workbuddy' ? (
                    <Check className="mt-1 h-4 w-4 flex-shrink-0 text-[var(--wb-fg-muted)]" />
                  ) : row.advantage === 'tie' ? (
                    <Minus className="mt-1 h-4 w-4 flex-shrink-0 text-[var(--wb-fg-faint)]" />
                  ) : (
                    <X className="mt-1 h-4 w-4 flex-shrink-0 text-[var(--wb-blocked)]" />
                  ) }
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[12px] uppercase tracking-wider text-[var(--wb-fg-faint)]">
                      { row.capability }
                    </div>
                    <div className="mt-1 text-[14.5px] leading-snug text-[var(--wb-fg-muted)]">
                      { stripMarker(row.workbuddy) }
                    </div>
                  </div>
                </li>
              )) }
            </ul>
          </div>
        </div>

        <p className="mt-12 text-center text-[13px] text-[var(--wb-fg-muted)]">
          Only rows we can publicly substantiate.{ ' ' }
          <a
            href="https://github.com/louloulin/OpenBuddy/blob/main/docs/workbuddy-parity-matrix.md"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--wb-accent)] hover:underline"
          >
            Full matrix on GitHub →
          </a>
        </p>
      </div>
    </section>
  );
}

function stripMarker(value: string): string {
  // 移除前缀的 ✓ / ✗ 符号 (用于 visual icon)
  return value.replace(/^[✓✗]\s*/, '').trim();
}
