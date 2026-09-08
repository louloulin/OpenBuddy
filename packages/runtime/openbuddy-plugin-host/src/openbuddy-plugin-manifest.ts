/**
 * openbuddy-plugin-manifest — Phase K.1 SDK (manifest serialization helper).
 *
 * Per v6 §3.4 of OPENBUDDY_PI_NATIVE_PLAN.md, the OpenBuddyPlugin SDK is a
 * thin **manifest serialization helper** for PI native plugins. It does not
 * own the loading pipeline; PI's `loadExtensions()` (or the existing
 * `discoverAndLoadExtensions()`) still does the actual loading. K.2 then
 * rewires the three builtin extension entry points (`pi-extensions.ts`,
 * `init-deepseek.ts`, and the renderer's slot apply) so they each project
 * through this SDK instead of hand-rolling their own metadata.
 *
 * The SDK exposes four contracts:
 *   - `OpenBuddyPluginManifest`  — canonical manifest shape (id + tracks)
 *   - `serializePiTrack`         — produce the PI extension entry
 *   - `serializeHarnessTrack`    — produce the HarnessPluginEntry patch row
 *   - `serializeSlotTrack`       — produce the renderer's apply() descriptor
 *
 * All three serializers take a single `OpenBuddyPluginManifest` and return
 * a format the host loader already understands. No new runtime types leak
 * out of this module — the SDK is intentionally read-mostly after Phase K.
 *
 * Why the v6 redesign: v5 wanted the SDK to also own the loading. v6
 * clarifies that the SDK should stay small (manifest in → loadable rows
 * out) so DSH retire rounds can swap the loader without touching the SDK.
 */

export const openbuddyPluginManifestSchema = "openbuddy.plugin.v1" as const;

/** Tracks a plugin can declare. Each track maps to a host loader:
 *  - "pi"      → ExtensionFactory consumed by `loadExtensions()`
 *  - "harness" → PluginEntryOptions consumed by HarnessPluginLoader
 *  - "slot"    → UiPlugin.apply() consumed by ui-runtime's SlotProvider
 *  - "cordis"  → Cordis plugin shape consumed by ctx.plugin()
 */
export type OpenBuddyPluginTrackKind = "pi" | "harness" | "slot" | "cordis";

/** Configuration payload a track receives at load time. Tracks that ignore
 *  config (e.g. slot apply() that only contributes UI widgets) can omit
 *  the field; tracks that require it (e.g. apply-patch's `trustedCwd`)
 *  declare it here for serialization + validation. */
export interface OpenBuddyPluginTrackConfig {
  /** Schema identifier; runtime decides whether to apply JSON-schema or
   *  a Zod validator. Strings are preferred for cross-version stability. */
  schema?: string;
  /** Optional default config the host applies when the user didn't supply
   *  one. The serializer merges this under the spec's `config`. */
  defaults?: Record<string, unknown>;
}

/** One track on a plugin manifest. Exactly one of `inline` (built-in)
 *  and `source` (path to a module / package the loader imports) MUST be
 *  set; the serializer returns an error otherwise so the v6 invariant
 *  "no dead-code path" is enforced at build time. */
export interface OpenBuddyPluginTrack {
  kind: OpenBuddyPluginTrackKind;
  /** Built-in factory the host loader recognises by id. */
  inline?: string;
  /** Module path the host loader imports. */
  source?: string;
  /** Optional manifest entry name (defaults to `id` when omitted). */
  name?: string;
  /** Optional config payload; merged with `config.defaults`. */
  config?: OpenBuddyPluginTrackConfig;
  /** Optional explicit dependencies; loader treats them as inject hints. */
  inject?: readonly string[];
  /** Disabled entries are validated but not loaded. */
  disabled?: boolean;
}

export interface OpenBuddyPluginManifest {
  schema: typeof openbuddyPluginManifestSchema;
  id: string;
  /** Package the manifest belongs to (e.g. "@openbuddy/builtin-apply-patch"). */
  packageName?: string;
  /** Semantic version of the plugin, surfaced in inventory and CLI output. */
  version?: string;
  /** Tracks this plugin contributes. Empty array is valid (placeholder). */
  tracks: readonly OpenBuddyPluginTrack[];
  /** Optional human-readable description used by inventory + docs. */
  description?: string;
  /** Optional compatibility flags. `passthrough` mirrors the spec's flag. */
  flags?: { readonly [key: string]: unknown };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class OpenBuddyPluginManifestError extends Error {
  constructor(manifestId: string, message: string) {
    super(`openbuddy-plugin-manifest: ${manifestId} ${message}`);
    this.name = "OpenBuddyPluginManifestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function recordArrayField(
  manifest: OpenBuddyPluginManifest,
  trackIndex: number,
  field: string,
  value: unknown,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new OpenBuddyPluginManifestError(manifest.id, `track[${trackIndex}].${field} must be an array of strings`);
  }
  return [...value];
}

/** Validate an OpenBuddyPluginManifest. Throws on shape violations so the
 *  builtin resolution path can rely on a typed output without re-checking. */
export function validateOpenBuddyPluginManifest(input: unknown): OpenBuddyPluginManifest {
  if (!isRecord(input)) {
    throw new OpenBuddyPluginManifestError("<unknown>", "manifest must be an object");
  }
  const id = input.id;
  if (typeof id !== "string" || !id.trim()) {
    throw new OpenBuddyPluginManifestError("<unknown>", "manifest.id must be a non-empty string");
  }
  if (input.schema !== openbuddyPluginManifestSchema) {
    throw new OpenBuddyPluginManifestError(
      id,
      `manifest.schema must be "${openbuddyPluginManifestSchema}" (got ${JSON.stringify(input.schema)})`,
    );
  }
  const tracksRaw = input.tracks;
  if (!Array.isArray(tracksRaw) || tracksRaw.length === 0) {
    throw new OpenBuddyPluginManifestError(id, "manifest.tracks must be a non-empty array");
  }
  const tracks: OpenBuddyPluginTrack[] = tracksRaw.map((entry, trackIndex) => {
    if (!isRecord(entry)) {
      throw new OpenBuddyPluginManifestError(id, `track[${trackIndex}] must be an object`);
    }
    if (entry.kind !== "pi" && entry.kind !== "harness" && entry.kind !== "slot" && entry.kind !== "cordis") {
      throw new OpenBuddyPluginManifestError(
        id,
        `track[${trackIndex}].kind must be one of pi|harness|slot|cordis (got ${JSON.stringify(entry.kind)})`,
      );
    }
    const inline = entry.inline;
    const source = entry.source;
    if ((inline === undefined) === (source === undefined)) {
      throw new OpenBuddyPluginManifestError(
        id,
        `track[${trackIndex}] (kind=${entry.kind}) must declare exactly one of inline or source`,
      );
    }
    if (inline !== undefined && typeof inline !== "string") {
      throw new OpenBuddyPluginManifestError(id, `track[${trackIndex}].inline must be a string when present`);
    }
    if (source !== undefined && typeof source !== "string") {
      throw new OpenBuddyPluginManifestError(id, `track[${trackIndex}].source must be a string when present`);
    }
    const config = entry.config;
    let normalizedConfig: OpenBuddyPluginTrackConfig | undefined;
    if (config !== undefined) {
      if (!isRecord(config)) {
        throw new OpenBuddyPluginManifestError(id, `track[${trackIndex}].config must be an object when present`);
      }
      normalizedConfig = {
        ...(typeof config.schema === "string" ? { schema: config.schema } : {}),
        ...(isRecord(config.defaults) ? { defaults: { ...config.defaults } } : {}),
      };
    }
    return {
      kind: entry.kind,
      ...(inline !== undefined ? { inline } : {}),
      ...(source !== undefined ? { source } : {}),
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      ...(normalizedConfig ? { config: normalizedConfig } : {}),
      ...(recordArrayField({ id } as OpenBuddyPluginManifest, trackIndex, "inject", entry.inject) === undefined
        ? {}
        : { inject: recordArrayField({ id } as OpenBuddyPluginManifest, trackIndex, "inject", entry.inject)! }),
      ...(entry.disabled === true ? { disabled: true } : {}),
    };
  });
  const flags = isRecord(input.flags) ? { ...input.flags } : undefined;
  return {
    schema: openbuddyPluginManifestSchema,
    id,
    ...(typeof input.packageName === "string" ? { packageName: input.packageName } : {}),
    ...(typeof input.version === "string" ? { version: input.version } : {}),
    tracks,
    ...(typeof input.description === "string" ? { description: input.description } : {}),
    ...(flags ? { flags } : {}),
  };
}

// ---------------------------------------------------------------------------
// Track serialization
// ---------------------------------------------------------------------------

/** Serialized PI track output. The shape matches what `loadExtensions()`
 *  already consumes (`ExtensionFactory` + `cwd` + config), so consumers
 *  can hand it straight to the runner. */
export interface SerializedPiTrack {
  id: string;
  source: string;
  name?: string;
  config?: Record<string, unknown>;
  inject?: readonly string[];
  disabled?: boolean;
  /** The track that produced this entry. Useful for diagnostics. */
  trackKind: "pi";
}

export interface SerializedHarnessTrack {
  id: string;
  name: string;
  config?: Record<string, unknown>;
  inject?: readonly string[];
  disabled?: boolean;
  trackKind: "harness";
}

export interface SerializedSlotTrack {
  id: string;
  packageName?: string;
  /** Module path the renderer imports at apply time. */
  source: string;
  /** Apply the plugin's apply(ctx, config) directly when no dynamic
   *  import is needed (e.g. for in-process builtin ui-* packages). */
  apply?: unknown;
  config?: Record<string, unknown>;
  disabled?: boolean;
  trackKind: "slot";
}

export interface SerializedCordisTrack {
  id: string;
  source: string;
  config?: Record<string, unknown>;
  inject?: readonly string[];
  disabled?: boolean;
  trackKind: "cordis";
}

export type SerializedTrack =
  | SerializedPiTrack
  | SerializedHarnessTrack
  | SerializedSlotTrack
  | SerializedCordisTrack;

function mergedConfig(track: OpenBuddyPluginTrack): Record<string, unknown> | undefined {
  if (!track.config) return undefined;
  if (!track.config.defaults) return undefined;
  return { ...track.config.defaults };
}

/** Resolve a single manifest into the loadable entries for one track kind.
 *  Returns an empty array when no track of that kind is declared. */
export function serializePiTrack(manifest: OpenBuddyPluginManifest): readonly SerializedPiTrack[] {
  return manifest.tracks.filter((track): track is OpenBuddyPluginTrack & { kind: "pi" } => track.kind === "pi").map((track) => {
    if (!track.inline && !track.source) {
      throw new OpenBuddyPluginManifestError(manifest.id, `pi track is missing both inline and source`);
    }
    return {
      id: manifest.id,
      source: track.inline ?? track.source!,
      ...(track.name ? { name: track.name } : {}),
      ...(mergedConfig(track) ? { config: mergedConfig(track) } : {}),
      ...(track.inject ? { inject: [...track.inject] } : {}),
      ...(track.disabled === true ? { disabled: true } : {}),
      trackKind: "pi" as const,
    };
  });
}

export function serializeHarnessTrack(
  manifest: OpenBuddyPluginManifest,
): readonly SerializedHarnessTrack[] {
  return manifest.tracks.filter((track): track is OpenBuddyPluginTrack & { kind: "harness" } => track.kind === "harness").map((track) => {
    if (!track.inline && !track.source) {
      throw new OpenBuddyPluginManifestError(manifest.id, `harness track is missing both inline and source`);
    }
    return {
      id: manifest.id,
      name: track.inline ?? track.source!,
      ...(mergedConfig(track) ? { config: mergedConfig(track) } : {}),
      ...(track.inject ? { inject: [...track.inject] } : {}),
      ...(track.disabled === true ? { disabled: true } : {}),
      trackKind: "harness" as const,
    };
  });
}

export function serializeSlotTrack(
  manifest: OpenBuddyPluginManifest,
): readonly SerializedSlotTrack[] {
  return manifest.tracks.filter((track): track is OpenBuddyPluginTrack & { kind: "slot" } => track.kind === "slot").map((track) => {
    if (!track.source) {
      throw new OpenBuddyPluginManifestError(manifest.id, `slot track requires source (inline slots are not yet supported by Phase K.2)`);
    }
    return {
      id: manifest.id,
      ...(manifest.packageName ? { packageName: manifest.packageName } : {}),
      source: track.source,
      ...(track.name ? { apply: track.name } : {}),
      ...(mergedConfig(track) ? { config: mergedConfig(track) } : {}),
      ...(track.disabled === true ? { disabled: true } : {}),
      trackKind: "slot" as const,
    };
  });
}

export function serializeCordisTrack(
  manifest: OpenBuddyPluginManifest,
): readonly SerializedCordisTrack[] {
  return manifest.tracks.filter((track): track is OpenBuddyPluginTrack & { kind: "cordis" } => track.kind === "cordis").map((track) => {
    if (!track.inline && !track.source) {
      throw new OpenBuddyPluginManifestError(manifest.id, `cordis track is missing both inline and source`);
    }
    return {
      id: manifest.id,
      source: track.inline ?? track.source!,
      ...(mergedConfig(track) ? { config: mergedConfig(track) } : {}),
      ...(track.inject ? { inject: [...track.inject] } : {}),
      ...(track.disabled === true ? { disabled: true } : {}),
      trackKind: "cordis" as const,
    };
  });
}

export function listOpenBuddyPluginManifestTracks(
  manifest: OpenBuddyPluginManifest,
): readonly OpenBuddyPluginTrackKind[] {
  const seen = new Set<OpenBuddyPluginTrackKind>();
  for (const track of manifest.tracks) seen.add(track.kind);
  return [...seen];
}

/** Apply a manifest's `flags.passthrough` (if present) to a serialised
 *  track row. Returns the row unchanged when no flag is set; returns a
 *  shallow copy with `passthrough: true` when the flag is true. The
 *  v6 plan says passthrough is the only flag the SDK needs to surface
 *  (adapter detection reuses `recordPassthrough()` from plugin-host). */
export function applyOpenBuddyPluginManifestPassthrough<T extends object>(
  track: T,
  manifest: OpenBuddyPluginManifest,
): T {
  const passthrough = manifest.flags?.passthrough;
  if (passthrough !== true) return track;
  const config = (track as { config?: Record<string, unknown> }).config;
  return {
    ...track,
    ...(config !== undefined
      ? { config: { ...config, passthrough: true } }
      : { config: { passthrough: true } }),
  } as T;
}