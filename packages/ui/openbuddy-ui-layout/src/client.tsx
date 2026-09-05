/**
 * @openbuddy/ui-layout/client — apply() registers AppFrame into the
 * `root` slot (declared by the SlotProvider boot). ui-sidebar / ui-conversation
 * / ui-workbench each register their component into the children slots.
 */

import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { AppFrame } from "./client/AppFrame";

export { AppFrame } from "./client/AppFrame";
export type { AppFrameProps } from "./client/AppFrame";

export function apply(ctx: UiRuntimeContext): () => void {
  const dispose = ctx.slots.register(
    {
      name: "root",
      children: {
        // The slot declarations for sidebar / conversation / details /
        // shell.overlay live in src/index.ts (SlotMap module augmentation).
        // They are typed; runtime spec values match the SlotEntryDef shape.
      } as never,
      registrant: "@openbuddy/ui-layout",
    },
    AppFrame as never
  );
  return dispose;
}
