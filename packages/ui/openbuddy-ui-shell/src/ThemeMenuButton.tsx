/**
 * @openbuddy/ui-shell/ThemeMenuButton — 顶栏主题入口。
 *
 * 复用 `@openbuddy/ui-theme/components` 的 <ThemePicker>(Phase A 交付):
 * 它本身就是一个「图标按钮 + portal 弹层」,已实现 outside-click / Esc 关闭、
 * 17 套主题按浅/深分组、Match-system 双主题配对。**不再套第二层 popover** ——
 * 那会出现「弹层里还有一枚触发器」的双层菜单,反而更差。
 *
 * 本组件补三件顶栏特有的事:
 *   1. 顶栏视觉语言:统一的 data-tip / data-testid / 外层 class;
 *   2. 容错:宿主若没挂 ThemeProvider(第三方壳 + 裸 SlotTree),ThemePicker 的
 *      useTheme() 会抛错;这里用 ErrorBoundary 降级成一枚禁用按钮,避免整条
 *      顶栏跟着崩掉;
 *   3. `onOpenChange` 透出:宿主可据此关闭其它弹层 / 上报遥测。
 *
 * 说明:`@openbuddy/ui-theme/components` 的 tsconfig path 由
 * `scripts/sync-ui-aliases.mjs` 自动注入本包,已确认存在,不需要动态 import 兜底。
 */
import { ThemePicker } from "@openbuddy/ui-theme/components";
import { ThemeBoundary } from "./ThemeBoundary";
import styles from "./ThemeMenuButton.module.css";

export interface ThemeMenuButtonProps {
  /** 无障碍标签 + tooltip,默认「切换主题」。 */
  label?: string;
  className?: string;
  onOpenChange?(open: boolean): void;
}

export function ThemeMenuButton({
  label = "切换主题",
  className,
  onOpenChange,
}: ThemeMenuButtonProps) {
  const fallback = (
    <button
      type="button"
      className={styles.button + " " + styles.buttonDisabled}
      aria-label={label}
      data-tip="主题不可用"
      data-testid="theme-menu-fallback"
      disabled
    >
      <SparkleGlyph />
    </button>
  );

  return (
    <span
      className={styles.host + (className ? " " + className : "")}
      data-testid="theme-menu-button"
    >
      <ThemeBoundary fallback={fallback}>
        <ThemePicker compact label={label} onOpenChange={onOpenChange} />
      </ThemeBoundary>
    </span>
  );
}

/** 内联 glyph —— 不额外依赖 ui-primitives 的图标(保持本文件零图标耦合)。 */
function SparkleGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4L12 3Z" />
      <path d="M18 16.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9Z" />
    </svg>
  );
}
