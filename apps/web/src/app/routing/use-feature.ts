import { useCapabilitySnapshot } from "../state/capabilities-store";
import { capabilityFeature, type CapabilityFeatureId } from "./capability-features";
import { isAvailable } from "./registry";

/**
 * Whether a capability entry (e.g. "session-search") is served right now (pii W0.2).
 * Separate from use-feature-nav.ts so surfaces inside panels can use it without importing
 * every panel through features.tsx.
 */
export function useFeature(id: CapabilityFeatureId): boolean {
  return isAvailable(capabilityFeature(id), useCapabilitySnapshot());
}
