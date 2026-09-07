'use client';

import {
  Sparkles,
  Cpu,
  KeyRound,
  Puzzle,
  GitBranch,
  Building2,
  ArrowUpRight,
  type LucideIcon
} from 'lucide-react';
import type { Dict } from '@/lib/i18n';

interface FeaturesSectionProps {
  dict: Dict;
}

const ICON_MAP: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  cpu: Cpu,
  'key-round': KeyRound,
  puzzle: Puzzle,
  'git-branch': GitBranch,
  'building-2': Building2
};

/**
 * FeaturesSection —— tutti 风格重做
 *
 * - 每个 feature：编号 01-06 + 简洁一句话标题 + 描述
 * - 大标题用 serif (Instrument Serif) 强调品牌
 * - Hover 显示箭头 + 边框变深
 * - 信息密度高，留白克制
 */
export default function FeaturesSection({ dict }: FeaturesSectionProps) {
  return (
    <section id="features" className="relative section-pad">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="grid items-end gap-8 md:grid-cols-[auto_1fr] md:gap-16">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
              { dict.features.sectionLabel }
            </span>
            <span className="font-mono text-[11px] text-[var(--wb-fg-faint)]">01 — 06</span>
          </div>
          <h2 className="font-display-serif text-[clamp(2rem,4vw,3rem)] leading-[1.05] text-balance text-[var(--wb-fg)]">
            { dict.features.title }
          </h2>
        </div>

        <p className="mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)]">
          { dict.features.subtitle }
        </p>

        {/* Feature list — list 风格而非 grid */}
        <div className="mt-20 grid gap-px overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-border)] md:grid-cols-2 lg:grid-cols-3">
          { dict.features.items.map((feature, idx) => {
            const Icon = ICON_MAP[feature.icon] ?? Sparkles;
            return (
              <article
                key={ feature.title }
                className="group relative flex flex-col gap-4 bg-[var(--wb-bg-pure)] p-6 transition-colors hover:bg-[var(--wb-bg-soft)]"
              >
                {/* Number + Icon row */}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-medium text-[var(--wb-fg-faint)]">
                    { String(idx + 1).padStart(2, '0') }
                  </span>
                  <Icon className="h-4 w-4 text-[var(--wb-fg-faint)] transition-colors group-hover:text-[var(--wb-fg)]" />
                </div>

                {/* Title */}
                <h3 className="font-display-serif text-[20px] leading-snug text-[var(--wb-fg)]">
                  { feature.title }
                </h3>

                {/* Description */}
                <p className="text-[13.5px] leading-relaxed text-[var(--wb-fg-muted)]">
                  { feature.description }
                </p>

                {/* Bullets */}
                <ul className="mt-2 space-y-1.5">
                  { feature.bullets.map((bullet) => (
                    <li
                      key={ bullet }
                      className="flex items-start gap-2 text-[12.5px] leading-relaxed text-[var(--wb-fg-muted)]"
                    >
                      <span className="mt-1.5 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-[var(--wb-fg-faint)]" />
                      <span>{ bullet }</span>
                    </li>
                  )) }
                </ul>

                {/* Arrow appears on hover */}
                <div className="mt-auto flex items-center justify-end pt-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--wb-fg-faint)]" />
                </div>
              </article>
            );
          }) }
        </div>
      </div>
    </section>
  );
}

/**
 * SectionHeader (保留兼容 — 其他 section 使用)
 */
export function SectionHeader({
  label,
  title,
  subtitle,
  centered = true
}: {
  label: string;
  title: string;
  subtitle?: string;
  centered?: boolean;
}) {
  return (
    <div className={ `${centered ? 'text-center' : ''} max-w-3xl ${centered ? 'mx-auto' : ''}` }>
      <div className={ `inline-flex items-center gap-2 ${centered ? 'justify-center' : ''}` }>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
          { label }
        </span>
      </div>
      <h2 className="mt-4 font-display-serif text-[clamp(2rem,4vw,3rem)] leading-[1.05] text-balance text-[var(--wb-fg)]">
        { title }
      </h2>
      { subtitle ? (
        <p className="mt-4 text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)]">
          { subtitle }
        </p>
      ) : null }
    </div>
  );
}