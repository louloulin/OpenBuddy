import type { Automation } from "@openbuddy/protocol/dto";

/**
 * 保存为自动化 (pii W4.3): a session's ⋯ menu hands a pre-filled draft to the automation panel.
 * The panel is mounted by navigation, so the patch travels through this one-shot slot.
 */
let pending: Partial<Automation> | undefined;

export function setPendingAutomationDraft(patch: Partial<Automation>) {
  pending = patch;
}

/** Read and clear the handoff; only the next mounted panel consumes it. */
export function takePendingAutomationDraft(): Partial<Automation> | undefined {
  const patch = pending;
  pending = undefined;
  return patch;
}
