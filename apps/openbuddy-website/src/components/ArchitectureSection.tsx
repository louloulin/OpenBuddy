import { ArrowDown, Cpu, Layers, MonitorSmartphone } from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SectionHeader } from './FeaturesSection';

interface ArchitectureSectionProps {
  dict: Dict;
}

const LAYER_ICONS = [MonitorSmartphone, Layers, Cpu];
const LAYER_ACCENTS = ['from-brand-3 to-brand-7', 'from-brand-7 to-brand-9', 'from-brand-9 to-brand-10'];

/**
 * ArchitectureSection —— 三层架构图
 *
 * 设计要点：
 * - 三层堆叠 (Renderer / Preload / Electron+Pi)
 * - 每层：图标 + 名称 + 描述 + tech tags
 * - 层间连接线 + 双向箭头，标注数据流
 * - 编辑器美学：等宽字体 tech tags、单色 border、阴影分层
 */
export default function ArchitectureSection({ dict }: ArchitectureSectionProps) {
  return (
    <section id="architecture" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          label={ dict.architecture.sectionLabel }
          title={ dict.architecture.title }
          subtitle={ dict.architecture.subtitle }
        />

        <div className="mx-auto mt-16 max-w-4xl">
          { dict.architecture.layers.map((layer, idx) => {
            const Icon = LAYER_ICONS[idx] ?? Layers;
            const accent = LAYER_ACCENTS[idx] ?? LAYER_ACCENTS[0];
            return (
              <div key={ layer.name } className="relative">
                {/* Connector */}
                { idx < dict.architecture.layers.length - 1 ? (
                  <div className="flex flex-col items-center py-3 text-[var(--wb-fg-muted)]">
                    <ArrowDown className="h-4 w-4 opacity-50" />
                    <span className="mt-1 font-mono text-[10px] uppercase tracking-wider">
                      { idx === 0 ? 'contextBridge · allowlisted IPC' : 'typed Pi session events' }
                    </span>
                    <ArrowDown className="mt-1 h-4 w-4 opacity-50" />
                  </div>
                ) : null }

                {/* Layer card */}
                <div
                  className={ `group relative overflow-hidden rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg)] transition-all hover:border-[var(--wb-fg-muted)] hover:shadow-wb-card-hover` }
                >
                  {/* Top accent bar */}
                  <div className={ `absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent}` } />

                  <div className="grid items-center gap-6 p-6 sm:grid-cols-[auto_1fr] sm:p-8">
                    {/* Icon block */}
                    <div
                      className={ `flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br ${accent} text-white shadow-wb-glow-brand` }
                    >
                      <Icon className="h-6 w-6" />
                    </div>

                    {/* Content */}
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--wb-fg-muted)]">
                          Layer { String(idx + 1).padStart(2, '0') }
                        </span>
                        <span className="h-1 w-1 rounded-full bg-[var(--wb-fg-muted)]" />
                      </div>
                      <h3 className="mt-1 font-display text-[22px] font-semibold tracking-tight text-[var(--wb-fg)]">
                        { layer.name }
                      </h3>
                      <p className="mt-2 text-[14px] leading-relaxed text-[var(--wb-fg-muted)]">
                        { layer.description }
                      </p>

                      {/* Tech tags */}
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        { layer.tech.map((t) => (
                          <span
                            key={ t }
                            className="rounded-md border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-2 py-1 font-mono text-[11px] text-[var(--wb-fg-muted)]"
                          >
                            { t }
                          </span>
                        )) }
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          }) }
        </div>

        {/* Footer caption */}
        <p className="mt-10 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--wb-fg-muted)]">
          The renderer never sees a Node or provider SDK
        </p>
      </div>
    </section>
  );
}