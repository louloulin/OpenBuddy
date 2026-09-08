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
import { SharedHeader } from './SharedHeader';

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
 * FeaturesSection —— tutti 严格对标
 *
 * - 6 个核心 feature, 大卡片布局
 * - 更大间距、字号
 * - hover 显示右上角箭头
 */
export default function FeaturesSection({ dict }: FeaturesSectionProps) {
  return (
    <section id="features" data-section-theme="light" className="relative section-pad bg-[var(--wb-bg)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SharedHeader
          number="03"
          label="Capabilities"
          title={ dict.features.title }
          subtitle={ dict.features.subtitle }
        />

        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          { dict.features.items.map((feature, idx) => {
            const Icon = ICON_MAP[feature.icon] ?? Sparkles;
            return (
              <article
                key={ feature.title }
                className="group relative flex flex-col gap-4 rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-7 transition-all hover:border-[var(--wb-border-strong)] hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] text-[var(--wb-fg-faint)]">
                      { String(idx + 1).padStart(2, '0') }
                    </span>
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--wb-bg-soft)]">
                      <Icon className="h-4 w-4 text-[var(--wb-fg)]" />
                    </span>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-[var(--wb-fg-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                </div>

                <h3 className="font-display-serif text-[22px] leading-snug text-[var(--wb-fg)]">
                  { feature.title }
                </h3>

                <p className="text-[14px] leading-relaxed text-[var(--wb-fg-muted)]">
                  { feature.description }
                </p>

                <ul className="mt-2 space-y-2">
                  { feature.bullets.map((bullet) => (
                    <li
                      key={ bullet }
                      className="flex items-start gap-3 text-[13.5px] leading-relaxed text-[var(--wb-fg-muted)]"
                    >
                      <span className="mt-2 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-[var(--wb-fg-faint)]" />
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
