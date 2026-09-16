import { forwardRef } from "react";
import { createIcon } from "../Icon";

/**
 * CheckIcon —— 勾选图标。
 *
 * 注意 `{...props}` 必须保留:`createIcon` 会把 `size` 解析成 width/height
 * 之后传给这个 raw 组件。以前这里的签名是 `(_props, ref)`,props 被整个丢掉,
 * 于是渲染出的 `<svg>` 既没有 width 也没有 height —— 在 flex/网格容器里
 * 会被 CSS 撑到容器尺寸(实测「策略设置 → 策略检查」里变成 1042×1042 的
 * 绿色大三角)。图标组件一律要透传 props。
 */
const CheckIconRaw = forwardRef<SVGSVGElement>((props, ref) => (
  <svg
    ref={ref}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
));
CheckIconRaw.displayName = "CheckIconRaw";

export const CheckIcon = createIcon(CheckIconRaw);
