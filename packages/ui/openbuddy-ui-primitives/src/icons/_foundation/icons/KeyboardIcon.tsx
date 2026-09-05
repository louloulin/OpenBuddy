import { forwardRef } from "react";
import { createIcon } from "../Icon";

const KeyboardIconRaw = forwardRef<SVGSVGElement>((props, ref) => (
  <svg
    ref={ref}
    viewBox="0 0 24 24"
    fill="none"
    {...props}
  >
    <rect
      x="2"
      y="6"
      width="20"
      height="12"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M10 14h.01M14 14h.01M18 14h.01M7 18h10"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
));
KeyboardIconRaw.displayName = "KeyboardIconRaw";

export const KeyboardIcon = createIcon(KeyboardIconRaw);
