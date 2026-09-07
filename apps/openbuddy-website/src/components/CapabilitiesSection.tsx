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
 * CapabilitiesSection —— tutti 风格重做
 *
 * - 不再是 6 张大卡片，而是 6 个 group 列表
 * - 每个 group: 编号 + icon + 名称 + 紧凑的 package 列表
 * - 信息密度高
 */
export default function CapabilitiesSection({ dict }: CapabilitiesSectionProps) {
  return (
    <section id="capabilities" className="relative section-pad">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="grid items-end gap-8 md:grid-cols-[auto_1fr] md:gap-16">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
              { dict.capabilities.sectionLabel }
            </span>
            <span className="font-mono text-[11px] text-[var(--wb-fg-faint)]">05</span>
          </div>
          <h2 className="font-display-serif text-[clamp(2rem,4vw,3rem)] leading-[1.05] text-balance text-[var(--wb-fg)]">
            { dict.capabilities.title }
          </h2>
        </div>

        <p className="mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)]">
          { dict.capabilities.subtitle }
        </p>

        {/* Capability groups — 2-col grid for desktop, single-col mobile */}
        <div className="mt-16 grid gap-px overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-border)] md:grid-cols-2 lg:grid-cols-3">
          { dict.capabilities.groups.map((group, idx) => {
            const Icon = ICON_MAP[group.icon] ?? Cpu;
            return (
              <div
                key={ group.name }
                className="group flex flex-col gap-4 bg-[var(--wb-bg-pure)] p-6 transition-colors hover:bg-[var(--wb-bg-soft)]"
              >
                {/* Group header */}
                <div className="flex items-center justify-between border-b border-[var(--wb-border)] pb-3">
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 text-[var(--wb-fg-faint)]" />
                    <h3 className="font-display-serif text-[17px] leading-tight text-[var(--wb-fg)]">
                      { group.name }
                    </h3>
                  </div>
                  <span className="font-mono text-[10px] text-[var(--wb-fg-faint)]">
                    { String(group.packages.length).padStart(2, '0') }
                  </span>
                </div>

                {/* Package list — compact, monospace */}
                <ul className="space-y-2">
                  { group.packages.map((pkg) => (
                    <li key={ pkg.name } className="group/pkg">
                      <code className="font-mono text-[12px] font-medium text-[var(--wb-fg)] group-hover/pkg:text-[var(--wb-accent)]">
                        { pkg.name }
                      </code>
                      <p className="mt-0.5 text-[12px] leading-snug text-[var(--wb-fg-muted)]">
                        { pkg.description }
                      </p>
                    </li>
                  )) }
                </ul>
              </div>
            );
          }) }
        </div>

        <div className="mt-12 text-center">
          <a
            href="https://github.com/louloulin/OpenBuddy/tree/main/packages"
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[13px] text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
          >
            Browse 63 packages on GitHub →
          </a>
        </div>
      </div>
    </section>
  );
}