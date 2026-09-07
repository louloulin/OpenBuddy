import type { Metadata } from 'next';
import {
  BookOpen,
  Rocket,
  Layers,
  Puzzle,
  GitBranch,
  Building2,
  ArrowRight,
  ExternalLink,
  Github
} from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { getDictionary, type Dict, type Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'OpenBuddy documentation — getting started, architecture, plugin development, deployment, and API references.'
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
  title: 'Documentation',
  subtitle: 'Every doc lives in the repo as Markdown. Edit it, open a PR, ship.',
  primaryAction: 'Browse on GitHub',
  startLabel: 'Start here',
  deepLabel: 'Deep dive',
  enterpriseLabel: 'Enterprise'
};

const COPY_ZH = {
  title: '文档',
  subtitle: '每个文档都以 Markdown 形式存放在仓库中。修改它,提 PR,发布。',
  primaryAction: '在 GitHub 浏览',
  startLabel: '从这里开始',
  deepLabel: '深入阅读',
  enterpriseLabel: '企业级'
};

export function DocsView({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const docs = locale === 'zh-CN' ? DOCS_ZH : DOCS_EN;
  const copy = locale === 'zh-CN' ? COPY_ZH : COPY_EN;

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-radial-glow opacity-40" />
          <div className="mx-auto max-w-7xl px-4 pb-16 pt-12 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 justify-center text-[var(--wb-fg-muted)]">
                <span className="h-px w-6 bg-[var(--wb-fg-muted)]" />
                <span className="font-mono text-[11px] uppercase tracking-[0.16em]">Docs</span>
                <span className="h-px w-6 bg-[var(--wb-fg-muted)]" />
              </div>
              <h1 className="mt-4 font-display text-display-lg text-balance text-[var(--wb-fg)]">
                { copy.title }
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-pretty text-[16px] leading-relaxed text-[var(--wb-fg-muted)]">
                { copy.subtitle }
              </p>
            </div>

            {/* Doc groups */}
            <div className="mx-auto mt-16 max-w-5xl space-y-10">
              { docs.map((group, gIdx) => (
                <div key={ gIdx } className="grid gap-5 md:grid-cols-3">
                  { group.map((doc) => {
                    const Icon = doc.icon;
                    return (
                      <a
                        key={ doc.title }
                        href={ doc.href }
                        target={ doc.external ? '_blank' : undefined }
                        rel={ doc.external ? 'noreferrer' : undefined }
                        className="group relative flex flex-col rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-6 transition-all hover:-translate-y-1 hover:border-[var(--wb-fg-muted)] hover:shadow-wb-card-hover"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand-2 to-brand-4 text-brand-10 transition-transform group-hover:scale-110 dark:text-brand-8">
                            <Icon className="h-5 w-5" />
                          </div>
                          { doc.external ? (
                            <ExternalLink className="h-3.5 w-3.5 text-[var(--wb-fg-muted)] opacity-0 transition-opacity group-hover:opacity-100" />
                          ) : null }
                        </div>
                        <h3 className="mt-4 font-display text-[16px] font-semibold tracking-tight text-[var(--wb-fg)]">
                          { doc.title }
                        </h3>
                        <p className="mt-2 flex-1 text-[13px] leading-snug text-[var(--wb-fg-muted)]">
                          { doc.description }
                        </p>
                        { doc.tag ? (
                          <span className={ `mt-4 inline-flex items-center gap-1 self-start rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            doc.tag === 'start'
                              ? 'bg-brand-2 text-brand-9'
                              : doc.tag === 'enterprise'
                              ? 'bg-amber-2 text-amber-9'
                              : 'bg-accent/10 text-accent'
                          }` }>
                            { doc.tag === 'start' ? copy.startLabel : doc.tag === 'enterprise' ? copy.enterpriseLabel : copy.deepLabel }
                          </span>
                        ) : null }
                      </a>
                    );
                  }) }
                </div>
              )) }
            </div>

            {/* Code example */}
            <div className="mx-auto mt-20 max-w-4xl">
              <h2 className="font-display text-[22px] font-semibold tracking-tight text-[var(--wb-fg)]">
                { locale === 'zh-CN' ? '代码示例' : 'Code example' }
              </h2>
              <p className="mt-2 text-[14px] text-[var(--wb-fg-muted)]">
                { locale === 'zh-CN'
                  ? '这是构建一个 Cordis 插件所需的最少代码 —— 一个 provider + 一个 UI 路由。'
                  : 'Here is the minimum code to ship a Cordis plugin — one provider and one UI route.' }
              </p>
              <div className="mt-6 overflow-hidden rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg-dark)] shadow-2xl">
                <div className="flex items-center gap-1.5 border-b border-white/10 bg-[#161B22] px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                  <span className="ml-3 font-mono text-[11px] text-[#8B949E]">
                    packages/capability/openbuddy-hello/src/index.ts
                  </span>
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-relaxed text-white">
                  <CodeBlock />
                </pre>
              </div>
            </div>

            {/* Big button */}
            <div className="mt-16 text-center">
              <a
                href="https://github.com/louloulin/OpenBuddy/tree/main/docs"
                target="_blank"
                rel="noreferrer"
                className="btn-primary group !px-6 !py-3"
              >
                <Github className="h-4 w-4" />
                <span>{ copy.primaryAction }</span>
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>

            {/* Back link */}
            <div className="mt-12 text-center">
              <Link
                href={ localizedPath('/', locale) }
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
  // 用纯文本 + span 着色，避免引入 shiki
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