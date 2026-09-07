'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Cookie, X } from 'lucide-react';

const STORAGE_KEY = 'ob:cookie-consent';

/**
 * CookieConsent —— 简洁的 cookie 同意提示
 *
 * 设计:
 * - 首次访问显示，4s 后浮出（让页面先渲染）
 * - 仅展示 + Accept / Decline 按钮，不使用 cookie
 * - 选择持久化到 localStorage
 * - 完全可选 —— OpenBuddy 官网本身不使用 cookie
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return;
    } catch {
      // ignore
    }
    // 4s 后显示
    const t = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(t);
  }, []);

  if (!mounted || !visible) return null;

  const accept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'accepted');
    } catch {
      // ignore
    }
    setVisible(false);
  };

  const decline = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'declined');
    } catch {
      // ignore
    }
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed inset-x-4 bottom-4 z-30 mx-auto max-w-2xl rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-4 shadow-wb-card-hover sm:bottom-6 sm:left-6 sm:right-auto sm:max-w-md sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--wb-bg-soft-2)] text-[var(--wb-fg-muted)]">
          <Cookie className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-[var(--wb-fg)]">
            { '🍪 No cookies, no tracking.' }
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--wb-fg-muted)]">
            OpenBuddy.dev doesn&apos;t use analytics or advertising cookies. The only state we store is your
            theme and locale preference (in your browser only).{ ' ' }
            <Link href="https://github.com/louloulin/OpenBuddy/blob/main/SECURITY.md" className="text-brand-deep underline">
              Privacy policy
            </Link>
            .
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={ accept }
              className="rounded-md bg-[var(--wb-fg)] px-3 py-1.5 text-[12px] font-medium text-[var(--wb-bg)] transition-colors hover:opacity-90"
            >
              Sounds good
            </button>
            <button
              type="button"
              onClick={ decline }
              className="rounded-md border border-[var(--wb-border)] bg-transparent px-3 py-1.5 text-[12px] font-medium text-[var(--wb-fg-muted)] transition-colors hover:text-[var(--wb-fg)]"
            >
              Dismiss
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={ decline }
          className="flex-shrink-0 text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}