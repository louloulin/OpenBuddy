import { useMemo } from "react";
import { useCapabilitiesStore, useCapabilitySnapshot } from "../state/capabilities-store";
import { FEATURES } from "./features";
import { navItems, resolveView, settingsSections } from "./registry";

/** Sidebar items, 更多 items and settings sections the connected host can serve (pii W0.2). */
export function useFeatureNav() {
  const { status, platform, commands, events } = useCapabilitySnapshot();
  return useMemo(() => {
    const snapshot = { status, platform, commands, events };
    return {
      primary: navItems(FEATURES, snapshot, "primary"),
      more: navItems(FEATURES, snapshot, "more"),
      sections: settingsSections(FEATURES, snapshot),
    };
  }, [status, platform, commands, events]);
}

/** The PlaceholderPage view for a label, or undefined when the host cannot serve it (navigation is refused). */
export const featureView = (label: string) => resolveView(FEATURES, useCapabilitiesStore.getState(), label);
