/**
 * packages/ui/openbuddy-ui-runtime/src/slot-plugin-manifest.ts
 *
 * Phase K.2 — Slot track manifest for builtin `@openbuddy/ui-*` packages.
 *
 * The v6 plan re-centres Phase K around a thin manifest serialization
 * helper that produces loadable artifacts for PI's `loadExtensions()` (or
 * the equivalent runtime face). On the renderer side the equivalent face
 * is `UiPlugin.apply(ctx, config?)`. This module is the **slot track**
 * adapter for the Phase K.1 SDK:
 *
 *   - it wraps each `@openbuddy/ui-*` package's apply() in an
 *     `OpenBuddyPluginManifest` slot track
 *   - it lets `client.tsx`'s `registerAllBuiltinUis()` look up packages
 *     through the same `serializeSlotTrack` helper the SDK exposes
 *   - it keeps the hand-curated `BUILTIN_UI_APPLIES` list as the source
 *     of truth for ordering + package identity (L.1/L.2 already locked
 *     that contract)
 *
 * Why not move the manifest table to `openbuddy-plugin-host`?
 * The slot track only exists in the renderer process; pulling the
 * dependency would force the host package to reach into renderer-side
 * types. The K.1 SDK exports `serializeSlotTrack` from
 * `@openbuddy/plugin-host` so this module reuses it without duplicating
 * the manifest shape definition.
 */

import {
  openbuddyPluginManifestSchema,
  serializeSlotTrack,
  validateOpenBuddyPluginManifest,
  type OpenBuddyPluginManifest,
  type SerializedSlotTrack,
} from "@openbuddy/plugin-host";
import type { UiPlugin } from "@openbuddy/ui-slots";

/**
 * Wraps a builtin `@openbuddy/ui-*` package's `apply()` as an
 * OpenBuddyPlugin slot track. The shape mirrors the K.1 SDK
 * `OpenBuddyPluginManifest` so the resolver in `client.tsx` can keep a
 * single mental model for every track (pi / harness / slot / cordis).
 *
 * `apply` is intentionally mutable so the builtin-applies test suite can
 * patch individual entries without forking the table. All other fields
 * are readonly metadata.
 */
export interface BuiltinUiPluginSlotTrack {
  /** NPM package id (e.g. `@openbuddy/ui-account`). Used as the slot
   *  track's `source` and `packageName`. */
  readonly pkg: string;
  /** The package's `apply(ctx, config?)` implementation. */
  apply: UiPlugin["apply"];
  /** Optional display description used by inventory + docs. */
  readonly description?: string;
  /** Optional config defaults merged into the loadable track row. */
  readonly configDefaults?: Record<string, unknown>;
}

/** Manifest produced from a slot track row. Round-trips through
 *  `validateOpenBuddyPluginManifest` so the SDK's invariants stay
 *  enforced even when the manifest originates in the renderer. */
export function toOpenBuddyPluginManifest(track: BuiltinUiPluginSlotTrack): OpenBuddyPluginManifest {
  return validateOpenBuddyPluginManifest({
    schema: openbuddyPluginManifestSchema,
    id: track.pkg,
    packageName: track.pkg,
    version: "0.0.0",
    ...(track.description ? { description: track.description } : {}),
    tracks: [
      {
        kind: "slot",
        source: track.pkg,
        ...(track.configDefaults ? { config: { defaults: track.configDefaults } } : {}),
      },
    ],
  });
}

/** Serialise a builtin slot track row. The returned row is ready to be
 *  passed to `UiRuntime.registerBuiltinUi()` or persisted to the
 *  renderer-side plugin inventory. */
export function serializeBuiltinUiSlotTrack(track: BuiltinUiPluginSlotTrack): SerializedSlotTrack {
  const [row] = serializeSlotTrack(toOpenBuddyPluginManifest(track));
  if (!row) throw new Error(`slot-plugin-manifest: ${track.pkg} did not serialise to a slot track row`);
  return row;
}