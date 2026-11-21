/**
 * 首页空态插画 (20261121-ui-gap G11)。
 *
 * 一张"待办纸张"的矢量画：三层错位卡片 + 一支笔 + 虚线轨迹，沿用 Grok Bot 的
 * 暖纸/近黑/发丝线语言。只用 stroke 与低饱和填充，缩放不失真；深浅主题共用
 * 同一份 SVG，颜色走 CSS 变量。
 */
export function EmptyStateArt({ className }: { className?: string }) {
  return (
    <svg
      className={"home__empty-art" + (className ? ` ${className}` : "")}
      viewBox="0 0 220 140"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="ob-empty-sheet" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--grok-card)" />
          <stop offset="100%" stopColor="var(--grok-surface)" />
        </linearGradient>
      </defs>

      {/* 轨迹虚线：暗示"接下来会有内容落在纸上" */}
      <path
        d="M18 118 C 60 118, 74 92, 104 92"
        fill="none"
        stroke="var(--grok-line-strong)"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeDasharray="3 6"
        className="home__empty-art-dash"
      />

      {/* 底层两张纸 */}
      <rect x="52" y="26" width="104" height="78" rx="10" fill="var(--grok-surface)" stroke="var(--grok-line)" strokeWidth="1.25" transform="rotate(-6 104 65)" />
      <rect x="58" y="30" width="104" height="78" rx="10" fill="var(--grok-surface)" stroke="var(--grok-line)" strokeWidth="1.25" transform="rotate(3 110 69)" />

      {/* 主体纸 */}
      <g>
        <rect x="66" y="24" width="104" height="80" rx="10" fill="url(#ob-empty-sheet)" stroke="var(--grok-line-strong)" strokeWidth="1.25" />
        {/* 折角 */}
        <path d="M148 24 L170 46 L148 46 Z" fill="var(--grok-hover)" stroke="var(--grok-line-strong)" strokeWidth="1.25" strokeLinejoin="round" />
        {/* 文本行 */}
        <rect x="80" y="44" width="58" height="5" rx="2.5" fill="var(--grok-line-strong)" opacity="0.55" />
        <rect x="80" y="57" width="76" height="5" rx="2.5" fill="var(--grok-line)" />
        <rect x="80" y="70" width="66" height="5" rx="2.5" fill="var(--grok-line)" />
        <rect x="80" y="83" width="40" height="5" rx="2.5" fill="var(--grok-line)" />
      </g>

      {/* 笔 */}
      <g className="home__empty-art-pen" transform="rotate(38 176 92)">
        <rect x="170" y="58" width="9" height="44" rx="4.5" fill="var(--grok-card)" stroke="var(--grok-line-strong)" strokeWidth="1.25" />
        <path d="M170 102 L179 102 L174.5 112 Z" fill="var(--grok-ink)" />
        <rect x="170" y="62" width="9" height="7" rx="2" fill="var(--grok-ink)" />
      </g>

      {/* 纸上的小勾 */}
      <circle cx="156" cy="88" r="9" fill="var(--grok-ink)" opacity="0.92" />
      <path d="M151.5 88 L154.6 91.1 L160.6 84.6" fill="none" stroke="var(--grok-ink-fg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
