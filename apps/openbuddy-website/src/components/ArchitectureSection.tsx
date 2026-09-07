import { Layers, Cpu, MonitorSmartphone } from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SharedHeader } from './SharedHeader';

interface ArchitectureSectionProps {
  dict: Dict;
}

const LAYER_ICONS = [MonitorSmartphone, Layers, Cpu];

/**
 * ArchitectureSection —— tutti 严格对标 (跟随 global theme)
 */
export default function ArchitectureSection({ dict }: ArchitectureSectionProps) {
  return (
    <section id="architecture" className="relative section-pad">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SharedHeader
          number="05"
          label="Internals"
          title={ dict.architecture.title }
          subtitle={ dict.architecture.subtitle }
        />

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          { dict.architecture.layers.map((layer, idx) => {
            const Icon = LAYER_ICONS[idx] ?? Layers;
            return (
              <div
                key={ layer.name }
                className="group relative rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-7 transition-colors hover:border-[var(--wb-border-strong)]"
              >
                <div className="flex items-center justify-between border-b border-[var(--wb-border)] pb-4">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--wb-fg-faint)]">
                      L{ String(idx + 1).padStart(2, '0') }
                    </span>
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--wb-bg-soft)]">
                      <Icon className="h-4 w-4 text-[var(--wb-fg)]" />
                    </span>
                  </div>
                </div>

                <h3 className="mt-5 font-display-serif text-[24px] leading-tight text-[var(--wb-fg)]">
                  { layer.name }
                </h3>

                <p className="mt-3 text-[14px] leading-relaxed text-[var(--wb-fg-muted)]">
                  { layer.description }
                </p>

                <div className="mt-5 flex flex-wrap gap-1.5">
                  { layer.tech.map((t) => (
                    <span
                      key={ t }
                      className="rounded border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--wb-fg)]"
                    >
                      { t }
                    </span>
                  )) }
                </div>
              </div>
            );
          }) }
        </div>

        <p className="mt-16 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--wb-fg-faint)]">
          The renderer never sees a Node or provider SDK.
        </p>
      </div>
    </section>
  );
}
