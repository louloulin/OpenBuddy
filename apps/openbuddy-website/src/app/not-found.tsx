import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--wb-fg-muted)]">
          404 · Not Found
        </p>
        <h1 className="mt-3 font-display text-display-lg text-balance">
          This page doesn't exist.
        </h1>
        <p className="mt-4 text-[15px] text-[var(--wb-fg-muted)]">
          Maybe the docs moved, or you typed the path manually. Either way —
          </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-[var(--wb-fg)] px-4 py-2 text-[13px] font-medium text-[var(--wb-bg)] transition-colors hover:opacity-90"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Take me home</span>
        </Link>
      </div>
    </main>
  );
}