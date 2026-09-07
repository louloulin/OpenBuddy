'use client';

import Link from 'next/link';
import { ArrowRight, Github, Terminal, Sparkles } from 'lucide-react';
import type { Dict, Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';

interface HeroProps {
  dict: Dict;
  locale: Locale;
}

/**
 * Hero —— tutti 风格 (严格对标, 跟随 global theme)
 *
 * 关键变化:
 * - H1 字号 56-76px, letter-spacing -0.035em
 * - 文本链 CTA (不用大按钮)
 * - 真实产品 mockup + 浮动 agent 卡片
 * - Light mode: cream bg + 深色文字
 * - Dark mode: black bg + 白色文字 (因为 body 在 dark 模式下也是黑色)
 */
export default function Hero({ dict, locale }: HeroProps) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* 极淡的网格背景 */}
      <div className="absolute inset-0 -z-10 bg-editor-grid opacity-30" />

      {/* 渐变光晕 (克制) */}
      <div
        className="absolute -top-40 left-1/2 -z-10 h-[500px] w-[800px] -translate-x-1/2 opacity-30"
        style={ {
          background:
            'radial-gradient(ellipse 60% 50% at 50% 0%, var(--wb-accent), transparent 70%)',
          opacity: 0.15
        } }
      />

      <div className="mx-auto max-w-6xl px-4 pb-24 pt-16 sm:px-6 lg:px-8 lg:pt-24">
        {/* 顶部小 chip */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] px-3 py-1 font-mono text-[11.5px] tracking-wider text-[var(--wb-fg)]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
            </span>
            <span>{ dict.hero.chip }</span>
          </span>
          <span className="font-mono text-[11.5px] text-[var(--wb-fg-faint)]">
            MIT · 64 packages · 309 tests
          </span>
        </div>

        {/* 大标题 — tutti 严格对标: 56-76px, weight 500 */}
        <h1 className="mt-12 max-w-4xl font-sans text-display-2xl text-[var(--wb-fg)] text-balance">
          { dict.hero.titlePre }
          <br />
          <span className="italic font-display-serif text-[var(--wb-accent)]">
            { dict.hero.titleHighlight }
          </span>
          { ' ' }
          { dict.hero.titlePost }
        </h1>

        {/* 副标 */}
        <p className="mt-8 max-w-2xl text-body-xl text-[var(--wb-fg-muted)] text-pretty">
          { dict.hero.subtitle }
        </p>

        {/* CTAs — 文本链 + 箭头 (tutti 风格) */}
        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Link
            href={ localizedPath('/download', locale) }
            className="cta-link text-[var(--wb-fg)]"
          >
            <span>{ dict.hero.ctaPrimary }</span>
            <span className="cta-link-arrow">→</span>
          </Link>
          <Link
            href={ localizedPath('/docs', locale) }
            className="cta-link text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
          >
            <span>{ dict.hero.ctaSecondary }</span>
            <span className="cta-link-arrow">→</span>
          </Link>
          <a
            href="https://github.com/louloulin/OpenBuddy"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 font-mono text-[13px] text-[var(--wb-fg-faint)] hover:text-[var(--wb-fg)]"
          >
            <Github className="h-3.5 w-3.5" />
            <span>★ 12.8k</span>
          </a>
        </div>

        {/* Hero 主视觉 */}
        <div className="mt-20">
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}

/**
 * HeroVisual —— 跟随 theme 的产品 mockup
 */
function HeroVisual() {
  return (
    <div className="relative">
      {/* 主应用窗口 */}
      <div className="wb-window shadow-2xl shadow-[var(--wb-fg)]/10">
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-3 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
          <span className="ml-3 font-mono text-[10.5px] text-[var(--wb-fg-muted)]">
            ~/openbuddy · main workspace
          </span>
          <span className="ml-auto flex items-center gap-2 font-mono text-[10.5px] text-[var(--wb-fg-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
            <span>connected · MiniMax-M3</span>
          </span>
        </div>

        <div className="grid grid-cols-[200px_1fr] bg-[var(--wb-bg-pure)]">
          {/* Sidebar */}
          <aside className="border-r border-[var(--wb-border)] bg-[var(--wb-bg-soft)] p-3.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-[#5266E8] to-[#3F4FD8] text-[12px]">
                🐕
              </span>
              <span className="text-[12px] font-semibold text-[var(--wb-fg)]">OpenBuddy</span>
              <span className="ml-auto rounded border border-[var(--wb-border)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--wb-fg-muted)]">
                MIT
              </span>
            </div>

            <button
              type="button"
              className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--wb-accent)]/10 px-2.5 py-1.5 text-[11px] font-medium text-[var(--wb-fg)] hover:bg-[var(--wb-accent)]/20"
            >
              <span>+</span>
              <span>New chat</span>
            </button>

            <div className="mt-5 space-y-0.5">
              { [
                { name: 'Chat', active: true },
                { name: 'Workspace', active: false },
                { name: 'Skills', active: false },
                { name: 'MCP servers', active: false },
                { name: 'Settings', active: false }
              ].map((item) => (
                <div
                  key={ item.name }
                  className={ `flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] ${
                    item.active
                      ? 'bg-[var(--wb-accent)]/15 font-medium text-[var(--wb-fg)]'
                      : 'text-[var(--wb-fg-muted)] hover:bg-[var(--wb-bg)]'
                  }` }
                >
                  <span className="h-1 w-1 rounded-full bg-current opacity-50" />
                  <span>{ item.name }</span>
                </div>
              )) }
            </div>

            <div className="mt-6 border-t border-[var(--wb-border)] pt-4">
              <p className="px-2 font-mono text-[9px] uppercase tracking-wider text-[var(--wb-fg-faint)]">
                Today
              </p>
              <div className="mt-2 space-y-1">
                <div className="rounded-md bg-[var(--wb-bg)] px-2 py-1.5 text-[10.5px] text-[var(--wb-fg)]">
                  Refactor auth.ts
                </div>
                <div className="rounded-md px-2 py-1.5 text-[10.5px] text-[var(--wb-fg-muted)] hover:bg-[var(--wb-bg)]">
                  Translate README
                </div>
                <div className="rounded-md px-2 py-1.5 text-[10.5px] text-[var(--wb-fg-muted)] hover:bg-[var(--wb-bg)]">
                  DB migration review
                </div>
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="flex flex-col">
            <div className="flex-1 space-y-5 p-7">
              <div className="flex justify-end">
                <div className="max-w-[78%] rounded-xl rounded-br-sm bg-[var(--wb-fg)] px-4 py-2.5 text-[12.5px] leading-relaxed text-[var(--wb-bg)]">
                  refactor auth.ts to use async/await + add proper error handling. plan first, then execute.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#5266E8] to-[#3F4FD8] text-[12px]">
                  🐕
                </span>
                <div className="flex-1 rounded-xl rounded-tl-sm border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] px-4 py-3">
                  <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--wb-accent)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--wb-accent)]">
                    <Sparkles className="h-2.5 w-2.5" />
                    Plan mode · reviewing 47 lines
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-[var(--wb-fg)]">
                    Refactored <code className="rounded bg-[var(--wb-bg-soft)] px-1 py-0.5 font-mono text-[11px] text-[var(--wb-working-fg)]">auth.ts</code> · 47 lines changed · added try/catch around JWT validation, switched to async/await, preserved public API.
                  </p>
                  <div className="mt-2.5 flex items-center gap-2 border-t border-[var(--wb-border)] pt-2 text-[10.5px] text-[var(--wb-fg-muted)]">
                    <span className="text-[var(--wb-working)]">✓ completed 4.2s</span>
                    <span>·</span>
                    <span className="hover:text-[var(--wb-fg)] cursor-pointer">copy</span>
                    <span>·</span>
                    <span className="hover:text-[var(--wb-fg)] cursor-pointer">retry</span>
                    <span>·</span>
                    <span className="hover:text-[var(--wb-fg)] cursor-pointer">apply</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-[var(--wb-border)] p-4">
              <div className="rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-3.5">
                <div className="font-mono text-[12.5px] text-[var(--wb-fg-muted)]">
                  ask anything, or @ to invoke a skill…
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-cursor-blink bg-[var(--wb-fg)] align-middle" />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--wb-fg-muted)]">
                    <span className="rounded border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] px-1.5 py-0.5">⌘K</span>
                    <span>Plan mode</span>
                    <span>·</span>
                    <span className="text-[var(--wb-working)]">2 agents running</span>
                  </div>
                  <span className="rounded-md bg-[var(--wb-fg)] px-3 py-1 text-[11px] font-medium text-[var(--wb-bg)]">
                    Send
                  </span>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Floating cards */}
      <FloatingCard
        className="absolute -left-6 top-32 hidden md:block"
        title="Claude Code"
        status="Working"
        accent="#22C55E"
        description="→ 248 tok/s"
      />
      <FloatingCard
        className="absolute -right-4 top-44 hidden md:block"
        title="MCP · github"
        status="Connected"
        accent="#5266E8"
        description="18 tools available"
      />
      <FloatingCard
        className="absolute -left-8 bottom-24 hidden md:block"
        title="Skill · pi-native"
        status="Ready"
        accent="#22C55E"
        description="auto-loaded"
      />
      <FloatingCard
        className="absolute -right-6 bottom-32 hidden md:block"
        title="Provider · MiniMax"
        status="Active"
        accent="#5266E8"
        description="BYOK · health ✓"
      />
    </div>
  );
}

function FloatingCard({
  className,
  title,
  status,
  accent,
  description
}: {
  className: string;
  title: string;
  status: string;
  accent: string;
  description: string;
}) {
  return (
    <div
      className={ `${className} rounded-lg border border-[var(--wb-border-strong)] bg-[var(--wb-bg-pure)]/95 px-3 py-2 shadow-2xl shadow-[var(--wb-fg)]/20 backdrop-blur-md` }
    >
      <div className="flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={ { background: accent } }
        />
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--wb-fg)]">
          { title }
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span
          className="rounded-full px-1.5 py-0.5 font-mono text-[9px]"
          style={ { background: `${accent}25`, color: accent } }
        >
          { status }
        </span>
        <span className="font-mono text-[10px] text-[var(--wb-fg-muted)]">{ description }</span>
      </div>
    </div>
  );
}
