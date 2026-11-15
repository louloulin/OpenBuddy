import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { WbExpertNavIcon } from "@openbuddy/ui/icon/icons/index";
import type { CapabilitySnapshot } from "../state/capabilities-store";

/**
 * FeatureRegistry (20261115-md R8, pii W0.2). Every entry point — sidebar item, 更多 menu
 * item, settings section, PlaceholderPage view — is declared once with the host commands
 * (and events) it needs. Entries whose `requires` the host does not serve are not rendered:
 * no "即将推出", no toast. When another module lands its commands, its entry appears by itself.
 */
export type FeaturePlatform = "desktop" | "web";

export interface NavSpec {
  label: string;
  /** Primary sidebar list, or the 更多 hover menu. */
  slot: "primary" | "more";
  order: number;
  /** One of the ui package's icons (all share this component type). */
  icon: typeof WbExpertNavIcon;
}

export interface SettingsSectionSpec {
  id: string;
  label: string;
  icon: LucideIcon;
  order: number;
  render: (props: { onModelsChanged?: () => void }) => ReactNode;
}

export interface FeatureEntry<RouteProps = unknown> {
  id: string;
  nav?: NavSpec;
  /** The PlaceholderPage view: `view` is the label it is opened with; `aliases` are legacy labels. */
  route?: { view: string; aliases?: string[]; render: (props: RouteProps) => ReactNode };
  settingsSections?: SettingsSectionSpec[];
  /** Host command names the entry needs (all of them). */
  requires: readonly string[];
  /** Host event names the entry needs (all of them). */
  requiresEvents?: readonly string[];
  platforms?: readonly FeaturePlatform[];
  /** Declared but never rendered: taken offline, files kept (plan D8). The text says why. */
  offline?: string;
}

export interface NavItem {
  id: string;
  label: string;
  icon: NavSpec["icon"];
}

const platformOf = (caps: CapabilitySnapshot): FeaturePlatform => (caps.platform === "desktop" ? "desktop" : "web");

/** Whether the connected host can serve this entry right now. */
export function isAvailable(entry: Pick<FeatureEntry, "requires" | "requiresEvents" | "platforms" | "offline">, caps: CapabilitySnapshot): boolean {
  if (entry.offline) return false;
  if (entry.platforms && !entry.platforms.includes(platformOf(caps))) return false;
  const events = entry.requiresEvents ?? [];
  if (!entry.requires.length && !events.length) return true;
  if (caps.status !== "ready") return false;
  return entry.requires.every((command) => caps.commands.has(command)) && events.every((event) => caps.events.has(event));
}

/** The missing command / event names (diagnostics, tests). */
export function missingFor(entry: Pick<FeatureEntry, "requires" | "requiresEvents">, caps: CapabilitySnapshot): string[] {
  return [...entry.requires.filter((c) => !caps.commands.has(c)), ...(entry.requiresEvents ?? []).filter((e) => !caps.events.has(e))];
}

/** Visible nav items of one slot, in order. */
export function navItems<P>(entries: readonly FeatureEntry<P>[], caps: CapabilitySnapshot, slot: NavSpec["slot"]): NavItem[] {
  return entries
    .filter((entry) => entry.nav?.slot === slot && isAvailable(entry, caps))
    .sort((a, b) => a.nav!.order - b.nav!.order)
    .map((entry) => ({ id: entry.id, label: entry.nav!.label, icon: entry.nav!.icon }));
}

/** Visible settings sections, in order. */
export function settingsSections<P>(entries: readonly FeatureEntry<P>[], caps: CapabilitySnapshot): SettingsSectionSpec[] {
  return entries
    .filter((entry) => entry.settingsSections?.length && isAvailable(entry, caps))
    .flatMap((entry) => entry.settingsSections!)
    .sort((a, b) => a.order - b.order);
}

/** The entry that owns a PlaceholderPage view (by label or legacy alias), available or not. */
export function routeEntry<P>(entries: readonly FeatureEntry<P>[], view: string): FeatureEntry<P> | undefined {
  return entries.find((entry) => entry.route && (entry.route.view === view || entry.route.aliases?.includes(view)));
}

/** The view to open for a label, or undefined when the host cannot serve it (navigation is refused). */
export function resolveView<P>(entries: readonly FeatureEntry<P>[], caps: CapabilitySnapshot, label: string): string | undefined {
  const entry = routeEntry(entries, label);
  return entry && isAvailable(entry, caps) ? entry.route!.view : undefined;
}
