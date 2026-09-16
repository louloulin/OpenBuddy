/**
 * ArtifactViewerHeader —— 查看器头部条,直接坐在 `ArtifactTabsBar` 下方。
 *
 * 结构(参考 cabinet 的 `ViewerToolbar` 单行式头部,但拆成可独立复用的三段):
 *
 *   [ 面包屑 ....................... 状态徽标 | 次级文案 | 查看器工具栏 ]
 *
 * 之所以拆成独立组件而不是塞进 `ArtifactTabsBar`:标签条管「打开了哪些」,
 * 头部条管「当前这个是什么、能对它做什么」,两者生命周期与消费方都不同
 * (标签条在 conversation 的 ToolSidePanel,头部条在具体查看器里)。
 */
import type { ReactNode } from "react";
import {
  ArtifactBreadcrumb,
  type ArtifactBreadcrumbSegment,
} from "./ArtifactBreadcrumb";
import { cx } from "./cx";
import { ViewerToolbar, type ViewerToolbarProps } from "./ViewerToolbar";
import styles from "./ArtifactViewerHeader.module.css";

export type ArtifactViewerStatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export interface ArtifactViewerStatus {
  label: string;
  tone?: ArtifactViewerStatusTone;
  title?: string;
}

export interface ArtifactViewerHeaderProps {
  /** 面包屑层级;空数组时左侧留白(查看器尚未解析出路径)。 */
  segments: ArtifactBreadcrumbSegment[];
  maxVisible?: number;
  /** 右侧状态徽标(如「已同步」「解析中」「预览不可用」)。 */
  status?: ArtifactViewerStatus;
  /** 右侧次级文案(文件大小 / 修改时间 / 页数)。 */
  meta?: ReactNode;
  /** 查看器工具栏的全部 props;不传则不渲染工具栏。 */
  toolbar?: ViewerToolbarProps;
  className?: string;
}

export function ArtifactViewerHeader({
  segments,
  maxVisible,
  status,
  meta,
  toolbar,
  className,
}: ArtifactViewerHeaderProps) {
  const tone = status?.tone ?? "neutral";
  return (
    <div
      className={cx("artifact-viewer-header", styles.root, className)}
      data-status-tone={status ? tone : undefined}
    >
      <div className={styles.left}>
        <ArtifactBreadcrumb
          segments={segments}
          maxVisible={maxVisible}
          className={styles.breadcrumb}
        />
      </div>
      <div className={styles.right}>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
        {status ? (
          <span
            className={cx(styles.chip, styles[tone])}
            title={status.title ?? status.label}
            data-tip={status.title ?? status.label}
          >
            {status.label}
          </span>
        ) : null}
        {toolbar ? <ViewerToolbar {...toolbar} className={styles.toolbar} /> : null}
      </div>
    </div>
  );
}
