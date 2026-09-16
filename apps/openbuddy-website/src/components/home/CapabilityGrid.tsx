import type { Locale } from '@/lib/i18n';
import { SITE_LICENSE, SITE_STATS } from '@/lib/constants';
import Reveal from '@/components/motion/Reveal';
import SpotlightCard from '@/components/motion/SpotlightCard';

interface CapabilityGridProps {
  locale: Locale;
}

interface Capability {
  title: { en: string; zh: string };
  pitch: { en: string; zh: string };
  bullets: { en: string[]; zh: string[] };
}

const CAPABILITIES: Capability[] = [
  {
    title: { en: 'Local-first', zh: '本地优先' },
    pitch: {
      en: 'Your conversations, prompts, and skills live on your machine.',
      zh: '对话、提示词、技能都留在本机。'
    },
    bullets: {
      en: [
        'SQLite workspace at ~/.openbuddy/workspace.db',
        'No telemetry by default; opt-in spans only',
        'Offline-capable once providers are configured'
      ],
      zh: [
        'SQLite 工作区位于 ~/.openbuddy/workspace.db',
        '默认无遥测;仅在显式开启后才上报 trace',
        'Provider 配置完成后可完全离线运行'
      ]
    }
  },
  {
    title: { en: 'Multi-provider', zh: '多 Provider' },
    pitch: {
      en: 'OpenAI, Anthropic, Google, Bedrock, OpenRouter, Ollama — same surface.',
      zh: 'OpenAI / Anthropic / Google / Bedrock / OpenRouter / Ollama,同一接口。'
    },
    bullets: {
      en: [
        '@openbuddy/provider-* adapters, swappable at runtime',
        'Casdoor / Workbuddy-ID OIDC, BYO API keys',
        'NewAPI gateway compatible'
      ],
      zh: [
        '@openbuddy/provider-* 适配器,运行时热切换',
        'Casdoor / Workbuddy-ID OIDC,自带 API key',
        '兼容 NewAPI 网关'
      ]
    }
  },
  {
    title: { en: 'Plugin mesh', zh: '插件网格' },
    pitch: {
      en: 'Six layers — bundle, pi, renderer, cordis. Each surface is open.',
      zh: '六层架构 —— bundle / pi / renderer / cordis,每一层都可扩展。'
    },
    bullets: {
      en: [
        '@openbuddy/extension-mcp — Model Context Protocol',
        '@openbuddy/extension-skills — reusable capability skills',
        'Cordis service registry for dependency injection'
      ],
      zh: [
        '@openbuddy/extension-mcp —— Model Context Protocol',
        '@openbuddy/extension-skills —— 可复用技能',
        'Cordis 服务注册中心,做依赖注入'
      ]
    }
  },
  {
    title: { en: 'Open source', zh: '开源' },
    pitch: {
      en: 'MIT. No phone-home. No premium tier. Read the code.',
      zh: 'MIT。没有遥测上报,没有高级订阅,直接读源码。'
    },
    bullets: {
      en: [
        'PGP-signed releases, public verification log',
        `${SITE_LICENSE} · ${SITE_STATS.packages} packages · ${SITE_STATS.testFiles} test files`,
        'Public roadmap, RFC process, monthly release notes'
      ],
      zh: [
        'PGP 签名发布,公开校验日志',
        `${SITE_LICENSE} · ${SITE_STATS.packages} 个包 · ${SITE_STATS.testFiles} 个测试文件`,
        '公开路线图、RFC 流程、每月发版说明'
      ]
    }
  }
];

export default function CapabilityGrid({ locale }: CapabilityGridProps) {
  const isZh = locale === 'zh-CN';
  return (
    <section className="relative border-y border-[var(--wb-border)] bg-[var(--wb-bg-soft)] py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-12 max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
            { isZh ? '能力' : 'Capabilities' }
          </p>
          <h2 className="mt-3 font-display-serif text-[clamp(32px,4.5vw,56px)] font-normal leading-[1.05] tracking-[-0.025em] text-[var(--wb-fg)]">
            { isZh
              ? '四件事做得扎实,其余全部可替换。'
              : 'Four things done well. Everything else is replaceable.' }
          </h2>
        </Reveal>

        <div className="grid gap-px overflow-hidden rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-border)] sm:grid-cols-2">
          { CAPABILITIES.map((c, i) => (
            <SpotlightCard
              key={ c.title.en }
              as="article"
              className="bg-[var(--wb-bg-pure)] p-8 md:p-10"
            >
              <Reveal delay={ i * 90 }>
                <h3 className="font-display-serif text-[26px] leading-[1.15] tracking-[-0.02em] text-[var(--wb-fg)]">
                  { c.title[isZh ? 'zh' : 'en'] }
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--wb-fg-muted)]">
                  { c.pitch[isZh ? 'zh' : 'en'] }
                </p>
                <ul className="mt-6 space-y-2.5">
                  { c.bullets[isZh ? 'zh' : 'en'].map((b) => (
                    <li key={ b } className="flex gap-3 text-[13.5px] leading-snug text-[var(--wb-fg)]">
                      <span className="mt-2 h-1 w-1 flex-none rounded-full bg-[var(--wb-brand)]" />
                      <span className="font-mono text-[12.5px]">{ b }</span>
                    </li>
                  )) }
                </ul>
              </Reveal>
            </SpotlightCard>
          )) }
        </div>
      </div>
    </section>
  );
}