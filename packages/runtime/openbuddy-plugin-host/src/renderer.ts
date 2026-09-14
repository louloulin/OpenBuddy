/**
 * Renderer-safe facade for `@openbuddy/plugin-host`.
 *
 * The full `index.ts` entry point re-exports server-only modules such as
 * `./include` and `./profile` that pull `node:fs/promises`, `node:path`, and
 * `node:url` into the graph. The renderer build target treats those as
 * `__vite-browser-external` shims that don't export the named symbols the
 * main bundle does, so importing the full entry from a renderer module
 * blows up rollup with `isAbsolute is not exported by __vite-browser-external`.
 *
 * This file only re-exports the renderer-safe symbols:
 *
 *   - Type-only exports (`PluginSnapshot`, `HarnessPlugin`, etc.) are
 *     erased at compile time and are safe regardless.
 *   - Runtime helpers that the UI bundle actually consumes
 *     (`isPassthroughed`, the manifest schema/serializer/validator) live
 *     in `./openbuddy-plugin-manifest.ts` and `./pi-passthrough.ts`, which
 *     are pure and have no node-only imports.
 *
 * `electron.vite.config.ts` aliases `@openbuddy/plugin-host` to this file
 * inside the renderer build so the UI never accidentally pulls the
 * server-only graph.
 */

export type {
  PluginEntryOptions,
  PluginProfile,
  PluginReadinessSnapshot,
  PluginSnapshot,
  PluginSnapshotRecovery,
  HarnessPlugin,
} from "./index";

export { isPassthroughed } from "./pi-passthrough";

export {
  openbuddyPluginManifestSchema,
  validateOpenBuddyPluginManifest,
  serializeSlotTrack,
  type OpenBuddyPluginManifest,
  type SerializedSlotTrack,
} from "./openbuddy-plugin-manifest";
