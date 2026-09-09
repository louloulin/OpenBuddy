/**
 * @openbuddy/plugin-sdk — public surface (Phase K.1, DSH v6 §25).
 *
 * The SDK is a thin manifest serializer. It does NOT install plugins
 * into a microkernel — that remains PI's `loadExtensions()` job.
 * Consumers parse a `plugin.json` (or a `package.json#openbuddy` block),
 * run it through the serializer, and receive an `ExtensionFactory` that
 * can be handed to PI directly. The four-track shape (`pi` / `cordis` /
 * `ui` / `harness`) is preserved so the descriptor surfaces the
 * capabilities a plugin opts into.
 *
 * Sub-path exports:
 *   - `@openbuddy/plugin-sdk/manifest` — zod schema + parsers
 *   - `@openbuddy/plugin-sdk/serializer` — manifest → ExtensionFactory
 *   - `@openbuddy/plugin-sdk/types` — TS contracts only (zero runtime)
 *   - `@openbuddy/plugin-sdk/schema` — re-export of the zod schema
 */
export {
  OPENBUDDY_PLUGIN_PROTOCOL,
  OPENBUDDY_PLUGIN_SCHEMA,
  openBuddyPluginTracks,
  type ExtensionApiStub,
  type OpenBuddyCordisSink,
  type OpenBuddyHarnessDeclaration,
  type OpenBuddyHarnessSink,
  type OpenBuddyPlugin,
  type OpenBuddyPluginTrack,
  type OpenBuddySerializablePlugin,
  type OpenBuddySerializedExtensionFactory,
  type OpenBuddySerializedPlugin,
  type OpenBuddySlotContribution,
  type OpenBuddySlotMap,
  type OpenBuddyUISink,
} from "./types";

export {
  detectTracks,
  parsePluginManifest,
  parsePluginPackageJson,
  parseSlotContribution,
  PluginManifestError,
  pluginManifestSchema,
  packageJsonShapeSchema,
  manifestCoreSchema,
  type PluginManifestInput,
  type PackageJsonInput,
} from "./manifest";

export {
  drainPendingDiagnostics,
  identityPathResolver,
  isSerializedPlugin,
  manifestToExtensionFactory,
  SERIALIZER_PROTOCOL,
  SERIALIZER_SCHEMA,
  serializePluginManifest,
  setDiagnosticSink,
  type ManifestPathResolver,
} from "./serializer";
