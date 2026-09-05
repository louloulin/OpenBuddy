/**
 * @openbuddy/ui-home/client — React provider + apply().
 *
 * The home package doesn't own any global React state. The home page
 * pieces are mounted by their consumers. The apply() body is reserved
 * for future slot registration.
 */

import type { ReactNode } from "react";
import type { SlotMap, UiRuntimeContext } from "@openbuddy/ui-slots";

export interface HomeProviderProps {
  children: ReactNode;
}

/** No-op provider kept for parity with sibling packages. */
export function HomeProvider({ children }: HomeProviderProps) {
  return <>{children}</>;
}

declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /** Root-scoped region for the home page. */
    "home.page": {
      kind: "single";
      scope: "root";
      owner: object;
    };
    /** Root-scoped region for the scene tabs row. */
    "home.scene-tabs": {
      kind: "single";
      scope: "root";
      owner: object;
    };
    /** Root-scoped region for the practice cases recommendation strip. */
    "home.practice-cases": {
      kind: "single";
      scope: "root";
      owner: object;
    };
  }
}

export function apply(ctx: UiRuntimeContext): () => void {
  const disposers: Array<() => void> = [];
  void ctx;
  return () => {
    for (const d of disposers) d();
  };
}
