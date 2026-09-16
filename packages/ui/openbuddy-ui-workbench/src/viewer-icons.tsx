/**
 * ViewerToolbar 专用内联图标。
 *
 * 为什么不全用 `@openbuddy/ui-primitives/icons`:该入口目前覆盖的是导航 /
 * 文件 / 助手语汇,没有复制、自动换行、缩放档位、适合宽度、分屏这类
 * 「查看器工具」图标。为避免为了 6 个 16px 线图标去扩公共图标库(那是
 * ui-primitives 的领地,不属于本包 scope),这里内联绘制。
 *
 * 统一规格:24×24 viewBox、`fill:none`、`stroke:currentColor`、
 * `stroke-width:1.5`、圆头圆角 —— 与 primitives 里 lucide 系图标
 * (strokeWidth 1.5)视觉一致,混排不突兀。
 */
import type { SVGProps } from "react";

type ViewerIconProps = SVGProps<SVGSVGElement>;

function LineIcon({ children, ...rest }: ViewerIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      width={14}
      height={14}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** 复制到剪贴板。 */
export function CopyIcon(props: ViewerIconProps) {
  return (
    <LineIcon {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </LineIcon>
  );
}

/** 自动换行开关。 */
export function WrapTextIcon(props: ViewerIconProps) {
  return (
    <LineIcon {...props}>
      <path d="M3 6h18" />
      <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
      <path d="m16 16-2 2 2 2" />
      <path d="M3 18h4" />
    </LineIcon>
  );
}

/** 放大。 */
export function ZoomInIcon(props: ViewerIconProps) {
  return (
    <LineIcon {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
      <path d="M11 8v6" />
      <path d="M8 11h6" />
    </LineIcon>
  );
}

/** 缩小。 */
export function ZoomOutIcon(props: ViewerIconProps) {
  return (
    <LineIcon {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
      <path d="M8 11h6" />
    </LineIcon>
  );
}

/** 重置缩放 / 适合宽度。 */
export function FitWidthIcon(props: ViewerIconProps) {
  return (
    <LineIcon {...props}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </LineIcon>
  );
}

/** 分屏（左右并排）。 */
export function SplitViewIcon(props: ViewerIconProps) {
  return (
    <LineIcon {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 3v18" />
    </LineIcon>
  );
}
