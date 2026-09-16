/**
 * @openbuddy/ui-files-tree/client — apply() registers FileTree on `files.tree`.
 *
 * The component is registered as one entry in the `files.tree` single slot.
 * A host (ui-files or a third-party plugin) can override it at a higher
 * priority; unloading the plugin restores this built-in.
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { FileTree } from "./components/FileTree";

export function apply(ctx: UiRuntimeContext): () => void {
  const dispose = ctx.slots.register(
    {
      name: "files.tree",
      kind: "single",
      scope: "session-maybe",
      registrant: "@openbuddy/ui-files-tree",
    },
    FileTree as never,
  );
  return dispose;
}
