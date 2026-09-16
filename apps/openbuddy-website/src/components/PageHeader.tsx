/**
 * PageHeader / SectionHeader —— 整站统一的头部组件
 *
 * 设计语言:
 * - eyebrow: monospace 11px + tracking + faint
 * - title: font-display-serif + clamp + tracking-tight
 * - subtitle: max-w-2xl + muted + 16-18px
 * - note: monospace 12px + faint
 */
import Reveal from '@/components/motion/Reveal';
interface PageHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  note?: string;
  /** Smaller clamp for locales with wider glyphs (zh-CN, ja, ko). */
  compact?: boolean;
}

export function PageHeader({ eyebrow, title, subtitle, note, compact = false }: PageHeaderProps) {
  const h1Class = compact
    ? 'mt-3 font-display-serif text-[clamp(28px,4vw,48px)] font-normal leading-[1.1] tracking-[-0.02em] text-[var(--wb-fg)]'
    : 'mt-3 font-display-serif text-[clamp(40px,6vw,80px)] font-normal leading-[1.02] tracking-[-0.03em] text-[var(--wb-fg)]';
  return (
    <header className="relative">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
        { eyebrow }
      </p>
      <h1 className={ h1Class }>
        { title }
      </h1>
      { subtitle ? (
        <p className="mt-6 max-w-2xl text-[18px] leading-[1.55] text-[var(--wb-fg-muted)]">
          { subtitle }
        </p>
      ) : null }
      { note ? (
        <p className="mt-3 max-w-2xl font-mono text-[12px] text-[var(--wb-fg-faint)]">
          { note }
        </p>
      ) : null }
    </header>
  );
}

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
}

/**
 * Reveal wraps these because every SectionHeader sits below the fold. PageHeader
 * above does not: it is the top of the page, where Reveal's "already visible at
 * mount" check makes it a no-op.
 */
export function SectionHeader({ eyebrow, title, subtitle }: SectionHeaderProps) {
  return (
    <Reveal as="header" className="mb-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
        { eyebrow }
      </p>
      <h2 className="mt-3 font-display-serif text-[clamp(28px,3.5vw,44px)] font-normal leading-[1.05] tracking-[-0.025em] text-[var(--wb-fg)]">
        { title }
      </h2>
      { subtitle ? (
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-[var(--wb-fg-muted)]">
          { subtitle }
        </p>
      ) : null }
    </Reveal>
  );
}
