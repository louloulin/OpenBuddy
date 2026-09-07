'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
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
 * SiteHeader —— 顶部导航
 *
 * 设计要点：
 * - sticky + backdrop blur (translucent)
 * - 桌面端：水平导航，移动端：折叠汉堡菜单
 * - 右上角突出 Star on GitHub CTA (品牌色背景)
 * - 下方 1px border + backdrop-filter 制造"漂浮"感
 */
export default function SiteHeader({ dict, locale }: SiteHeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navLinks = [
    { href: localizedPath('/#features', locale), label: dict.nav.features },
    { href: localizedPath('/#architecture', locale), label: dict.nav.architecture },
    { href: localizedPath('/#comparison', locale), label: dict.nav.comparison },
    { href: localizedPath('/#showcase', locale), label: dict.nav.showcase },
    { href: localizedPath('/pricing', locale), label: dict.nav.pricing },
    { href: localizedPath('/changelog', locale), label: dict.nav.changelog },
    { href: localizedPath('/docs', locale), label: dict.nav.docs }
  ];

  // (LocaleSwitcher handles language routing internally)

  return (
    <header
      className={ `sticky top-0 z-40 w-full transition-all duration-200 ${
        scrolled ? 'backdrop-blur-md bg-[var(--wb-bg)]/85 border-b border-[var(--wb-border)]' : 'bg-transparent'
      }` }
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href={ localizedPath('/', locale) }
          className="group flex items-center gap-2 text-[var(--wb-fg)]"
          aria-label="OpenBuddy home"
        >
          <span className="relative inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg shadow-wb-card">
            <span
              className="absolute inset-0"
              style={ {
                background: 'linear-gradient(135deg, #13665C 0%, #0C4A48 100%)'
              } }
            />
            <span className="absolute inset-[2px] rounded-md bg-[#13665C]" />
            <span className="relative text-base">🐕</span>
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight">OpenBuddy</span>
          <span className="hidden text-[10px] font-medium text-[var(--wb-fg-muted)] sm:inline-block sm:ml-1 sm:px-1.5 sm:py-0.5 sm:rounded sm:bg-[var(--wb-border)] sm:tracking-wider">
            MIT
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          { navLinks.map((link) => (
            <Link
              key={ link.href }
              href={ link.href }
              className="rounded-md px-3 py-1.5 text-[13px] font-medium text-[var(--wb-fg-muted)] transition-colors hover:text-[var(--wb-fg)]"
            >
              { link.label }
            </Link>
          )) }
        </nav>

        <div className="flex items-center gap-2">
          {/* Language switcher (dropdown) */}
          <div className="hidden md:block">
            <LocaleSwitcher />
          </div>

          {/* GitHub CTA */}
          <a
            href="https://github.com/louloulin/OpenBuddy"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-md border border-[var(--wb-border)] bg-[var(--wb-bg)] px-3 py-1.5 text-[13px] font-medium text-[var(--wb-fg)] transition-all hover:bg-[var(--wb-fg)] hover:text-[var(--wb-bg)] sm:inline-flex"
          >
            <Github className="h-3.5 w-3.5" />
            <GitHubStars repo="louloulin/OpenBuddy" />
          </a>
          <ThemeSwitcher />

          <Link
            href={ localizedPath('/download', locale) }
            className="btn-primary !py-1.5 !text-[13px]"
          >
            { dict.nav.download }
          </Link>

          {/* Mobile menu toggle */}
          <button
            type="button"
            aria-label="Toggle menu"
            className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--wb-border)] md:hidden"
            onClick={ () => setMobileOpen(!mobileOpen) }
          >
            { mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" /> }
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      { mobileOpen ? (
        <div className="border-t border-[var(--wb-border)] bg-[var(--wb-bg)] md:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3">
            { navLinks.map((link) => (
              <Link
                key={ link.href }
                href={ link.href }
                className="rounded-md px-3 py-2 text-[14px] font-medium text-[var(--wb-fg-muted)] hover:bg-[var(--wb-bg-soft-2)]"
                onClick={ () => setMobileOpen(false) }
              >
                { link.label }
              </Link>
            )) }
            <div className="mt-2 border-t border-[var(--wb-border)] px-3 pt-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--wb-fg-muted)]">
                Language
              </p>
              <LocaleSwitcher />
            </div>
          </nav>
        </div>
      ) : null }
    </header>
  );
}