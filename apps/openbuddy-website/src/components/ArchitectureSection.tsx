import { ArrowDown, Cpu, Layers, MonitorSmartphone, ArrowUpRight } from 'lucide-react';
import type { Dict } from '@/lib/i18n';

interface ArchitectureSectionProps {
  dict: Dict;
}

const LAYER_ICONS = [MonitorSmartphone, Layers, Cpu];
const LAYER_ACCENTS = ['#4F46E5', '#22C55E', '#D97706']; // accent, working, warning

/**
 * ArchitectureSection —— tutti 风格重做
 *
 * - 三个 horizontal layer cards (不再垂直堆叠)
 * - 颜色用 state system: indigo=interactive, green=working, amber=warning
 * - 中间用 dashed line + label 表示协议
 * - 整体克制、紧凑、有节奏
 */
export default function ArchitectureSection({ dict }: ArchitectureSectionProps) {
  return (
    <section id="architecture" className="relative section-pad">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="grid items-end gap-8 md:grid-cols-[auto_1fr] md:gap-16">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
              { dict.architecture.sectionLabel }
            </span>
            <span className="font-mono text-[11px] text-[var(--wb-fg-faint)]">02</span>
          </div>
          <h2 className="font-display-serif text-[clamp(2rem,4vw,3rem)] leading-[1.05] text-balance text-[var(--wb-fg)]">
            { dict.architecture.title }
          </h2>
        </div>

        <p className="mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)]">
          { dict.architecture.subtitle }
        </p>

        {/* Three layers — horizontal layout */}
        <div className="mt-20">
          <div className="grid gap-px overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-border)] md:grid-cols-3">
            { dict.architecture.layers.map((layer, idx) => {
              const Icon = LAYER_ICONS[idx] ?? Layers;
              const accent = LAYER_ACCENTS[idx] ?? LAYER_ACCENTS[0];
              return (
                <div
                  key={ layer.name }
                  className="group relative flex flex-col gap-5 bg-[var(--wb-bg-pure)] p-7 transition-colors hover:bg-[var(--wb-bg-soft)]"
                >
                  {/* Top: layer number + accent dot */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={ { background: accent } }
                      />
                      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--wb-fg-faint)]">
                        Layer { String(idx + 1).padStart(2, '0') }
                      </span>
                    </div>
                    <Icon className="h-4 w-4 text-[var(--wb-fg-faint)]" />
                  </div>

                  {/* Title */}
                  <h3 className="font-display-serif text-[24px] leading-tight text-[var(--wb-fg)]">
                    { layer.name }
                  </h3>

                  {/* Description */}
                  <p className="text-[13.5px] leading-relaxed text-[var(--wb-fg-muted)]">
                    { layer.description }
                  </p>

                  {/* Tech tags */}
                  <div className="mt-auto flex flex-wrap gap-1.5">
                    { layer.tech.map((t) => (
                      <span
                        key={ t }
                        className="rounded border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--wb-fg-muted)]"
                      >
                        { t }
                      </span>
                    )) }
                  </div>

                  {/* Hover arrow */}
                  <ArrowUpRight className="absolute right-4 top-4 h-3.5 w-3.5 text-[var(--wb-fg-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              );
            }) }
          </div>

          {/* Data flow lines between layers */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-0">
            <FlowIndicator
              from={ 0 }
              to={ 1 }
              label={ 'contextBridge · allowlisted IPC' }
              tone="indigo"
            />
            <FlowIndicator
              from={ 1 }
              to={ 2 }
              label={ 'typed pi://* events' }
              tone="green"
            />
          </div>
        </div>

        {/* Footer caption */}
        <p className="mt-12 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--wb-fg-faint)]">
          The renderer never sees a Node or provider SDK.
        </p>
      </div>
    </section>
  );
}

function FlowIndicator({
  from,
  to,
  label,
  tone
}: {
  from: number;
  to: number;
  label: string;
  tone: 'indigo' | 'green' | 'amber';
}) {
  const color = tone === 'green' ? 'var(--wb-working)' : tone === 'amber' ? 'var(--wb-warning)' : 'var(--wb-accent)';
  return (
    <div className="flex flex-1 items-center gap-2 px-3">
      <span className="font-mono text-[10px] text-[var(--wb-fg-faint)]">L{ String(from + 1).padStart(2, '0') }</span>
      <div className="relative h-px flex-1 overflow-hidden bg-[var(--wb-border)]">
        <div
          className="absolute inset-y-0 left-0 w-1/2"
          style={ { background: `repeating-linear-gradient(to right, ${color} 0 4px, transparent 4px 8px)` } }
        />
      </div>
      <ArrowDown className="h-3 w-3 -rotate-90" style={ { color } } />
      <span className="font-mono text-[10px] text-[var(--wb-fg-faint)]">L{ String(to + 1).padStart(2, '0') }</span>
      <span className="ml-2 font-mono text-[10.5px] text-[var(--wb-fg-muted)]">{ label }</span>
    </div>
  );
}