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
import { SharedHeader } from './SharedHeader';

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
 * CapabilitiesSection —— tutti 严格对标
 *
 * - cream 背景, 暗/亮交替
 * - 6 组紧凑卡片
 * - 更大的间距和字号
 */
export default function CapabilitiesSection({ dict }: CapabilitiesSectionProps) {
  return (
    <section
      id="capabilities"
      data-section-theme="cream"
      className="relative section-pad bg-[var(--wb-bg)]"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SharedHeader
          number="02"
          label={ dict.capabilities.sectionLabel }
          title={ dict.capabilities.title }
          subtitle={ dict.capabilities.subtitle }
        />

        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          { dict.capabilities.groups.map((group, idx) => {
            const Icon = ICON_MAP[group.icon] ?? Cpu;
            return (
              <div
                key={ group.name }
                className="group relative rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-7 transition-all hover:border-[var(--wb-border-strong)] hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between border-b border-[var(--wb-border)] pb-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--wb-bg-soft)]">
                      <Icon className="h-4 w-4 text-[var(--wb-fg)]" />
                    </span>
                    <h3 className="font-display-serif text-[18px] leading-tight text-[var(--wb-fg)]">
                      { group.name }
                    </h3>
                  </div>
                  <span className="font-mono text-[11px] text-[var(--wb-fg-faint)]">
                    { String(group.packages.length).padStart(2, '0') }
                  </span>
                </div>

                <ul className="mt-5 space-y-3">
                  { group.packages.map((pkg) => (
                    <li key={ pkg.name } className="flex items-start gap-3">
                      <span className="mt-2 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-[var(--wb-fg-faint)]" />
                      <div className="min-w-0">
                        <code className="font-mono text-[12.5px] font-medium text-[var(--wb-fg)]">
                          { pkg.name }
                        </code>
                        <p className="mt-0.5 text-[13px] leading-snug text-[var(--wb-fg-muted)]">
                          { pkg.description }
                        </p>
                      </div>
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
            className="cta-link text-[var(--wb-fg)]"
          >
            <span>Browse 63 packages on GitHub</span>
            <span className="cta-link-arrow">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}
