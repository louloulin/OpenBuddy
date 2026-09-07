/**
 * SharedHeader —— 各 page 顶部 header (tutti 风格)
 *
 * - monospace label + 编号
 * - 大字 serif 标题
 * - 紧凑副标
 */
interface SharedHeaderProps {
  label: string;
  number: string;
  title: string;
  subtitle?: string;
  align?: 'left' | 'center';
}

export default function SharedHeader({ label, number, title, subtitle, align = 'left' }: SharedHeaderProps) {
  return (
    <header className={ `mb-16 ${align === 'center' ? 'text-center' : ''}` }>
      <div className={ `flex items-center gap-3 ${align === 'center' ? 'justify-center' : ''}` }>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
          { label }
        </span>
        <span className="font-mono text-[10px] text-[var(--wb-fg-faint)]">·</span>
        <span className="font-mono text-[10px] text-[var(--wb-fg-faint)]">{ number }</span>
      </div>
      <h1 className="mt-4 font-display-serif text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05] text-balance text-[var(--wb-fg)]">
        { title }
      </h1>
      { subtitle ? (
        <p className={ `mt-5 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)] ${align === 'center' ? 'mx-auto' : ''}` }>
          { subtitle }
        </p>
      ) : null }
    </header>
  );
}