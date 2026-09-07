import {
  Cpu,
  FolderOpen,
  Users,
  ShieldCheck,
  Mail,
  Plug,
  type LucideIcon
} from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SectionHeader } from './FeaturesSection';

interface CapabilitiesSectionProps {
  dict: Dict;
}

const ICON_MAP: Record<string, LucideIcon> = {
  cpu: Cpu,
  'folder-open': FolderOpen,
  users: Users,
  'shield-check': ShieldCheck,
  mail: Mail,
  plug: Plug
};

/**
 * CapabilitiesSection —— 能力网格
 *
 * 设计要点：
 * - 6 个分组 (Core agent / Files / Multi-agent / Enterprise / Email / MCP & Security)
 * - 每组：icon + 名称 + 包列表
 * - 包：monospace 名称 + 一行描述
 * - hover 时分组卡片轻微上浮
 */
export default function CapabilitiesSection({ dict }: CapabilitiesSectionProps) {
  return (
    <section id="capabilities" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          label={ dict.capabilities.sectionLabel }
          title={ dict.capabilities.title }
          subtitle={ dict.capabilities.subtitle }
        />

        <div className="mt-16 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          { dict.capabilities.groups.map((group) => {
            const Icon = ICON_MAP[group.icon] ?? Cpu;
            return (
              <article
                key={ group.name }
                className="group flex flex-col rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-5 transition-all hover:-translate-y-0.5 hover:border-[var(--wb-fg-muted)] hover:shadow-wb-card-hover"
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[var(--wb-border)] pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-2 to-brand-4 text-brand-10 dark:text-brand-8">
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <h3 className="font-display text-[15px] font-semibold tracking-tight text-[var(--wb-fg)]">
                      { group.name }
                    </h3>
                  </div>
                  <span className="font-mono text-[10px] text-[var(--wb-fg-muted)]">
                    { String(group.packages.length).padStart(2, '0') } pkgs
                  </span>
                </div>

                {/* Package list */}
                <ul className="mt-4 space-y-2.5">
                  { group.packages.map((pkg) => (
                    <li key={ pkg.name }>
                      <div className="flex items-baseline gap-2">
                        <code className="font-mono text-[11.5px] font-medium text-brand-9">
                          { pkg.name }
                        </code>
                      </div>
                      <p className="ml-1 mt-0.5 text-[12px] leading-snug text-[var(--wb-fg-muted)]">
                        { pkg.description }
                      </p>
                    </li>
                  )) }
                </ul>
              </article>
            );
          }) }
        </div>

        <div className="mt-12 text-center">
          <a
            href="https://github.com/louloulin/OpenBuddy/tree/main/packages"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--wb-border)] bg-[var(--wb-bg)] px-4 py-2 text-[12px] font-medium text-[var(--wb-fg)] transition-colors hover:bg-[var(--wb-bg-soft-2)]"
          >
            Browse 63 packages on GitHub →
          </a>
        </div>
      </div>
    </section>
  );
}