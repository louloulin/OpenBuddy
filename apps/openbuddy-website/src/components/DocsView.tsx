import type { Metadata } from 'next';
import {
  Rocket,
  BookOpen,
  Layers,
  Puzzle,
  GitBranch,
  Building2,
  ArrowRight,
  Github,
  ExternalLink
} from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import SharedHeader from '@/components/SharedHeader';
import { getDictionary, type Locale } from '@/lib/i18n';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'OpenBuddy documentation — getting started, architecture, plugin development, deployment, and API references.'
};

interface DocLink {
  icon: typeof Rocket;
  title: string;
  description: string;
  href: string;
  external: boolean;
  tag?: 'start' | 'deep' | 'enterprise';
}

const DOCS_EN: DocLink[][] = [
  [
    {
      icon: Rocket,
      title: 'Getting started',
      description: '30-minute developer setup, prerequisites, and your first OpenBuddy run.',
      href: 'https://github.com/louloulin/OpenBuddy/blob/main/docs/GETTING_STARTED.md',
      external: true,
      tag: 'start'
    },
    {
      icon: BookOpen,
      title: 'Full docs index',
      description: 'All documentation as Markdown — architecture, plugins, operations, releases.',
      href: 'https://github.com/louloulin/OpenBuddy/tree/main/docs',
      external: true
    },
    {
      icon: Layers,
      title: 'Architecture',
      description: 'Three-layer Electron host, Cordis capability mesh, typed IPC bridge.',
      href: 'https://github.com/louloulin/OpenBuddy/blob/main/docs/ARCHITECTURE.md',
      external: true,
      tag: 'deep'
    }
  ],
  [
    {
      icon: Puzzle,
      title: 'Plugin development',
      description: 'Build your first Cordis capability — from scaffolding to registry.',
      href: 'https://github.com/louloulin/OpenBuddy/blob/main/docs/PLUGIN_DEVELOPMENT.md',
      external: true
    },
    {
      icon: GitBranch,
      title: 'Roadmap & changelog',
      description: 'Public roadmap, release notes, and what shipped each week.',
      href: 'https://github.com/louloulin/OpenBuddy/blob/main/TODO.md',
      external: true
    },
    {
      icon: Building2,
      title: 'Enterprise & deployment',
      description: 'Casdoor OIDC, NewAPI gateway, payment adapters, SCIM, SAML.',
      href: 'https://github.com/louloulin/OpenBuddy/blob/main/docs/OPERATIONS.md',
      external: true,
      tag: 'enterprise'
    }
  ]
];

const DOCS_ZH: DocLink[][] = [
  [
    {
      icon: Rocket,
      title: '快速开始',
      description: '30 分钟开发者环境搭建、前置依赖与首次运行。',
      href: 'https://github.com/louloulin/OpenBuddy/blob/main/docs/GETTING_STARTED.zh-CN.md',
      external: true,
      tag: 'start'
    },
    {
      icon: BookOpen,
      title: '完整文档索引',
      description: '所有文档(Markdown) —— 架构、插件、运维、发布。',
      href: 'https://github.com/louloulin/OpenBuddy/tree/main/docs',
      external: true
    },
    {
      icon: Layers,
      title: '架构',
      description: '三层 Electron 宿主、Cordis 能力网格、类型化 IPC 桥。',
      href: 'https://github.com/louloulin/OpenBuddy/blob/main/docs/ARCHITECTURE.zh-CN.md',
      external: true,
      tag: 'deep'
    }
  ],
  [
    {
      icon: Puzzle,
      title: '插件开发',
      description: '构建你的第一个 Cordis 能力 —— 从脚手架到注册中心。',
      href: 'https://github.com/louloulin/OpenBuddy/blob/main/docs/PLUGIN_DEVELOPMENT.md',
      external: true
    },
    {
      icon: GitBranch,
      title: '路线图与更新日志',
      description: '公开路线图、发布说明与每周交付。',
      href: 'https://github.com/louloulin/OpenBuddy/blob/main/TODO.zh-CN.md',
      external: true
    },
    {
      icon: Building2,
      title: '企业与部署',
      description: 'Casdoor OIDC、NewAPI 网关、支付适配器、SCIM、SAML。',
      href: 'https://github.com/louloulin/OpenBuddy/blob/main/docs/OPERATIONS.md',
      external: true,
      tag: 'enterprise'
    }
  ]
];

const COPY_EN = {
  primaryAction: 'Browse on GitHub'
};

const COPY_ZH = {
  primaryAction: '在 GitHub 浏览'
};

export function DocsView({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const docs = locale === 'zh-CN' ? DOCS_ZH : DOCS_EN;
  const copy = locale === 'zh-CN' ? COPY_ZH : COPY_EN;

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative section-pad">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <SharedHeader
              label="Docs"
              number="01"
              title="Documentation"
              subtitle="Every doc lives in the repo as Markdown. Edit it, open a PR, ship."
            />

            <div className="grid gap-px overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-border)] md:grid-cols-2 lg:grid-cols-3">
              { docs.flat().map((doc, idx) => {
                const Icon = doc.icon;
                const tagColor = doc.tag === 'start' ? 'var(--wb-working)' : doc.tag === 'enterprise' ? 'var(--wb-warning)' : 'var(--wb-accent)';
                return (
                  <a
                    key={ doc.title }
                    href={ doc.href }
                    target="_blank"
                    rel="noreferrer"
                    className="group flex flex-col gap-4 bg-[var(--wb-bg-pure)] p-5 transition-colors hover:bg-[var(--wb-bg-soft)]"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-[var(--wb-fg-faint)]">
                          { String(idx + 1).padStart(2, '0') }
                        </span>
                        <Icon className="h-4 w-4 text-[var(--wb-fg-faint)] transition-colors group-hover:text-[var(--wb-fg)]" />
                      </div>
                      { doc.tag ? (
                        <span
                          className="rounded-full border border-[var(--wb-border)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
                          style={ { background: 'transparent', color: tagColor, borderColor: tagColor } }
                        >
                          { doc.tag }
                        </span>
                      ) : null }
                    </div>
                    <h3 className="font-display-serif text-[18px] leading-snug text-[var(--wb-fg)]">
                      { doc.title }
                    </h3>
                    <p className="flex-1 text-[12.5px] leading-snug text-[var(--wb-fg-muted)]">
                      { doc.description }
                    </p>
                    <div className="mt-auto flex items-center justify-end">
                      <ExternalLink className="h-3.5 w-3.5 text-[var(--wb-fg-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                  </a>
                );
              }) }
            </div>

            {/* Code example */}
            <div className="mt-20">
              <h2 className="font-display-serif text-[24px] leading-tight text-[var(--wb-fg)]">
                { locale === 'zh-CN' ? '代码示例' : 'Code example' }
              </h2>
              <p className="mt-3 text-[14px] text-[var(--wb-fg-muted)]">
                { locale === 'zh-CN'
                  ? '这是构建一个 Cordis 插件所需的最少代码 —— 一个 provider + 一个 UI 路由。'
                  : 'Here is the minimum code to ship a Cordis plugin — one provider and one UI route.' }
              </p>
              <div className="mt-6 overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[#0A0F1E] shadow-2xl">
                <div className="flex items-center gap-1.5 border-b border-white/10 bg-[#111827] px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                  <span className="ml-3 font-mono text-[11px] text-white/40">
                    packages/capability/openbuddy-hello/src/index.ts
                  </span>
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-relaxed text-white">
                  <CodeBlock />
                </pre>
              </div>
            </div>

            <div className="mt-16 text-center">
              <a
                href="https://github.com/louloulin/OpenBuddy/tree/main/docs"
                target="_blank"
                rel="noreferrer"
                className="btn-primary group !px-5 !py-3"
              >
                <Github className="h-4 w-4" />
                <span>{ copy.primaryAction }</span>
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>

            <div className="mt-10 text-center">
              <Link
                href={ locale === 'zh-CN' ? '/zh-CN' : '/' }
                className="inline-flex items-center gap-2 text-[13px] text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
              >
                ← { locale === 'zh-CN' ? '返回首页' : 'Back to home' }
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter dict={ dict } />
    </>
  );
}

function CodeBlock() {
  return (
    <>
      <div>
        <span style={ { color: '#8B949E' } }>{ '// @openbuddy/capability-hello — the smallest possible Cordis plugin' }</span>
      </div>
      <div className="mt-2">
        <span style={ { color: '#FF7B72' } }>import</span>
        <span style={ { color: '#E6EDF3' } }>{ ' { Context } ' }</span>
        <span style={ { color: '#FF7B72' } }>from</span>
        <span style={ { color: '#A5D6FF' } }>{ ' "@cordisjs/core"' }</span>
        <span style={ { color: '#E6EDF3' } }>;</span>
      </div>
      <div className="mt-3">
        <span style={ { color: '#FF7B72' } }>export</span>
        <span style={ { color: '#FF7B72' } }> interface </span>
        <span style={ { color: '#79C0FF' } }>HelloConfig</span>
        <span style={ { color: '#E6EDF3' } }>{ ' {' }</span>
      </div>
      <div>
        <span style={ { color: '#E6EDF3' } }>{ '  ' }</span>
        <span style={ { color: '#79C0FF' } }>greeting</span>
        <span style={ { color: '#E6EDF3' } }>{ ': ' }</span>
        <span style={ { color: '#FFA657' } }>string</span>
        <span style={ { color: '#E6EDF3' } }>;</span>
      </div>
      <div>
        <span style={ { color: '#E6EDF3' } }>{ '}' }</span>
      </div>
      <div className="mt-3">
        <span style={ { color: '#FF7B72' } }>export</span>
        <span style={ { color: '#FF7B72' } }> function </span>
        <span style={ { color: '#D2A8FF' } }>HelloPlugin</span>
        <span style={ { color: '#E6EDF3' } }>{ '(ctx: Context, config: HelloConfig) {' }</span>
      </div>
      <div>
        <span style={ { color: '#E6EDF3' } }>{ '  ' }</span>
        <span style={ { color: '#FF7B72' } }>const</span>
        <span style={ { color: '#E6EDF3' } }>{ ' ' }</span>
        <span style={ { color: '#79C0FF' } }>greet</span>
        <span style={ { color: '#E6EDF3' } }>{ ' = (name: ' }</span>
        <span style={ { color: '#FFA657' } }>string</span>
        <span style={ { color: '#E6EDF3' } }>{ ') => ' }</span>
        <span style={ { color: '#A5D6FF' } }>{ '`' }</span>
        <span style={ { color: '#A5D6FF' } }>{ '$' }</span>
        <span style={ { color: '#E6EDF3' } }>{ '{config.greeting}' }</span>
        <span style={ { color: '#A5D6FF' } }>{ ', $' }</span>
        <span style={ { color: '#E6EDF3' } }>{ '{name}!' }</span>
        <span style={ { color: '#A5D6FF' } }>{ '`' }</span>
        <span style={ { color: '#E6EDF3' } }>;</span>
      </div>
      <div>
        <span style={ { color: '#E6EDF3' } }>{ '  ' }</span>
        <span style={ { color: '#FF7B72' } }>return</span>
        <span style={ { color: '#E6EDF3' } }>{ ' { greet };' }</span>
      </div>
      <div>
        <span style={ { color: '#E6EDF3' } }>{ '}' }</span>
      </div>
      <div className="mt-3">
        <span style={ { color: '#8B949E' } }>{ '// register in openbuddy-core-plugin.ts → done.' }</span>
      </div>
    </>
  );
}