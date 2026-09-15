import type { Locale } from '@/lib/i18n';

interface ArchitectureProps {
  locale: Locale;
}

interface Layer {
  name: string;
  nameZh: string;
  description: { en: string; zh: string };
  tech: string[];
  color: 'brand' | 'accent' | 'muted';
}

const LAYERS: Layer[] = [
  {
    name: 'Electron host',
    nameZh: 'Electron 主进程',
    color: 'muted',
    description: {
      en: 'Process boundary, native window, IPC bridge. Owns the filesystem and OS-level capabilities.',
      zh: '进程边界、原生窗口、IPC 桥。掌握文件系统与操作系统级能力。'
    },
    tech: ['electron 33', 'contextBridge', 'app.getPath("userData")', 'node-pty']
  },
  {
    name: 'Cordis mesh',
    nameZh: 'Cordis 服务网格',
    color: 'brand',
    description: {
      en: 'Service registry. Capabilities register, resolve, and depend. Swappable without touching the host.',
      zh: '服务注册中心。能力注册、解析、互相依赖。在不动主进程的前提下热替换。'
    },
    tech: ['@openbuddy/plugin-host', 'cordis 4', 'service-mesh', 'capability-contracts']
  },
  {
    name: 'React renderer',
    nameZh: 'React 渲染层',
    color: 'accent',
    description: {
      en: 'Chat UI, capability panels, settings. Talks to the host only through the IPC bridge.',
      zh: '对话 UI、能力面板、设置页。只通过 IPC 桥与主进程通讯。'
    },
    tech: ['React 18', 'next 14', 'zustand', 'react-virtuoso']
  }
];

export default function Architecture({ locale }: ArchitectureProps) {
  const isZh = locale === 'zh-CN';
  return (
    <section className="relative py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
            { isZh ? '架构' : 'Architecture' }
          </p>
          <h2 className="mt-3 font-display-serif text-[clamp(32px,4.5vw,56px)] font-normal leading-[1.05] tracking-[-0.025em] text-[var(--wb-fg)]">
            { isZh
              ? '三层结构:进程边界、能力网格、UI 渲染。'
              : 'Three layers: process boundary, capability mesh, UI render.' }
          </h2>
        </div>

        <ol className="grid gap-5 md:grid-cols-3">
          { LAYERS.map((layer, idx) => (
            <li
              key={ layer.name }
              className="wb-card group flex flex-col gap-4"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
                  layer { idx + 1 }
                </span>
                <span
                  aria-hidden
                  className={ `h-2 w-2 rounded-full ${
                    layer.color === 'brand'
                      ? 'bg-[var(--wb-brand)]'
                      : layer.color === 'accent'
                        ? 'bg-[var(--wb-accent)]'
                        : 'bg-[var(--wb-fg-faint)]'
                  }` }
                />
              </div>
              <h3 className="font-display-serif text-[22px] leading-[1.2] tracking-[-0.02em] text-[var(--wb-fg)]">
                { isZh ? layer.nameZh : layer.name }
              </h3>
              <p className="text-[14px] leading-relaxed text-[var(--wb-fg-muted)]">
                { layer.description[isZh ? 'zh' : 'en'] }
              </p>
              <ul className="mt-auto flex flex-wrap gap-1.5 border-t border-[var(--wb-border)] pt-4">
                { layer.tech.map((t) => (
                  <li
                    key={ t }
                    className="rounded-md border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-2 py-1 font-mono text-[11px] text-[var(--wb-fg-muted)]"
                  >
                    { t }
                  </li>
                )) }
              </ul>
            </li>
          )) }
        </ol>
      </div>
    </section>
  );
}