'use client';

import {
  Sparkles,
  Cpu,
  KeyRound,
  Puzzle,
  GitBranch,
  Building2,
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
 * FeaturesSection —— 核心功能展示
 *
 * 设计要点：
 * - 6 张卡片，每张含 icon + 标题 + 描述 + 3 个要点
 * - 网格布局：桌面 3 列、平板 2 列、手机 1 列
 * - Hover 时卡片上浮 + border 变深
 */
export default function FeaturesSection({ dict }: FeaturesSectionProps) {
  return (
    <section id="features" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          label={ dict.features.sectionLabel }
          title={ dict.features.title }
          subtitle={ dict.features.subtitle }
        />

        <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          { dict.features.items.map((feature, idx) => {
            const Icon = ICON_MAP[feature.icon] ?? Sparkles;
            return (
              <article
                key={ feature.title }
                className="group relative flex flex-col rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-6 transition-all hover:-translate-y-1 hover:border-[var(--wb-fg-muted)] hover:shadow-wb-card-hover"
                style={ { animationDelay: `${idx * 50}ms` } }
              >
                {/* Top row: icon */}
                <div className="mb-5 flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand-2 to-brand-4 text-brand-10 transition-transform group-hover:scale-110 dark:text-brand-8">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="font-mono text-[10px] text-[var(--wb-fg-muted)] opacity-0 transition-opacity group-hover:opacity-100">
                    { String(idx + 1).padStart(2, '0') }
                  </span>
                </div>

                <h3 className="font-display text-[18px] font-semibold tracking-tight text-[var(--wb-fg)]">
                  { feature.title }
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--wb-fg-muted)]">
                  { feature.description }
                </p>

                <ul className="mt-5 space-y-2 border-t border-[var(--wb-border)] pt-5">
                  { feature.bullets.map((bullet) => (
                    <li
                      key={ bullet }
                      className="flex items-start gap-2 text-[13px] text-[var(--wb-fg-muted)]"
                    >
                      <span className="mt-1 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-brand-8" />
                      <span>{ bullet }</span>
                    </li>
                  )) }
                </ul>
              </article>
            );
          }) }
        </div>
      </div>
    </section>
  );
}

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
        <span className="h-px w-6 bg-[var(--wb-fg-muted)]" />
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--wb-fg-muted)]">
          { label }
        </span>
        <span className="h-px w-6 bg-[var(--wb-fg-muted)]" />
      </div>
      <h2 className="mt-4 font-display text-display-lg text-balance text-[var(--wb-fg)]">
        { title }
      </h2>
      { subtitle ? (
        <p className="mt-4 text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)] sm:text-[16px]">
          { subtitle }
        </p>
      ) : null }
    </div>
  );
}