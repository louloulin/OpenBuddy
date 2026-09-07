import { Check, X, Minus } from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SectionHeader } from './FeaturesSection';

interface ComparisonSectionProps {
  dict: Dict;
}

/**
 * ComparisonSection —— OpenBuddy vs WorkBuddy 对比表
 *
 * 设计要点：
 * - 桌面：双列对比表，每行能力对比
 * - OpenBuddy 列突出品牌色背景
 * - advantage === 'openbuddy' 时该行轻微 brand 背景
 * - 移动端：垂直堆叠，OpenBuddy 在前
 */
export default function ComparisonSection({ dict }: ComparisonSectionProps) {
  return (
    <section id="comparison" className="relative bg-[var(--wb-bg-soft)] py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          label={ dict.comparison.sectionLabel }
          title={ dict.comparison.title }
          subtitle={ dict.comparison.subtitle }
        />

        <div className="mx-auto mt-16 max-w-5xl overflow-hidden rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg)] shadow-wb-card">
          {/* Header row */}
          <div className="grid grid-cols-[1.6fr_1fr_1fr] border-b border-[var(--wb-border)] bg-[var(--wb-bg-soft)] sm:grid-cols-[2fr_1.5fr_1.5fr]">
            <div className="px-4 py-4 text-[12px] font-medium uppercase tracking-wider text-[var(--wb-fg-muted)] sm:px-6">
              Capability
            </div>
            <div className="border-l border-[var(--wb-border)] px-4 py-4 sm:px-6">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand-9 text-[10px] text-white">
                  🐕
                </span>
                <span className="text-[13px] font-semibold text-[var(--wb-fg)]">{ dict.comparison.openbuddyLabel }</span>
              </div>
              <p className="mt-0.5 text-[11px] text-brand-9">100% MIT · Auditable</p>
            </div>
            <div className="border-l border-[var(--wb-border)] px-4 py-4 sm:px-6">
              <span className="text-[13px] font-semibold text-[var(--wb-fg-muted)]">{ dict.comparison.workbuddyLabel }</span>
              <p className="mt-0.5 text-[11px] text-[var(--wb-fg-muted)]">Closed-source</p>
            </div>
          </div>

          {/* Body rows */}
          { dict.comparison.rows.map((row, idx) => {
            const isWin = row.advantage === 'openbuddy';
            const isTie = row.advantage === 'tie';
            return (
              <div
                key={ row.capability }
                className={ `grid grid-cols-[1.6fr_1fr_1fr] border-b border-[var(--wb-border)] transition-colors last:border-b-0 sm:grid-cols-[2fr_1.5fr_1.5fr] ${
                  isWin ? 'bg-brand-1/30' : idx % 2 === 0 ? 'bg-[var(--wb-bg)]' : 'bg-[var(--wb-bg-soft)]/30'
                }` }
              >
                <div className="flex items-center px-4 py-3 text-[13px] font-medium text-[var(--wb-fg)] sm:px-6 sm:py-4">
                  { row.capability }
                </div>
                <Cell value={ row.openbuddy } highlight isTie={ isTie } />
                <Cell value={ row.workbuddy } isTie={ isTie } muted />
              </div>
            );
          }) }
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-[12px] text-[var(--wb-fg-muted)]">
          Only rows we can publicly substantiate.{ ' ' }
          <a
            href="https://github.com/louloulin/OpenBuddy/blob/main/docs/workbuddy-parity-matrix.md"
            target="_blank"
            rel="noreferrer"
            className="text-brand-9 hover:underline"
          >
            Full matrix on GitHub →
          </a>
        </p>
      </div>
    </section>
  );
}

function Cell({
  value,
  highlight = false,
  muted = false,
  isTie = false
}: {
  value: string;
  highlight?: boolean;
  muted?: boolean;
  isTie?: boolean;
}) {
  // Auto-detect ✓ / ✗ / -
  const isYes = value.startsWith('✓') || value === '✓';
  const isNo = value.startsWith('✗') || value === '✗';

  return (
    <div
      className={ `flex items-center gap-2 border-l border-[var(--wb-border)] px-4 py-3 text-[13px] sm:px-6 sm:py-4 ${
        highlight ? 'text-[var(--wb-fg)]' : muted ? 'text-[var(--wb-fg-muted)]' : 'text-[var(--wb-fg)]'
      } ${isTie ? 'italic' : ''}` }
    >
      { isYes ? (
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-3 text-brand-9">
          <Check className="h-3 w-3" />
        </span>
      ) : isNo ? (
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-3 text-red-9">
          <X className="h-3 w-3" />
        </span>
      ) : (
        <Minus className="h-3.5 w-3.5 flex-shrink-0 text-[var(--wb-fg-muted)] opacity-0" />
      ) }
      <span className="text-balance">{ value }</span>
    </div>
  );
}