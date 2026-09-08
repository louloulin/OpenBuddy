'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon, ArrowUpRight } from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SharedHeader } from './SharedHeader';

interface ShowcaseSectionProps {
  dict: Dict;
}

/**
 * ShowcaseSection —— 产品截图展示 (tutti 严格对标)
 *
 * - tab strip 简化
 * - mock 窗口加大
 * - 左右布局: 截图 (大) + 描述 (侧)
 */
export default function ShowcaseSection({ dict }: ShowcaseSectionProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const tabs = dict.showcase.tabs;

  const goPrev = () => setActiveIdx((i) => (i - 1 + tabs.length) % tabs.length);
  const goNext = () => setActiveIdx((i) => (i + 1) % tabs.length);

  return (
    <section id="showcase" data-section-theme="light" className="relative section-pad bg-[var(--wb-bg)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SharedHeader
          number="01"
          label="Preview"
          title={ dict.showcase.title }
          subtitle={ dict.showcase.subtitle }
        />

        {/* Tab strip */}
        <div className="mt-12 flex flex-wrap items-center gap-2">
          { tabs.map((tab, idx) => (
            <button
              key={ tab.id }
              type="button"
              onClick={ () => setActiveIdx(idx) }
              className={ `rounded-full border px-4 py-1.5 text-[13px] transition-colors ${
                idx === activeIdx
                  ? 'border-[var(--wb-fg)] bg-[var(--wb-fg)] text-[var(--wb-bg)]'
                  : 'border-[var(--wb-border)] bg-transparent text-[var(--wb-fg-muted)] hover:border-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]'
              }` }
            >
              { tab.label }
            </button>
          )) }
        </div>

        {/* Showcase window */}
        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="wb-window">
              <div className="wb-window-titlebar">
                <span className="wb-dot bg-[#FF5F57]" />
                <span className="wb-dot bg-[#FEBC2E]" />
                <span className="wb-dot bg-[#28C840]" />
                <span className="ml-3 select-none">OpenBuddy — { tabs[activeIdx].id }</span>
                <span className="ml-auto font-mono text-[10px] opacity-50">
                  { String(activeIdx + 1).padStart(2, '0') }/{ String(tabs.length).padStart(2, '0') }
                </span>
              </div>

              <ShowcaseMock tabId={ tabs[activeIdx].id } />
            </div>

            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={ goPrev }
                className="font-mono text-[12px] text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
                aria-label="Previous"
              >
                ← prev
              </button>
              <div className="flex items-center gap-2">
                { tabs.map((_, idx) => (
                  <button
                    key={ idx }
                    type="button"
                    aria-label={ `Go to screenshot ${idx + 1}` }
                    onClick={ () => setActiveIdx(idx) }
                    className={ `h-1.5 transition-all ${
                      idx === activeIdx ? 'w-8 bg-[var(--wb-fg)]' : 'w-1.5 bg-[var(--wb-border)]'
                    } rounded-full` }
                  />
                )) }
              </div>
              <button
                type="button"
                onClick={ goNext }
                className="font-mono text-[12px] text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
                aria-label="Next"
              >
                next →
              </button>
            </div>
          </div>

          {/* Description */}
          <div className="lg:sticky lg:top-24">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
              Tab { String(activeIdx + 1).padStart(2, '0') }
            </p>
            <h3 className="mt-3 font-display-serif text-[28px] leading-tight text-[var(--wb-fg)]">
              { tabs[activeIdx].label }
            </h3>
            <p className="mt-4 text-[15px] leading-relaxed text-[var(--wb-fg-muted)]">
              { tabs[activeIdx].description }
            </p>
            <div className="mt-8 border-t border-[var(--wb-border)] pt-5">
              <p className="text-[13px] text-[var(--wb-fg-muted)]">
                All screenshots captured against the real MiniMax-M3 model in a built Electron app.
              </p>
              <a
                href="https://github.com/louloulin/OpenBuddy/tree/main/docs/screenshots"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-[13px] text-[var(--wb-fg)] hover:underline"
              >
                View all on GitHub
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ShowcaseMock({ tabId }: { tabId: string }) {
  const presets: Record<string, { status: 'idle' | 'streaming' | 'settled'; prompt?: string; reply?: string }> = {
    'cold-start': { status: 'idle', prompt: 'No API key configured. Open Settings → Providers to add one.' },
    'composer-ready': { status: 'idle', prompt: 'Try: "Refactor this function to use async/await"' },
    'streaming': { status: 'streaming', prompt: 'Tell me about yourself', reply: 'I am Pi, an AI coding assistant running inside OpenBuddy. I can read…' },
    'multi-turn': { status: 'settled', prompt: 'Translate "Hello world" to Chinese', reply: '你好,世界' }
  };

  const preset = presets[tabId] ?? presets['cold-start'];

  return (
    <div className="grid grid-cols-[200px_1fr] bg-[var(--wb-bg-soft)] min-h-[420px]">
      <aside className="border-r border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-[#5266E8] to-[#3F4FD8] text-[12px]">
            🐕
          </span>
          <span className="text-[12px] font-semibold">OpenBuddy</span>
        </div>
        <div className="mt-4 space-y-1">
          { ['New chat', 'Workspace', 'Skills', 'MCP'].map((item) => (
            <div
              key={ item }
              className={ `rounded-md px-2.5 py-1.5 text-[11px] ${
                item === 'New chat' ? 'bg-[var(--wb-bg-soft)] font-medium' : 'text-[var(--wb-fg-muted)]'
              }` }
            >
              { item }
            </div>
          )) }
        </div>
      </aside>

      <main className="p-6">
        { preset.status === 'idle' && !preset.reply ? (
          <div className="flex h-80 flex-col items-center justify-center text-center">
            <ImageIcon className="h-6 w-6 text-[var(--wb-fg-faint)]" />
            <p className="mt-3 text-[14px] font-medium text-[var(--wb-fg)]">{ preset.prompt }</p>
            <p className="mt-2 font-mono text-[11px] text-[var(--wb-fg-faint)]">
              docs/screenshots/{ tabId }.png
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-xl rounded-br-md bg-[var(--wb-fg)] px-4 py-2.5 text-[13px] text-[var(--wb-bg)]">
                { preset.prompt }
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-gradient-to-br from-[#5266E8] to-[#3F4FD8] text-[10px]">
                🐕
              </span>
              <div className="flex-1 rounded-xl rounded-tl-md border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] px-4 py-3">
                { preset.status === 'streaming' && (
                  <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--wb-working-soft)] px-2 py-0.5 text-[10px] text-[var(--wb-working-fg)]">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-[var(--wb-working)]" />
                    Deep thinking
                  </div>
                ) }
                <p className="text-[13px] leading-relaxed text-[var(--wb-fg)]">
                  { preset.reply }
                  { preset.status === 'streaming' && (
                    <span className="ml-0.5 inline-block h-3.5 w-1 animate-cursor-blink bg-[var(--wb-fg)] align-middle" />
                  ) }
                </p>
              </div>
            </div>
          </div>
        ) }
      </main>
    </div>
  );
}
