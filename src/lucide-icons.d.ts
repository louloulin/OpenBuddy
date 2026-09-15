// Phase A4 — ambient declaration so per-icon deep imports
// (`lucide-react/dist/esm/icons/<name>`) type-check. lucide-react only
// ships type definitions for the barrel entry; deep paths intentionally
// resolve to the same `ForwardRefExoticComponent<LucideProps>` component
// type that the barrel exports.

declare module "lucide-react/dist/esm/icons/bot" {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";
  type LucideProps = SVGProps<SVGSVGElement> & {
    size?: number;
    color?: string;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
    className?: string;
  };
  const Icon: ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>;
  export default Icon;
}
declare module "lucide-react/dist/esm/icons/file-diff" {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";
  type LucideProps = SVGProps<SVGSVGElement> & {
    size?: number;
    color?: string;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
    className?: string;
  };
  const Icon: ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>;
  export default Icon;
}
declare module "lucide-react/dist/esm/icons/folder-tree" {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";
  type LucideProps = SVGProps<SVGSVGElement> & {
    size?: number;
    color?: string;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
    className?: string;
  };
  const Icon: ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>;
  export default Icon;
}
declare module "lucide-react/dist/esm/icons/globe" {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";
  type LucideProps = SVGProps<SVGSVGElement> & {
    size?: number;
    color?: string;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
    className?: string;
  };
  const Icon: ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>;
  export default Icon;
}
declare module "lucide-react/dist/esm/icons/list-todo" {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";
  type LucideProps = SVGProps<SVGSVGElement> & {
    size?: number;
    color?: string;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
    className?: string;
  };
  const Icon: ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>;
  export default Icon;
}
declare module "lucide-react/dist/esm/icons/package" {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";
  type LucideProps = SVGProps<SVGSVGElement> & {
    size?: number;
    color?: string;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
    className?: string;
  };
  const Icon: ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>;
  export default Icon;
}
declare module "lucide-react/dist/esm/icons/search" {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";
  type LucideProps = SVGProps<SVGSVGElement> & {
    size?: number;
    color?: string;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
    className?: string;
  };
  const Icon: ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>;
  export default Icon;
}
declare module "lucide-react/dist/esm/icons/users" {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";
  type LucideProps = SVGProps<SVGSVGElement> & {
    size?: number;
    color?: string;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
    className?: string;
  };
  const Icon: ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>;
  export default Icon;
}