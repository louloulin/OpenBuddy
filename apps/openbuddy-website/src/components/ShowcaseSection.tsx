'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon } from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SectionHeader } from './FeaturesSection';

interface ShowcaseSectionProps {
  dict: Dict;
}

/**
 * ShowcaseSection —— 应用截图展示
 *
 * 设计要点：
 * - 标签切换：4 张截图（cold start / composer ready / streaming / multi-turn）
 * - 每张截图：编辑窗口风格的容器，带标题栏 dots
 * - 占位：用 mock 截图卡片 + 提示真实截图来自 docs/screenshots
 * - 左右切换按钮 + 缩略指示器
 */
export default function ShowcaseSection({ dict }: ShowcaseSectionProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const tabs = dict.showcase.tabs;

  const goPrev = () => setActiveIdx((i) => (i - 1 + tabs.length) % tabs.length);
  const goNext = () => setActiveIdx((i) => (i + 1) % tabs.length);

  return (
    <section id="showcase" className="relative bg-[var(--wb-bg-soft)] py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          label={ dict.showcase.sectionLabel }
          title={ dict.showcase.title }
          subtitle={ dict.showcase.subtitle }
        />

        {/* Tab strip */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-2">
          { tabs.map((tab, idx) => (
            <button
              key={ tab.id }
              type="button"
              onClick={ () => setActiveIdx(idx) }
              className={ `rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-all ${
                idx === activeIdx
                  ? 'border-[var(--wb-fg)] bg-[var(--wb-fg)] text-[var(--wb-bg)]'
                  : 'border-[var(--wb-border)] bg-[var(--wb-bg)] text-[var(--wb-fg-muted)] hover:border-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]'
              }` }
            >
              { tab.label }
            </button>
          )) }
        </div>

        {/* Showcase window */}
        <div className="mt-10 grid items-center gap-8 lg:grid-cols-3">
          {/* Main window */}
          <div className="lg:col-span-2">
            <div className="wb-window">
              <div className="wb-window-titlebar">
                <span className="wb-dot bg-[#FF5F57]" />
                <span className="wb-dot bg-[#FEBC2E]" />
                <span className="wb-dot bg-[#28C840]" />
                <span className="ml-3 select-none">OpenBuddy — { tabs[activeIdx].id }</span>
                <span className="ml-auto font-mono text-[11px] opacity-50">
                  { String(activeIdx + 1).padStart(2, '0') }/{ String(tabs.length).padStart(2, '0') }
                </span>
              </div>

              <ShowcaseMock tabId={ tabs[activeIdx].id } />
            </div>

            {/* Prev / Next */}
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={ goPrev }
                className="btn-secondary !py-1.5 !text-[12px]"
                aria-label="Previous screenshot"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Prev</span>
              </button>
              <div className="flex items-center gap-1.5">
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
                className="btn-secondary !py-1.5 !text-[12px]"
                aria-label="Next screenshot"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Description */}
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-muted)]">
                Tab { String(activeIdx + 1).padStart(2, '0') }
              </p>
              <h3 className="mt-3 font-display text-[20px] font-semibold tracking-tight text-[var(--wb-fg)]">
                { tabs[activeIdx].label }
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-[var(--wb-fg-muted)]">
                { tabs[activeIdx].description }
              </p>
              <div className="mt-6 border-t border-[var(--wb-border)] pt-4">
                <p className="text-[12px] text-[var(--wb-fg-muted)]">
                  All screenshots are captured against the real MiniMax-M3 model in a built Electron app.
                </p>
                <a
                  href="https://github.com/louloulin/OpenBuddy/tree/main/docs/screenshots"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-brand-9 hover:underline"
                >
                  View all on GitHub →
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * ShowcaseMock —— 在标签切换时呈现不同的视觉提示。
 * 在没有真实截图的情况下，以高保真"窗口截图占位"代替，
 * 内部结构与实际 OpenBuddy 应用一致：sidebar + 主对话区。
 */
function ShowcaseMock({ tabId }: { tabId: string }) {
  const presets: Record<
    string,
    { status: 'idle' | 'thinking' | 'streaming' | 'settled'; prompt?: string; reply?: string }
  > = {
    'cold-start': {
      status: 'idle',
      prompt: 'No API key configured. Open Settings → Providers to add one.'
    },
    'composer-ready': {
      status: 'idle',
      prompt: 'Try: "Refactor this function to use async/await"'
    },
    'streaming': {
      status: 'streaming',
      prompt: 'Tell me about yourself',
      reply: 'I am Pi, an AI coding assistant running inside OpenBuddy. I can read…'
    },
    'multi-turn': {
      status: 'settled',
      prompt: 'Translate "Hello world" to Chinese',
      reply: '你好,世界'
    }
  };

  const preset = presets[tabId] ?? presets['cold-start'];

  return (
    <div className="grid grid-cols-[180px_1fr] bg-[var(--wb-bg-soft)]">
      {/* Sidebar mock */}
      <aside className="border-r border-[var(--wb-border)] bg-[var(--wb-bg)] p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-9 text-[10px] text-white">
            🐕
          </span>
          <span className="text-[12px] font-semibold">OpenBuddy</span>
        </div>
        <div className="mt-4 space-y-1">
          { ['New chat', 'Workspace', 'Skills', 'MCP', 'Settings'].map((item) => (
            <div
              key={ item }
              className={ `rounded-md px-2 py-1.5 text-[11px] ${
                item === 'New chat' ? 'bg-brand-2 text-brand-10' : 'text-[var(--wb-fg-muted)]'
              }` }
            >
              { item }
            </div>
          )) }
        </div>
        <div className="mt-4 border-t border-[var(--wb-border)] pt-3">
          <p className="text-[9px] uppercase tracking-wider text-[var(--wb-fg-muted)]">Today</p>
          <div className="mt-2 space-y-1">
            <div className="rounded-md bg-[var(--wb-bg-soft-2)] px-2 py-1 text-[10px]">Translate README</div>
            <div className="rounded-md px-2 py-1 text-[10px] text-[var(--wb-fg-muted)]">Refactor auth.ts</div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="p-6">
        { preset.status === 'idle' && !preset.reply ? (
          <div className="flex h-48 flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--wb-bg-soft-2)] text-[var(--wb-fg-muted)]">
              <ImageIcon className="h-5 w-5" />
            </div>
            <p className="mt-3 text-[12px] font-medium text-[var(--wb-fg)]">
              { preset.prompt }
            </p>
            <p className="mt-1 font-mono text-[10px] text-[var(--wb-fg-muted)]">
              docs/screenshots/{ tabId }.png
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* User message */}
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-lg rounded-br-sm bg-brand-9 px-3 py-2 text-[12px] text-white">
                { preset.prompt }
              </div>
            </div>
            {/* Assistant reply */}
            <div className="flex items-start gap-2">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-brand-3 text-[10px]">
                🐕
              </span>
              <div className="flex-1 rounded-lg rounded-tl-sm border border-[var(--wb-border)] bg-[var(--wb-bg)] px-3 py-2">
                { preset.status === 'streaming' && (
                  <div className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-brand-2 px-2 py-0.5 text-[10px] text-brand-10">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-brand-8" />
                    Deep thinking
                  </div>
                ) }
                <p className="text-[12px] leading-relaxed text-[var(--wb-fg)]">
                  { preset.reply }
                  { preset.status === 'streaming' && (
                    <span className="ml-0.5 inline-block h-3 w-1 animate-cursor-blink bg-[var(--wb-fg)] align-middle" />
                  ) }
                </p>
                { preset.status === 'settled' && (
                  <div className="mt-2 flex items-center gap-2 border-t border-[var(--wb-border)] pt-1.5 text-[10px] text-[var(--wb-fg-muted)]">
                    <span>✓ Completed 4.2s</span>
                    <span>·</span>
                    <span>Copy</span>
                    <span>·</span>
                    <span>Retry</span>
                  </div>
                ) }
              </div>
            </div>
          </div>
        ) }
      </main>
    </div>
  );
}