'use client';

import Link from 'next/link';
import { ArrowRight, Github, Download, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Dict, Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';

interface HeroProps {
  dict: Dict;
  locale: Locale;
}

/**
 * Hero —— 首页 Hero 区域
 *
 * 设计要点：
 * - 编辑器美学：左侧大字标题，右侧 terminal/代码窗口
 * - 背景：双层 radial gradient + 细网格线（编辑器感）
 * - 终端窗口：实时"打字"动画展示 openbuddy 实际行为
 * - 下方 4 列 metrics 数字 (64 / 455 / MIT / 3)
 */
export default function Hero({ dict, locale }: HeroProps) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Background layers */}
      <div className="absolute inset-0 -z-10 bg-radial-glow" />
      <div className="absolute inset-0 -z-10 bg-editor-grid opacity-50" />
      <div className="absolute inset-x-0 top-0 -z-10 h-[600px] bg-gradient-to-b from-transparent via-transparent to-[var(--wb-bg)]" />

      <div className="mx-auto max-w-7xl px-4 pb-24 pt-20 sm:px-6 lg:px-8 lg:pt-28">
        {/* Top chip */}
        <div className="flex justify-center">
          <a
            href="https://github.com/louloulin/OpenBuddy/releases"
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-2 rounded-full border border-[var(--wb-border)] bg-[var(--wb-bg)]/60 px-3 py-1 text-[12px] font-medium text-[var(--wb-fg-muted)] backdrop-blur transition-colors hover:border-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-8 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-8" />
            </span>
            <span>{ dict.hero.chip }</span>
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>

        {/* Title */}
        <div className="mx-auto mt-8 max-w-4xl text-center">
          <h1 className="font-display text-display-xl text-balance text-[var(--wb-fg)]">
            { dict.hero.titlePre }{ ' ' }
            <span className="text-gradient-brand">{ dict.hero.titleHighlight }</span>
            { ' ' }
            { dict.hero.titlePost }
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-[17px] leading-relaxed text-[var(--wb-fg-muted)] sm:text-[18px]">
            { dict.hero.subtitle }
          </p>
        </div>

        {/* CTAs */}
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-3">
          <Link href={ localizedPath('/download', locale) } className="btn-primary group !px-5 !py-3">
            <Download className="h-4 w-4" />
            <span>{ dict.hero.ctaPrimary }</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link href={ localizedPath('/docs', locale) } className="btn-secondary !px-5 !py-3">
            <Terminal className="h-4 w-4" />
            <span>{ dict.hero.ctaSecondary }</span>
          </Link>
          <a
            href="https://github.com/louloulin/OpenBuddy"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
          >
            <Github className="h-4 w-4" />
            <span>{ dict.hero.ctaGithub }</span>
          </a>
        </div>

        {/* Two-column: terminal demo + metrics */}
        <div className="mx-auto mt-20 grid max-w-6xl gap-6 lg:grid-cols-5">
          {/* Left: Terminal demo */}
          <div className="lg:col-span-3">
            <TerminalDemo />
          </div>
          {/* Right: Stats / Quick info card */}
          <div className="flex flex-col gap-4 lg:col-span-2">
            { dict.hero.metrics.map((m, idx) => (
              <div
                key={ m.label }
                className="group relative overflow-hidden rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-5 transition-all hover:border-[var(--wb-fg-muted)] hover:shadow-wb-card-hover"
                style={ { animationDelay: `${idx * 60}ms` } }
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[28px] font-semibold tabular-nums tracking-tight text-[var(--wb-fg)] sm:text-[34px]">
                    { m.value }
                  </span>
                  <span className="text-[12px] font-medium text-[var(--wb-fg-muted)]">{ m.label }</span>
                </div>
                <div className="absolute -right-2 -top-2 h-16 w-16 rounded-full bg-gradient-to-br from-brand-3 to-brand-8 opacity-0 blur-2xl transition-opacity group-hover:opacity-30" />
              </div>
            )) }
          </div>
        </div>

        {/* Bottom badge */}
        <p className="mt-12 text-center text-[11px] uppercase tracking-[0.18em] text-[var(--wb-fg-muted)]">
          { dict.hero.badge }
        </p>
      </div>
    </section>
  );
}

function TerminalDemo() {
  const lines: Array<{ prompt: string; output: string[] }> = [
    {
      prompt: '$ pnpm install',
      output: [
        '✔ Lockfile is up to date — pnpm 11',
        '✔ Resolved: 32 projects',
        '✔ Done in 4.2s using pnpm v11.24.0'
      ]
    },
    {
      prompt: '$ pnpm electron:dev',
      output: [
        '◆ moon DAG resolved · 32 projects',
        '◆ Vite renderer up on http://localhost:5173',
        '◆ Electron host spawned · IPC allowlist ready',
        '◆ Pi AgentSession online · MiniMax-M3 connected'
      ]
    },
    {
      prompt: '> translate the README to Chinese',
      output: [
        '◆ Deep thinking · 2.8s',
        '  → identifying sections, preserving code blocks…',
        '',
        '✓ Translated 142 paragraphs · 6 code blocks preserved',
        '  Translation: zh-CN/README.md'
      ]
    }
  ];

  const [shownChars, setShownChars] = useState(0);
  const totalChars = lines.reduce((acc, l) => acc + l.prompt.length + l.output.join('\n').length, 0);

  useEffect(() => {
    if (shownChars >= totalChars) {
      const t = setTimeout(() => setShownChars(0), 6000);
      return () => clearTimeout(t);
    }
    const interval = setInterval(() => setShownChars((c) => Math.min(c + 8, totalChars)), 28);
    return () => clearInterval(interval);
  }, [shownChars, totalChars]);

  let consumed = 0;
  const renderLine = (line: { prompt: string; output: string[] }) => {
    const lineChars = line.prompt.length + line.output.join('\n').length;
    const visibleChars = Math.max(0, Math.min(shownChars - consumed, lineChars));
    consumed += lineChars;

    if (visibleChars <= 0) return null;

    return (
      <div key={ line.prompt } className="mb-3 animate-fade-up">
        <div className="flex items-start gap-2">
          <span className="select-none font-mono text-[12px] text-brand-8">❯</span>
          <span className="font-mono text-[13px] text-[var(--wb-fg)]">
            { line.prompt.slice(0, Math.min(visibleChars, line.prompt.length)) }
            { visibleChars < line.prompt.length ? (
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-cursor-blink bg-[var(--wb-fg)] align-middle" />
            ) : null }
          </span>
        </div>
        { line.prompt.length <= visibleChars ? (
          <div className="mt-1 ml-5 space-y-0.5">
            { line.output.map((out, idx) => {
              const usedFromOutput = visibleChars - line.prompt.length;
              const lines = out.split('\n');
              return lines.map((seg, sidx) => {
                const offset = lines.slice(0, sidx).join('\n').length + (sidx > 0 ? 1 : 0);
                const segVisible = Math.max(0, Math.min(usedFromOutput - offset, seg.length));
                if (segVisible <= 0) return null;
                const colorClass = out.startsWith('✔') || out.startsWith('✓')
                  ? 'text-brand-8'
                  : out.startsWith('◆') || out.startsWith('  →')
                  ? 'text-[var(--wb-fg-muted)]'
                  : 'text-[var(--wb-fg)]';
                return (
                  <p
                    key={ `${idx}-${sidx}` }
                    className={ `font-mono text-[12.5px] leading-relaxed ${colorClass}` }
                  >
                    { seg.slice(0, segVisible) }
                  </p>
                );
              });
            }) }
          </div>
        ) : null }
      </div>
    );
  };

  return (
    <div className="wb-window">
      <div className="wb-window-titlebar">
        <span className="wb-dot bg-[#FF5F57]" />
        <span className="wb-dot bg-[#FEBC2E]" />
        <span className="wb-dot bg-[#28C840]" />
        <span className="ml-3 select-none">~/openbuddy — pnpm electron:dev</span>
      </div>
      <div className="min-h-[280px] bg-[var(--wb-bg-soft)] p-5 font-mono">
        { lines.map(renderLine) }
        { shownChars >= totalChars ? (
          <div className="ml-5 mt-2 flex items-center gap-2">
            <span className="select-none text-[12px] text-brand-8">❯</span>
            <span className="inline-block h-3 w-1.5 animate-cursor-blink bg-[var(--wb-fg)]" />
          </div>
        ) : null }
      </div>
      {/* Footer status */}
      <div className="flex items-center justify-between border-t border-[var(--wb-border)] bg-[var(--wb-bg)] px-4 py-2 text-[11px] text-[var(--wb-fg-muted)]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-8" /> ready
          </span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">MiniMax-M3 · streaming</span>
        </div>
        <span className="font-mono">node 22.18.0 · pnpm 11.24</span>
      </div>
    </div>
  );
}