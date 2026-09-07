'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X, Github } from 'lucide-react';
import LocaleSwitcher from '@/components/LocaleSwitcher';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import GitHubStars from '@/components/GitHubStars';
import type { Dict, Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';

interface SiteHeaderProps {
  dict: Dict;
  locale: Locale;
}

/**
 * SiteHeader —— tutti 风格 v2
 *
 * 关键逻辑:
 * - 首页 (/): 顶部透明 (覆盖 dark hero), 滚动后变实心
 * - 子页面: 始终实心 (避免透明文字在浅色 section 上不可见)
 */
export default function SiteHeader({ dict, locale }: SiteHeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 判断是否在首页 (用于决定 header 是否透明)
  const isHome = pathname === '/' || pathname === '/zh-CN' || pathname === `/${ locale }`;

  // 在首页 + 未滚动: 透明 + 白字 (覆盖 dark hero)
  // 其他情况: 实心 + 主题色
  const useTransparent = isHome && !scrolled;

  const navLinks = [
    { href: localizedPath('/#features', locale), label: dict.nav.features },
    { href: localizedPath('/#architecture', locale), label: dict.nav.architecture },
    { href: localizedPath('/#comparison', locale), label: dict.nav.comparison },
    { href: localizedPath('/pricing', locale), label: dict.nav.pricing },
    { href: localizedPath('/docs', locale), label: dict.nav.docs }
  ];

  return (
    <header
      className={ `sticky top-0 z-40 w-full transition-all duration-200 bg-[var(--wb-bg)]/85 backdrop-blur-md border-b border-[var(--wb-border)] text-[var(--wb-fg)]` }
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link
          href={ localizedPath('/', locale) }
          className="flex items-center gap-2.5 text-[var(--wb-fg)]"
          aria-label="OpenBuddy home"
        >
          <span className="relative inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-md">
            <span
              className="absolute inset-0"
              style={ { background: 'linear-gradient(135deg, #5266E8 0%, #3F4FD8 100%)' } }
            />
            <span className="relative text-[13px]">🐕</span>
          </span>
          <span className="text-[16px] font-medium tracking-tight">
            OpenBuddy
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          { navLinks.map((link) => (
            <Link
              key={ link.href }
              href={ link.href }
              className="rounded-md px-3 py-1.5 text-[13.5px] font-normal text-[var(--wb-fg-muted)] transition-colors hover:text-[var(--wb-fg)]"
            >
              { link.label }
            </Link>
          )) }
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden md:block">
            <LocaleSwitcher />
          </div>
          <ThemeSwitcher />
          <a
            href="https://github.com/louloulin/OpenBuddy"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 text-[13px] text-[var(--wb-fg-muted)] transition-colors hover:text-[var(--wb-fg)] sm:inline-flex"
          >
            <Github className="h-4 w-4" />
            <GitHubStars repo="louloulin/OpenBuddy" compact />
          </a>
          <Link
            href={ localizedPath('/download', locale) }
            className="cta-link text-[14px] text-[var(--wb-fg)]"
          >
            <span>{ dict.nav.download }</span>
            <span className="cta-link-arrow">→</span>
          </Link>

          <button
            type="button"
            aria-label="Toggle menu"
            className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--wb-border)] md:hidden"
            onClick={ () => setMobileOpen(!mobileOpen) }
          >
            { mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" /> }
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      { mobileOpen ? (
        <div className="border-t border-[var(--wb-border)] bg-[var(--wb-bg-pure)] md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col">
            { navLinks.map((link) => (
              <Link
                key={ link.href }
                href={ link.href }
                className="border-b border-[var(--wb-border)] px-4 py-3.5 text-[14px] text-[var(--wb-fg-muted)] transition-colors hover:bg-[var(--wb-bg-soft)] hover:text-[var(--wb-fg)]"
                onClick={ () => setMobileOpen(false) }
              >
                { link.label }
              </Link>
            )) }
            <div className="flex items-center justify-between px-4 py-3.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--wb-fg-faint)]">
                Language
              </span>
              <LocaleSwitcher />
            </div>
          </nav>
        </div>
      ) : null }
    </header>
  );
}
