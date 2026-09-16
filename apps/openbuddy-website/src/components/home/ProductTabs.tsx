'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import Reveal from '@/components/motion/Reveal';
import type { Locale } from '@/lib/i18n';

interface ProductTabsProps {
  locale: Locale;
}

interface Tab {
  id: string;
  label: { en: string; zh: string };
  caption: { en: string; zh: string };
  src: string;
  alt: string;
  tag: { en: string; zh: string };
}

const TABS: Tab[] = [
  {
    id: 'workspace',
    label: { en: 'Workspace', zh: '工作区' },
    caption: { en: 'Chat, code, and tools side-by-side.', zh: '对话、代码、工具同窗。' },
    src: '/screenshots/desktop-main.png',
    alt: 'OpenBuddy desktop workspace showing multi-turn chat, source preview, and capability sidebar',
    tag: { en: 'desktop', zh: '桌面' }
  },
  {
    id: 'cold-start',
    label: { en: 'First Run', zh: '首次运行' },
    caption: { en: 'Empty state, ready to receive your first prompt.', zh: '空状态,准备好接收你的第一个请求。' },
    src: '/screenshots/01-home-cold-start.png',
    alt: 'OpenBuddy home view at first launch',
    tag: { en: 'home', zh: '首页' }
  },
  {
    id: 'turn',
    label: { en: 'Settled Turn', zh: '一轮对话' },
    caption: { en: 'After the assistant finishes — render, files, history.', zh: '助手答复后的界面:渲染、文件、历史。' },
    src: '/screenshots/04-turn1-settled.png',
    alt: 'OpenBuddy after a single assistant turn completes',
    tag: { en: 'turn 1', zh: '第 1 轮' }
  }
];

/**
 * ProductTabs —— 3 个真截图标签。
 * 客户端组件因为有交互(useState)。
 */
export default function ProductTabs({ locale }: ProductTabsProps) {
  const [active, setActive] = useState(TABS[0].id);
  const current = TABS.find((t) => t.id === active) ?? TABS[0];
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Roving tabindex: only the selected tab is in the tab order, so arrow keys
  // are the way to move between them (WAI-ARIA tabs pattern).
  function onTablistKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const idx = TABS.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = TABS[next].id;
    setActive(id);
    tabRefs.current[id]?.focus();
  }

  return (
    <section className="relative py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <Reveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
              { locale === 'zh-CN' ? '产品演示' : 'Product' }
            </p>
            <h2 className="mt-3 max-w-2xl font-display-serif text-[clamp(32px,4.5vw,56px)] font-normal leading-[1.05] tracking-[-0.025em] text-[var(--wb-fg)]">
              { locale === 'zh-CN'
                ? '真实截图 —— 不是 CSS 拼出来的假窗口。'
                : 'Real screenshots, not CSS mock windows.' }
            </h2>
          </Reveal>

          <div
            role="tablist"
            aria-label={ locale === 'zh-CN' ? '产品截图标签' : 'Product screenshot tabs' }
            onKeyDown={ onTablistKeyDown }
            className="inline-flex rounded-full border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-1"
          >
            { TABS.map((tab) => {
              const isActive = tab.id === active;
              return (
                <button
                  key={ tab.id }
                  id={ `product-tab-${tab.id}` }
                  ref={ (el) => { tabRefs.current[tab.id] = el; } }
                  role="tab"
                  aria-selected={ isActive }
                  aria-controls={ `product-panel-${tab.id}` }
                  tabIndex={ isActive ? 0 : -1 }
                  onClick={ () => setActive(tab.id) }
                  type="button"
                  className={ `rounded-full px-4 py-2 text-[13px] transition-colors ${
                    isActive
                      ? 'bg-[var(--wb-fg)] text-[var(--wb-bg)]'
                      : 'text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]'
                  }` }
                >
                  { tab.label[locale === 'zh-CN' ? 'zh' : 'en'] }
                </button>
              );
            }) }
          </div>
        </div>

        <figure
          role="tabpanel"
          id={ `product-panel-${current.id}` }
          aria-labelledby={ `product-tab-${current.id}` }
          tabIndex={ 0 }
          className="overflow-hidden rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] shadow-[0_24px_60px_-32px_rgba(21,43,67,0.18)]"
        >
          <Image
            key={ current.src }
            src={ current.src }
            alt={ current.alt }
            width={ 1400 }
            height={ 900 }
            className="block h-auto w-full"
            sizes="(min-width: 1024px) 72rem, 100vw"
          />
          <figcaption className="flex items-center justify-between gap-4 border-t border-[var(--wb-border)] px-6 py-4 text-[13px]">
            <span className="text-[var(--wb-fg-muted)]">
              { current.caption[locale === 'zh-CN' ? 'zh' : 'en'] }
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
              { current.tag[locale === 'zh-CN' ? 'zh' : 'en'] }
            </span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}