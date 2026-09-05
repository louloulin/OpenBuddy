import { forwardRef } from "react";
import { createIcon } from "../Icon";

/**
 * Maximize (expand) icon — four corner arrows pointing outward.
 * Used by the workspace panel's maximize toggle.
 */
const MaximizeIconRaw = forwardRef<SVGSVGElement>((props, ref) => (
  <svg
    ref={ref}
    viewBox="0 0 16 16"
    fill="none"
    {...props}
  >
    <path
      d="M2 6V2.5C2 2.22386 2.22386 2 2.5 2H6M10 2H13.5C13.7761 2 14 2.22386 14 2.5V6M14 10V13.5C14 13.7761 13.7761 14 13.5 14H10M6 14H2.5C2.22386 14 2 13.7761 2 13.5V10"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
));
MaximizeIconRaw.displayName = "MaximizeIconRaw";

export const MaximizeIcon = createIcon(MaximizeIconRaw);
