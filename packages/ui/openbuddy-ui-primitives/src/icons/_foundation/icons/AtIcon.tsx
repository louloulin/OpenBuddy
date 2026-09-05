import { forwardRef } from "react";
import { createIcon } from "../Icon";

const AtIconRaw = forwardRef<SVGSVGElement>((props, ref) => (
  <svg
    ref={ref}
    viewBox="0 0 24 24"
    fill="none"
    {...props}
  >
    <circle
      cx="12"
      cy="12"
      r="4"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
));
AtIconRaw.displayName = "AtIconRaw";

export const AtIcon = createIcon(AtIconRaw);
