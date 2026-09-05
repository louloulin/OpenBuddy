import { forwardRef } from "react";
import { createIcon } from "../Icon";

/**
 * Restore (un-maximize) icon — four corner arrows pointing inward.
 * Used by the workspace panel's maximize toggle when already maximized.
 */
const RestoreIconRaw = forwardRef<SVGSVGElement>((props, ref) => (
  <svg
    ref={ref}
    viewBox="0 0 16 16"
    fill="none"
    {...props}
  >
    <path
      d="M6 2V5.5C6 5.77614 5.77614 6 5.5 6H2M10 2V5.5C10 5.77614 10.2239 6 10.5 6H14M14 10H10.5C10.2239 10 10 10.2239 10 10.5V14M6 14V10.5C6 10.2239 5.77614 10 5.5 10H2"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
));
RestoreIconRaw.displayName = "RestoreIconRaw";

export const RestoreIcon = createIcon(RestoreIconRaw);
