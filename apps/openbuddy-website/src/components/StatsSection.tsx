import type { Dict } from '@/lib/i18n';

interface StatsSectionProps {
  dict: Dict;
}

/**
 * StatsSection —— tutti 风格重做
 *
 * - 深色面板 (tutti 海军色)
 * - 数字用 serif (Instrument Serif) 大字
 * - 简洁的 monospace 标签
 * - 状态色用作"重要性"指示
 */
export default function StatsSection({ dict }: StatsSectionProps) {
  // 为每个 stat 分配 state 色 (tutti 设计: 状态色表示重要性)
  const tones: Array<'working' | 'accent' | 'warning' | 'idle'> = [
    'working',  // 64 packages
    'accent',   // 309 tests
    'idle',     // 26 UI
    'working',  // 12 capabilities
    'warning',  // 8 collaboration
    'accent'    // 100% auditable
  ];

  return (
    <section className="relative overflow-hidden bg-[#0A0F1E] py-24 text-white sm:py-32">
      <div className="absolute inset-0 -z-10 opacity-20 bg-editor-grid" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-end gap-8 md:grid-cols-[auto_1fr] md:gap-16">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/40">
              { dict.stats.sectionLabel }
            </span>
            <span className="font-mono text-[11px] text-white/40">03</span>
          </div>
          <h2 className="font-display-serif text-[clamp(2rem,4vw,3rem)] leading-[1.05] text-balance text-white">
            { dict.stats.title }
          </h2>
        </div>

        <p className="mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-white/60">
          { dict.stats.subtitle }
        </p>

        <div className="mt-16 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/5 sm:grid-cols-2 lg:grid-cols-3">
          { dict.stats.items.map((s, idx) => {
            const tone = tones[idx] ?? 'idle';
            const dotColor =
              tone === 'working' ? '#22C55E' :
              tone === 'accent'   ? '#818CF8' :
              tone === 'warning'  ? '#F59E0B' :
                                    '#6B7280';
            return (
              <div
                key={ s.label }
                className="group relative bg-[#0A0F1E] p-7 transition-colors hover:bg-[#111827]"
              >
                {/* Top row: dot + label */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={ { background: dotColor } }
                    />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-white/40">
                      { String(idx + 1).padStart(2, '0') }
                    </span>
                  </div>
                </div>

                {/* Big number — serif */}
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="font-display-serif text-[56px] leading-none tracking-tight text-white sm:text-[68px]">
                    { s.value }
                  </span>
                  { s.suffix ? (
                    <span className="font-display-serif text-[32px] text-[#22C55E] sm:text-[40px]">
                      { s.suffix }
                    </span>
                  ) : null }
                </div>

                {/* Label */}
                <div className="mt-3 text-[13px] font-semibold text-white">
                  { s.label }
                </div>
                <div className="mt-1 text-[12px] leading-relaxed text-white/55">
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