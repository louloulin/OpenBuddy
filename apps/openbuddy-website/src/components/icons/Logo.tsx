interface LogoProps {
  size?: number;
  /** Show wordmark next to the mark (used in header). */
  showWordmark?: boolean;
  className?: string;
}

/**
 * Logo —— 使用 /openbuddy-logo.svg(已经在 public/),响应尺寸,
 * 跟随主题:深色背景自动切到 /openbuddy-logo-mono.svg。
 */
export default function Logo({ size = 28, showWordmark = true, className = '' }: LogoProps) {
  return (
    <span className={ `inline-flex items-center gap-2 ${ className }` }>
      <picture>
        <source srcSet="/openbuddy-logo-mono.svg" media="(prefers-color-scheme: dark)" />
        <img
          src="/openbuddy-logo.svg"
          width={ size }
          height={ size }
          alt=""
          aria-hidden="true"
          className="block h-auto w-[var(--logo-size)]"
          style={ { '--logo-size': `${ size }px` } as React.CSSProperties }
        />
      </picture>
      { showWordmark ? (
        <span className="font-medium tracking-tight" style={ { fontSize: `${ Math.round(size * 0.65) }px` } }>
          OpenBuddy
        </span>
      ) : null }
    </span>
  );
}