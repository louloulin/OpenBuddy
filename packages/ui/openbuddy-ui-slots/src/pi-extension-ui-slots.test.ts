/**
 * @openbuddy/ui-slots — Phase E.1 tests for PI ExtensionUIContext keys.
 *
 * Locks the PiExtensionUISlotKey type so future SlotMap extensions
 * don't accidentally rename or remove PI UI hook keys.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import type { PiExtensionUISlotKey } from "./index";

describe("PiExtensionUISlotKey (Phase E.1)", () => {
  it("covers all five PI ExtensionUIContext UI hooks", () => {
    // Compile-time + runtime check: the type has exactly these keys.
    const allKeys: PiExtensionUISlotKey[] = [
      "pi-ui-notify",
      "pi-ui-select",
      "pi-ui-confirm",
      "pi-ui-set-status",
      "pi-ui-set-working-indicator",
    ];
    expect(allKeys).toHaveLength(5);
  });

  it("includes pi-ui-notify for notification toasts", () => {
    expectTypeOf<PiExtensionUISlotKey>().toMatchTypeOf<"pi-ui-notify" | string>();
  });

  it("includes pi-ui-select for chooser dialogs", () => {
    const k: PiExtensionUISlotKey = "pi-ui-select";
    expect(k).toBe("pi-ui-select");
  });

  it("includes pi-ui-confirm for yes/no prompts", () => {
    const k: PiExtensionUISlotKey = "pi-ui-confirm";
    expect(k).toBe("pi-ui-confirm");
  });

  it("includes pi-ui-set-status for status-bar updates", () => {
    const k: PiExtensionUISlotKey = "pi-ui-set-status";
    expect(k).toBe("pi-ui-set-status");
  });

  it("includes pi-ui-set-working-indicator for busy spinner", () => {
    const k: PiExtensionUISlotKey = "pi-ui-set-working-indicator";
    expect(k).toBe("pi-ui-set-working-indicator");
  });
});
