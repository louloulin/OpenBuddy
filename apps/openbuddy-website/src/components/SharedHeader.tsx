/**
 * SharedHeader —— tutti 严格对标版
 *
 * 关键变化 (vs 旧版):
 * - 移除角落大背景编号 (tutti 没有这个装饰)
 * - 标题用 display-xl (tutti 39px), letter-spacing -0.025em
 * - 副标更大 (18px), 间距更宽
 */
interface SharedHeaderProps {
  label: string;
  number: string;
  title: string;
  subtitle?: string;
}

export function SharedHeader({
  label,
  number,
  title,
  subtitle
}: SharedHeaderProps) {
  return (
    <header className="relative">
      <div className="grid items-end gap-6 md:grid-cols-[100px_1fr] md:gap-10">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--wb-fg-faint)]">
            § { number }
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
            { label }
          </span>
        </div>
        <h2 className="text-display-xl text-[var(--wb-fg)] text-balance">
          { title }
        </h2>
      </div>

      { subtitle ? (
        <p className="mt-6 max-w-2xl text-body-lg text-[var(--wb-fg-muted)] text-pretty md:ml-[120px]">
          { subtitle }
        </p>
      ) : null }
    </header>
  );
}

export default SharedHeader;
