import { forwardRef } from "react";
import { createIcon } from "../Icon";

const CloseIconRaw = forwardRef<SVGSVGElement>((props, ref) => (
  <svg
    ref={ref}
    viewBox="0 0 16 16"
    fill="none"
    {...props}
  >
    <path
      d="M4 4L12 12M12 4L4 12"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
));
CloseIconRaw.displayName = "CloseIconRaw";

export const CloseIcon = createIcon(CloseIconRaw);
