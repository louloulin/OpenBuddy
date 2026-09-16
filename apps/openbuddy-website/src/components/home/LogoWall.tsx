import type { Locale } from '@/lib/i18n';
import Marquee from '@/components/motion/Marquee';

interface LogoWallProps {
  locale: Locale;
}

/**
 * LogoWall —— "我们集成 / 我们依赖" 的可信徽章墙。
 * 字体采用 monospace + 边框胶囊,统一节奏;不画真图标,只写字 + 形状 token,
 * 保证零依赖、零图片资源、零性能税。
 * 窄屏与 reduced-motion 下退回静态换行排列(见 Marquee)。
 */
const LOGOS: Array<{ name: string; group: 'integration' | 'core' }> = [
  { name: 'Casdoor', group: 'integration' },
  { name: 'NewAPI', group: 'integration' },
  { name: 'Anthropic', group: 'integration' },
  { name: 'OpenAI', group: 'integration' },
  { name: 'MCP', group: 'integration' },
  { name: 'OIDC', group: 'integration' },
  { name: 'Cordis', group: 'core' },
  { name: 'Pi Agent', group: 'core' },
  { name: 'Electron', group: 'core' },
  { name: 'React 18', group: 'core' },
  { name: 'Vitest', group: 'core' },
  { name: 'Playwright', group: 'core' }
];

export default function LogoWall({ locale }: LogoWallProps) {
  const isZh = locale === 'zh-CN';
  const groupLabel = isZh ? '集成与依赖' : 'Integrations & core';

  return (
    <section className="relative border-y border-[var(--wb-border)] bg-[var(--wb-bg-soft)] py-10 md:py-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
          <span className="h-px flex-1 bg-[var(--wb-border)]" />
          <span>{ groupLabel }</span>
          <span className="h-px flex-1 bg-[var(--wb-border)]" />
        </div>

        <Marquee>
          { LOGOS.map((l) => (
            <li
              key={ l.name }
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] px-3 py-1.5 font-mono text-[12px] text-[var(--wb-fg-muted)] transition-colors hover:border-[var(--wb-brand)] hover:text-[var(--wb-fg)]"
            >
              <span
                aria-hidden
                className={ `h-1.5 w-1.5 rounded-full ${
                  l.group === 'integration' ? 'bg-[var(--wb-brand)]' : 'bg-[var(--wb-fg-faint)]'
                }` }
              />
              { l.name }
            </li>
          )) }
        </Marquee>
      </div>
    </section>
  );
}
