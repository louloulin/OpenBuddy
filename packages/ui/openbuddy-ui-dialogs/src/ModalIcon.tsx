import type { ConfirmTone } from "./ConfirmDialog";

interface ModalIconProps {
  tone: ConfirmTone;
  size?: number;
}

/**
 * 精致 SVG 图标 —— 取代字符 ?、!。
 * 圆角线条、currentColor 适配主题；统一尺寸与线宽，确保跨 tone 的视觉重量一致。
 */
export function ModalIcon({ tone, size = 22 }: ModalIconProps) {
  if (tone === "danger" || tone === "warning") {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3 L22 20 L2 20 Z" />
        <line x1="12" y1="10" x2="12" y2="14" />
        <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5 a2.5 2.5 0 1 1 4.5 1.5 c-1.5 1 -2 1.7 -2 3" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
