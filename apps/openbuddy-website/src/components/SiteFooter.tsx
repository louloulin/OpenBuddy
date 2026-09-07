import Link from 'next/link';
import { Github, Twitter, Youtube, MessageCircle } from 'lucide-react';
import type { Dict } from '@/lib/i18n';

interface SiteFooterProps {
  dict: Dict;
}

/**
 * SiteFooter —— tutti 风格极简版 (跟随 global theme)
 */
export default function SiteFooter({ dict }: SiteFooterProps) {
  const sections = [
    { title: dict.footer.product.title, links: dict.footer.product.links },
    { title: dict.footer.resources.title, links: dict.footer.resources.links },
    { title: dict.footer.community.title, links: dict.footer.community.links },
    { title: dict.footer.legal.title, links: dict.footer.legal.links }
  ];

  return (
    <footer className="border-t border-[var(--wb-border)] bg-[var(--wb-bg-soft)]">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
        {/* 顶部: 大 logo + tagline + 社交 */}
        <div className="border-b border-[var(--wb-border)] pb-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 text-[var(--wb-fg)]"
            aria-label="OpenBuddy"
          >
            <span className="relative inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-md">
              <span
                className="absolute inset-0"
                style={ { background: 'linear-gradient(135deg, #5266E8 0%, #3F4FD8 100%)' } }
              />
              <span className="relative text-[14px]">🐕</span>
            </span>
            <span className="text-[20px] font-medium tracking-tight">
              OpenBuddy
            </span>
          </Link>

          <p className="mt-6 max-w-md text-body-lg text-[var(--wb-fg-muted)]">
            { dict.footer.tagline }
          </p>

          <div className="mt-8 flex items-center gap-4">
            <SocialLink
              href="https://github.com/louloulin/OpenBuddy"
              icon={ Github }
              label="GitHub"
            />
            <SocialLink
              href="https://x.com/openbuddy"
              icon={ Twitter }
              label="X"
            />
            <SocialLink
              href="https://discord.gg/openbuddy"
              icon={ MessageCircle }
              label="Discord"
            />
            <SocialLink
              href="https://youtube.com/@openbuddy"
              icon={ Youtube }
              label="YouTube"
            />
          </div>
        </div>

        {/* 链接 4 列 */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 py-12 md:grid-cols-4">
          { sections.map((section) => (
            <div key={ section.title }>
              <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
                { section.title }
              </h3>
              <ul className="mt-5 space-y-3">
                { section.links.map((link) => (
                  <li key={ link.href + link.label }>
                    <Link
                      href={ link.href }
                      className="text-[14px] text-[var(--wb-fg-muted)] transition-colors hover:text-[var(--wb-fg)]"
                    >
                      { link.label }
                    </Link>
                  </li>
                )) }
              </ul>
            </div>
          )) }
        </div>

        {/* 底部版权 */}
        <div className="flex flex-col gap-3 border-t border-[var(--wb-border)] pt-8 md:flex-row md:items-center md:justify-between">
          <p className="font-mono text-[11.5px] text-[var(--wb-fg-muted)]">
            { dict.footer.copyright }
          </p>
          <p className="font-mono text-[11.5px] text-[var(--wb-fg-faint)]">
            { dict.footer.madeWith }
          </p>
        </div>
      </div>
    </footer>
  );
}

function SocialLink({
  href,
  icon: Icon,
  label
}: {
  href: string;
  icon: typeof Github;
  label: string;
}) {
  return (
    <a
      href={ href }
      target="_blank"
      rel="noreferrer"
      className="group flex h-9 w-9 items-center justify-center rounded-full border border-[var(--wb-border)] text-[var(--wb-fg-muted)] transition-colors hover:border-[var(--wb-border-strong)] hover:text-[var(--wb-fg)]"
      aria-label={ label }
    >
      <Icon className="h-4 w-4" />
    </a>
  );
}
