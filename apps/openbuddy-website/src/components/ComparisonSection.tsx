import { Check, X, Minus } from 'lucide-react';
import type { Dict } from '@/lib/i18n';

interface ComparisonSectionProps {
  dict: Dict;
}

/**
 * ComparisonSection —— tutti 风格重做
 *
 * - 单列行，每行: capability 名称 + OpenBuddy 状态 + WorkBuddy 状态
 * - 状态色: ✓=绿, ✗=红, 空=灰
 * - 简洁边框
 * - 更紧凑、信息密度高
 */
export default function ComparisonSection({ dict }: ComparisonSectionProps) {
  return (
    <section id="comparison" className="relative section-pad">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="grid items-end gap-8 md:grid-cols-[auto_1fr] md:gap-16">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
              { dict.comparison.sectionLabel }
            </span>
            <span className="font-mono text-[11px] text-[var(--wb-fg-faint)]">04</span>
          </div>
          <h2 className="font-display-serif text-[clamp(2rem,4vw,3rem)] leading-[1.05] text-balance text-[var(--wb-fg)]">
            { dict.comparison.title }
          </h2>
        </div>

        <p className="mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)]">
          { dict.comparison.subtitle }
        </p>

        {/* Compare table — clean & readable */}
        <div className="mt-16 overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-bg-pure)]">
          {/* Header row */}
          <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-4 border-b border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-5 py-3 text-[11px] font-mono uppercase tracking-wider text-[var(--wb-fg-faint)] sm:grid-cols-[2fr_1.5fr_1.5fr]">
            <div>Capability</div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--wb-working)]" />
              <span className="text-[var(--wb-fg)]">{ dict.comparison.openbuddyLabel }</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--wb-idle)]" />
              <span>{ dict.comparison.workbuddyLabel }</span>
            </div>
          </div>

          {/* Body */}
          { dict.comparison.rows.map((row, idx) => {
            const isWin = row.advantage === 'openbuddy';
            const isTie = row.advantage === 'tie';
            return (
              <div
                key={ row.capability }
                className={ `grid grid-cols-[1.5fr_1fr_1fr] gap-4 border-b border-[var(--wb-border)] px-5 py-3.5 text-[13px] last:border-b-0 sm:grid-cols-[2fr_1.5fr_1.5fr] ${
                  isWin ? 'bg-[var(--wb-working-soft)]/40' : ''
                }` }
              >
                <div className="font-medium text-[var(--wb-fg)]">
                  { row.capability }
                </div>
                <Cell value={ row.openbuddy } highlight isTie={ isTie } />
                <Cell value={ row.workbuddy } muted isTie={ isTie } />
              </div>
            );
          }) }
        </div>

        <p className="mt-6 text-center text-[12px] text-[var(--wb-fg-muted)]">
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
  const isYes = value.startsWith('✓') || value === '✓';
  const isNo = value.startsWith('✗') || value === '✗';

  return (
    <div
      className={ `flex items-center gap-2 ${
        highlight ? 'text-[var(--wb-fg)]' : muted ? 'text-[var(--wb-fg-muted)]' : 'text-[var(--wb-fg)]'
      } ${isTie ? 'italic' : ''}` }
    >
      { isYes ? (
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[var(--wb-working)] text-white">
          <Check className="h-2.5 w-2.5" />
        </span>
      ) : isNo ? (
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[var(--wb-blocked)] text-white">
          <X className="h-2.5 w-2.5" />
        </span>
      ) : (
        <span className="h-4 w-4 flex-shrink-0" />
      ) }
      <span className="text-balance">{ value }</span>
    </div>
  );
}