import Link from 'next/link';
import { Github } from 'lucide-react';
import type { Dict } from '@/lib/i18n';

interface SiteFooterProps {
  dict: Dict;
}

/**
 * SiteFooter —— 全站底部
 *
 * 设计要点：
 * - 4 列 (产品/资源/社区/法律) + 品牌 Logo + 简洁宣言
 * - 背景：浅灰表面 + 顶部 1px border 与主区分割
 * - 移动端：列折叠为 2 列网格
 */
export default function SiteFooter({ dict }: SiteFooterProps) {
  const sections = [
    { title: dict.footer.product.title, links: dict.footer.product.links },
    { title: dict.footer.resources.title, links: dict.footer.resources.links },
    { title: dict.footer.community.title, links: dict.footer.community.links },
    { title: dict.footer.legal.title, links: dict.footer.legal.links }
  ];

  return (
    <footer className="mt-32 border-t border-[var(--wb-border)] bg-[var(--wb-bg-soft)]">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-5 md:gap-12">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="inline-flex items-center gap-2 text-[var(--wb-fg)]" aria-label="OpenBuddy">
              <span className="relative inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg">
                <span
                  className="absolute inset-0"
                  style={ { background: 'linear-gradient(135deg, #13665C 0%, #0C4A48 100%)' } }
                />
                <span className="absolute inset-[2px] rounded-md bg-[#13665C]" />
                <span className="relative text-base">🐕</span>
              </span>
              <span className="font-display text-[15px] font-semibold tracking-tight">OpenBuddy</span>
            </Link>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-[var(--wb-fg-muted)]">
              { dict.footer.tagline }
            </p>
            <a
              href="https://github.com/louloulin/OpenBuddy"
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
            >
              <Github className="h-3.5 w-3.5" />
              <span>louloulin/OpenBuddy</span>
            </a>
          </div>

          {/* Link columns */}
          { sections.map((section) => (
            <div key={ section.title }>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--wb-fg)]">
                { section.title }
              </h3>
              <ul className="mt-4 space-y-2">
                { section.links.map((link) => (
                  <li key={ link.href + link.label }>
                    <Link
                      href={ link.href }
                      className="text-[13px] text-[var(--wb-fg-muted)] transition-colors hover:text-[var(--wb-fg)]"
                    >
                      { link.label }
                    </Link>
                  </li>
                )) }
              </ul>
            </div>
          )) }
        </div>

        {/* Bottom row */}
        <div className="mt-12 flex flex-col gap-3 border-t border-[var(--wb-border)] pt-8 md:flex-row md:items-center md:justify-between">
          <p className="text-[12px] text-[var(--wb-fg-muted)]">{ dict.footer.copyright }</p>
          <p className="text-[11px] text-[var(--wb-fg-muted)]">{ dict.footer.madeWith }</p>
        </div>
      </div>
    </footer>
  );
}