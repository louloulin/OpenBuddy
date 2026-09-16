/**
 * ArtifactBreadcrumb —— 产物 / 文件查看器的面包屑。
 *
 * 参考 cabinet `src/components/layout/viewer-breadcrumb.tsx` 的「中间省略」策略:
 * 路径过深时把中间层折叠成一个 `…` 按钮,而不是让整行换行或横向滚动;
 * `…` 的 tooltip 列出被隐藏的层级,点击就地展开、再点收回。
 *
 * 与 cabinet 的差异:这里完全受控 —— 数据只来自 `segments`,不读全局 tree
 * store,符合 `packages/ui/AGENTS.md` 的「无全局 React context / 无包外单例」
 * 约束;消费方(workbench 宿主 / 其他 ui-* 包)自己把路径翻译成 segments。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "@openbuddy/ui-primitives/icons";
import { cx } from "./cx";
import styles from "./ArtifactBreadcrumb.module.css";

export interface ArtifactBreadcrumbSegment {
  /** 显示文案。 */
  label: string;
  /** 前置图标(可选)。 */
  icon?: ReactNode;
  /** 点击回调;未提供时该层级渲染为纯文本。 */
  onClick?: () => void;
  /** tooltip;未提供时回落到 `label`。 */
  title?: string;
}

export interface ArtifactBreadcrumbProps {
  segments: ArtifactBreadcrumbSegment[];
  /**
   * 可见层级上限(含最后一段)。默认 4:超出时折叠为
   * `首段 / … / 倒数第二段 / 末段`。
   */
  maxVisible?: number;
  /** `nav` 的 aria-label,默认「面包屑」。 */
  ariaLabel?: string;
  className?: string;
}

interface CrumbItem {
  key: string;
  kind: "segment" | "gap";
  segment?: ArtifactBreadcrumbSegment;
  /** gap 专用:被隐藏层级的文案(用于 tooltip)。 */
  hiddenLabels?: string[];
  /** gap 专用:当前是否已展开。 */
  expanded?: boolean;
  isLast?: boolean;
}

/**
 * 计算折叠后的可见项。纯函数(导出以便单测)。
 *
 * - 层级数不超过 `maxVisible`(或 `maxVisible < 2` 时折叠无意义)→ 全部展示;
 * - 否则保留首段 + 尾部 `maxVisible - 1` 段,中间收进一个 gap 项;
 * - `expanded` 为真时 gap 项保留在原位作为「收起」开关,中间层就地展开。
 */
export function buildBreadcrumbItems(
  segments: ArtifactBreadcrumbSegment[],
  maxVisible: number,
  expanded = false,
): CrumbItem[] {
  const total = segments.length;
  const toItem = (segment: ArtifactBreadcrumbSegment, index: number): CrumbItem => ({
    key: `${index}:${segment.label}`,
    kind: "segment",
    segment,
    isLast: index === total - 1,
  });

  if (total <= maxVisible || maxVisible < 2) return segments.map(toItem);

  const tailCount = maxVisible - 1;
  const hiddenEnd = total - tailCount;
  const hidden = segments.slice(1, hiddenEnd);
  const head = toItem(segments[0], 0);
  const gap: CrumbItem = {
    key: "__gap",
    kind: "gap",
    hiddenLabels: hidden.map((segment) => segment.label),
    expanded,
  };
  const tail = segments
    .slice(hiddenEnd)
    .map((segment, offset) => toItem(segment, hiddenEnd + offset));
  if (!expanded) return [head, gap, ...tail];
  const middle = hidden.map((segment, offset) => toItem(segment, offset + 1));
  return [head, gap, ...middle, ...tail];
}

export function ArtifactBreadcrumb({
  segments,
  maxVisible = 4,
  ariaLabel,
  className,
}: ArtifactBreadcrumbProps) {
  const [revealed, setRevealed] = useState(false);

  // 路径变化时回到折叠态,避免上一次的展开状态让新路径一上来就是长条。
  const signature = useMemo(
    () => segments.map((segment) => segment.label).join("\u0000"),
    [segments],
  );
  useEffect(() => {
    setRevealed(false);
  }, [signature]);

  if (!segments || segments.length === 0) return null;

  const items = buildBreadcrumbItems(segments, maxVisible, revealed);

  return (
    <nav
      aria-label={ariaLabel ?? "面包屑"}
      className={cx("artifact-breadcrumb", styles.root, className)}
    >
      <ol className={styles.list}>
        {items.map((item, index) => (
          <li key={item.key} className={styles.item}>
            {index > 0 ? (
              <ChevronRightIcon size="sm" className={styles.separator} aria-hidden="true" />
            ) : null}
            {item.kind === "gap" ? (
              <button
                type="button"
                className={cx(styles.crumb, styles.gap)}
                aria-label={
                  item.expanded
                    ? "收起路径"
                    : `展开被折叠的 ${item.hiddenLabels?.length ?? 0} 层路径`
                }
                aria-expanded={Boolean(item.expanded)}
                title={
                  item.expanded ? "收起路径" : (item.hiddenLabels ?? []).join(" / ")
                }
                data-tip={item.expanded ? "收起路径" : (item.hiddenLabels ?? []).join(" / ")}
                onClick={() => setRevealed((value) => !value)}
              >
                …
              </button>
            ) : item.isLast ? (
              <span
                className={cx(styles.crumb, styles.leaf)}
                aria-current="page"
                title={item.segment?.title ?? item.segment?.label}
              >
                {item.segment?.icon ? (
                  <span className={styles.icon}>{item.segment.icon}</span>
                ) : null}
                <span className={styles.label}>{item.segment?.label}</span>
              </span>
            ) : (
              <CrumbBody segment={item.segment as ArtifactBreadcrumbSegment} />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** 中间层级:有 onClick 用按钮,否则纯文本(不可点层级不做假交互)。 */
function CrumbBody({ segment }: { segment: ArtifactBreadcrumbSegment }) {
  const inner = (
    <>
      {segment.icon ? <span className={styles.icon}>{segment.icon}</span> : null}
      <span className={styles.label}>{segment.label}</span>
    </>
  );
  if (!segment.onClick) {
    return (
      <span className={cx(styles.crumb, styles.plain)} title={segment.title ?? segment.label}>
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={styles.crumb}
      title={segment.title ?? segment.label}
      data-tip={segment.title ?? segment.label}
      onClick={segment.onClick}
    >
      {inner}
    </button>
  );
}
