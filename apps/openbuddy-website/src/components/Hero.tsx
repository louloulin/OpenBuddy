'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Terminal, Sparkles } from 'lucide-react';
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
            MIT · 64 packages · 1,886 tests
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
            aria-label="Star on GitHub"
          >
            <span aria-hidden="true">★</span>
            <span>Star on GitHub</span>
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
 * HeroVisual —— 真产品截图 + 浮动 agent 卡片
 */
function HeroVisual() {
  return (
    <div className="relative">
      <div className="wb-window shadow-2xl shadow-[var(--wb-fg)]/10">
        <div className="flex items-center gap-2 border-b border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-3 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
          <span className="ml-3 font-mono text-[10.5px] text-[var(--wb-fg-muted)]">
            ~/openbuddy · main workspace
          </span>
        </div>
        <Image
          src="/screenshots/desktop-main.png"
          alt="OpenBuddy desktop workspace"
          width={ 1696 }
          height={ 1080 }
          priority
          className="block w-full h-auto"
        />
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
