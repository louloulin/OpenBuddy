'use client';

import Link from 'next/link';
import { ArrowRight, Github } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Dict, Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';

interface HeroProps {
  dict: Dict;
  locale: Locale;
}

/**
 * Hero —— 重新设计 (tutti 美学)
 *
 * - 大字 serif 标题 (Instrument Serif) + 紧凑副标
 * - 顶部状态条: "Live · v0.14.0 released" (chips)
 * - 双 CTA: 黑色 filled + ghost outline
 * - 下方 live status panel 模拟工厂控制台
 * - 背景：细腻网格 + 极淡的 state-color glow (克制)
 */
export default function Hero({ dict, locale }: HeroProps) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* 极淡的网格背景 */}
      <div className="absolute inset-0 -z-10 bg-editor-grid opacity-50" />
      <div className="absolute inset-x-0 top-0 -z-10 h-[500px] bg-gradient-to-b from-transparent via-transparent to-[var(--wb-bg)]" />

      <div className="mx-auto max-w-7xl px-4 pb-24 pt-16 sm:px-6 lg:px-8 lg:pt-24">
        {/* 状态条 */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="wb-chip">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--wb-working)] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--wb-working)]" />
            </span>
            <span>{ dict.hero.chip }</span>
          </span>
          <a
            href="https://github.com/louloulin/OpenBuddy/blob/main/CHANGELOG.md"
            target="_blank"
            rel="noreferrer"
            className="wb-chip wb-chip-idle hover:text-[var(--wb-fg)]"
          >
            <span>MIT · 64 packages · 309 tests</span>
          </a>
        </div>

        {/* 大字标题 — Instrument Serif */}
        <div className="mx-auto mt-12 max-w-4xl text-center">
          <h1 className="font-display-serif text-[clamp(2.5rem,7vw,5.5rem)] leading-[0.95] text-[var(--wb-fg)] text-balance">
            { dict.hero.titlePre }
            <br />
            <span className="italic text-[var(--wb-accent)]">
              { dict.hero.titleHighlight }
            </span>
            <br />
            { dict.hero.titlePost }
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-pretty text-[16px] leading-relaxed text-[var(--wb-fg-muted)] sm:text-[17px]">
            { dict.hero.subtitle }
          </p>
        </div>

        {/* CTAs — 黑色 primary + ghost secondary */}
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-3">
          <Link href={ localizedPath('/download', locale) } className="btn-primary group !px-5 !py-3">
            <span>{ dict.hero.ctaPrimary }</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link href={ localizedPath('/docs', locale) } className="btn-secondary !px-5 !py-3">
            <span>{ dict.hero.ctaSecondary }</span>
          </Link>
          <a
            href="https://github.com/louloulin/OpenBuddy"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary !px-4 !py-3"
          >
            <Github className="h-3.5 w-3.5" />
            <span className="font-mono text-[12px] tabular-nums">★ 12.8k</span>
          </a>
        </div>

        {/* Live status panel — 工厂控制台风格 */}
        <div className="mx-auto mt-20 max-w-5xl">
          <StatusPanel />
        </div>

        {/* Bottom note */}
        <p className="mt-12 text-center text-[11px] uppercase tracking-[0.18em] text-[var(--wb-fg-faint)]">
          { dict.hero.badge }
        </p>
      </div>
    </section>
  );
}

/**
 * StatusPanel —— 模拟工厂控制台 live 状态
 *
 * 显示 5 个 agent station 状态：
 * - Working (绿色 pulse) — agent 正在工作
 * - Idle (灰色) — 待命
 * - Warning (琥珀) — 需要关注
 *
 * 灵感来自 tutti 的"factory floor"面板
 */
function StatusPanel() {
  const stations: Array<{
    id: string;
    name: string;
    task: string;
    state: StationState;
    pulse: boolean;
    duration: string;
  }> = [
    { id: 'a-01', name: 'Pi Agent',     task: 'Refactoring auth.ts',     state: 'working',  pulse: true,  duration: '2m 14s' },
    { id: 'a-02', name: 'Plan Mode',    task: 'Reviewing PR #234',        state: 'working',  pulse: true,  duration: '0:42' },
    { id: 'a-03', name: 'Cordis Mesh',  task: '6 plugins loaded',          state: 'idle',     pulse: false, duration: '—' },
    { id: 'a-04', name: 'Casdoor OIDC', task: 'Token refresh',            state: 'working',  pulse: true,  duration: '0:08' },
    { id: 'a-05', name: 'MCP Client',   task: 'NewAPI gateway',          state: 'warning',  pulse: false, duration: 'rate-limited' }
  ];

  return (
    <div className="wb-window">
      <div className="wb-window-titlebar">
        <span className="wb-dot bg-[#FF5F57]" />
        <span className="wb-dot bg-[#FEBC2E]" />
        <span className="wb-dot bg-[#28C840]" />
        <span className="ml-3 select-none">~/openbuddy · factory floor — live</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--wb-working)] opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--wb-working)]" />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--wb-fg-faint)]">live</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-px bg-[var(--wb-border)] sm:grid-cols-2 lg:grid-cols-5">
        { stations.map((s, idx) => (
          <Station key={ s.id } { ...s } index={ idx } />
        )) }
      </div>

      {/* Bottom metrics bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-4 py-2.5 text-[11px] font-mono text-[var(--wb-fg-muted)]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--wb-working)]" />
            <span className="text-[var(--wb-working-fg)]">3 working</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--wb-idle)]" />
            <span>1 idle</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--wb-warning)]" />
            <span className="text-[var(--wb-warning)]">1 warn</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span>↑ 248 tok/s</span>
          <span>·</span>
          <span>p99 1.2s</span>
          <span>·</span>
          <span>runtime 14d 6h</span>
        </div>
      </div>
    </div>
  );
}

type StationState = 'working' | 'idle' | 'warning' | 'blocked';

function Station({
  id,
  name,
  task,
  state,
  pulse,
  duration,
  index
}: {
  id: string;
  name: string;
  task: string;
  state: StationState;
  pulse: boolean;
  duration: string;
  index: number;
}) {
  const stateColor = {
    working: 'var(--wb-working)',
    idle: 'var(--wb-idle)',
    warning: 'var(--wb-warning)',
    blocked: 'var(--wb-blocked)'
  }[state];

  const stateLabel = {
    working: 'Working',
    idle: 'Idle',
    warning: 'Warning',
    blocked: 'Blocked'
  }[state];

  return (
    <div className="bg-[var(--wb-bg-pure)] p-4 transition-colors hover:bg-[var(--wb-bg-soft)]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-[var(--wb-fg-faint)]">{ id }</span>
        <span
          className={ `flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${
            state === 'working' ? 'text-[var(--wb-working-fg)]' :
            state === 'warning' ? 'text-[var(--wb-warning)]' :
            'text-[var(--wb-fg-faint)]'
          }` }
        >
          { pulse ? (
            <span className="relative flex h-1.5 w-1.5">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                style={ { background: stateColor } }
              />
              <span
                className="relative inline-flex h-1.5 w-1.5 rounded-full"
                style={ { background: stateColor } }
              />
            </span>
          ) : (
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={ { background: stateColor } }
            />
          ) }
          { stateLabel }
        </span>
      </div>
      <div className="mt-2 font-display-serif text-[15px] leading-snug text-[var(--wb-fg)]">
        { name }
      </div>
      <div className="mt-1.5 font-mono text-[11px] leading-snug text-[var(--wb-fg-muted)]">
        { task }
      </div>
      <div className="mt-2.5 flex items-center justify-between font-mono text-[10px] text-[var(--wb-fg-faint)]">
        <span>duration</span>
        <span className="tabular-nums text-[var(--wb-fg-muted)]">{ duration }</span>
      </div>
    </div>
  );
}