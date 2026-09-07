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
 * SiteHeader —— tutti 风格重做
 *
 * - 更克制：只有 logo + 主导航 + locale/theme/CTA
 * - 滚动后有 backdrop blur
 * - monospace 字体配合 state dot 表示状态
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
    { href: localizedPath('/pricing', locale), label: dict.nav.pricing },
    { href: localizedPath('/docs', locale), label: dict.nav.docs }
  ];

  return (
    <header
      className={ `sticky top-0 z-40 w-full transition-all duration-200 ${
        scrolled
          ? 'backdrop-blur-md bg-[var(--wb-bg)]/80 border-b border-[var(--wb-border)]'
          : 'bg-transparent'
      }` }
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link
          href={ localizedPath('/', locale) }
          className="flex items-center gap-2 text-[var(--wb-fg)]"
          aria-label="OpenBuddy home"
        >
          <span className="relative inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-md">
            <span
              className="absolute inset-0"
              style={ { background: 'linear-gradient(135deg, #13665C 0%, #0C4A48 100%)' } }
            />
            <span className="relative text-sm">🐕</span>
          </span>
          <span className="font-display-serif text-[18px] tracking-tight">OpenBuddy</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-wider text-[var(--wb-fg-faint)] sm:inline-block ml-1.5 px-1.5 py-0.5 rounded border border-[var(--wb-border)]">
            MIT
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
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
          <div className="hidden md:block">
            <LocaleSwitcher />
          </div>
          <ThemeSwitcher />
          <a
            href="https://github.com/louloulin/OpenBuddy"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-md border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--wb-fg)] transition-colors hover:bg-[var(--wb-bg-soft)] sm:inline-flex"
          >
            <Github className="h-3.5 w-3.5" />
            <GitHubStars repo="louloulin/OpenBuddy" compact />
          </a>
          <Link
            href={ localizedPath('/download', locale) }
            className="btn-primary !py-1.5 !px-3 !text-[13px]"
          >
            { dict.nav.download }
          </Link>

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
        <div className="border-t border-[var(--wb-border)] bg-[var(--wb-bg-pure)] md:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-px bg-[var(--wb-border)] p-px">
            { navLinks.map((link) => (
              <Link
                key={ link.href }
                href={ link.href }
                className="bg-[var(--wb-bg-pure)] px-4 py-3 text-[14px] font-medium text-[var(--wb-fg-muted)] transition-colors hover:bg-[var(--wb-bg-soft)] hover:text-[var(--wb-fg)]"
                onClick={ () => setMobileOpen(false) }
              >
                { link.label }
              </Link>
            )) }
            <div className="flex items-center justify-between bg-[var(--wb-bg-pure)] px-4 py-3">
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