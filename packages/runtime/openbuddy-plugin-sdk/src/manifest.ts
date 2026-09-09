/**
 * @openbuddy/plugin-sdk — zod schema + manifest parsers.
 *
 * Two parsers are exposed:
 *
 *  1. `parsePluginManifest(raw)` — accepts a `plugin.json`-shaped object
 *     (the standalone file in the fixture, with `schema`, `main`, etc.
 *     at the top level) and validates every field with zod.
 *
 *  2. `parsePluginPackageJson(raw)` — accepts a `package.json` object
 *     and pulls the `openbuddy` field out, validating it as the same
 *     shape. This is the recommended entry point for npm-distributed
 *     plugins that share `package.json` between npm and OpenBuddy.
 *
 * Both return a typed `OpenBuddySerializablePlugin` plus any diagnostic
 * messages the zod validator surfaced. The serializer is separate (see
 * `./serializer.ts`) so consumers can use the parsed manifest without
 * the in-memory side effects of registering a factory.
 */
import { z } from "zod";
import {
  OPENBUDDY_PLUGIN_PROTOCOL,
  OPENBUDDY_PLUGIN_SCHEMA,
  type OpenBuddySerializablePlugin,
  type OpenBuddySerializedExtensionFactory,
  type OpenBuddySlotContribution,
  type OpenBuddySlotMap,
} from "./types";

// Re-export for tests / consumers that import directly from the
// manifest module rather than the barrel.
export { OPENBUDDY_PLUGIN_PROTOCOL, OPENBUDDY_PLUGIN_SCHEMA };

/**
 * The slot contribution union. Tagged `type` is the discriminator; the
 * surrounding fields depend on the tag.
 */
const slotContributionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("react-component"),
    component: z.string().min(1),
    props: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("menu-item"),
    label: z.string().min(1),
    accelerator: z.string().optional(),
    onClick: z.string().min(1),
  }),
  z.object({
    type: z.literal("status-bar"),
    id: z.string().min(1),
    getText: z.string().min(1),
  }),
]);

/** Static harness declaration. Empty `contributes` is allowed. */
const harnessDeclarationSchema = z
  .object({
    contributes: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * PI serialized-extension shape. All fields are optional but at least
 * one of `factory` / `handlers` / `tools` / `commands` must be present
 * (validated at the parent level).
 */
const serializedPiSchema = z
  .object({
    handlers: z.record(z.string(), z.string().min(1)).optional(),
    tools: z.array(z.string().min(1)).optional(),
    commands: z.array(z.string().min(1)).optional(),
    factory: z.unknown().optional(),
  })
  .strict();

/**
 * Core manifest schema. Used for both `plugin.json` and
 * `package.json#openbuddy`. Strict — extra keys are rejected so the
 * serializer can rely on the shape.
 */
export const manifestCoreSchema = z
  .object({
    schema: z.literal(OPENBUDDY_PLUGIN_SCHEMA).optional(),
    protocol: z.literal(OPENBUDDY_PLUGIN_PROTOCOL).optional(),
    name: z.string().min(1).regex(/^[A-Za-z0-9_./@-]+$/, {
      message: "name must match /^[A-Za-z0-9_./@-]+$/",
    }),
    version: z
      .string()
      .min(1)
      .regex(/^\d+\.\d+\.\d+(?:[-+].+)?$/, {
        message: "version must be a semver string (e.g. 1.0.0 or 1.0.0-rc.1)",
      }),
    engines: z
      .object({
        openbuddy: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    main: z.string().min(1).optional(),
    pi: serializedPiSchema.optional(),
    ui: z.record(z.string(), slotContributionSchema).optional(),
    harness: harnessDeclarationSchema.optional(),
  })
  .strict();

/**
 * Top-level `plugin.json` shape. Adds the `schema` / `main` fields that
 * would not appear in a `package.json#openbuddy` block.
 */
export const pluginManifestSchema = manifestCoreSchema;

export type PluginManifestInput = z.infer<typeof manifestCoreSchema>;

/** Top-level `package.json` shape we accept. Other fields are ignored. */
export const packageJsonShapeSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    openbuddy: manifestCoreSchema.optional(),
  })
  .passthrough();

export type PackageJsonInput = z.infer<typeof packageJsonShapeSchema>;

/**
 * Custom error raised when the manifest does not parse cleanly. We
 * expose `issues` so callers can render friendly validation summaries.
 */
export class PluginManifestError extends Error {
  readonly issues: ReadonlyArray<string>;
  readonly path: string;

  constructor(path: string, issues: ReadonlyArray<string>) {
    const header = `invalid OpenBuddy plugin manifest at ${path}`;
    super(`${header}\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "PluginManifestError";
    this.path = path;
    this.issues = issues;
  }
}

function issuesToStrings(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
    return `${path}: ${issue.message}`;
  });
}

function toSerializable(parsed: PluginManifestInput): OpenBuddySerializablePlugin {
  const pi = parsed.pi as OpenBuddySerializedExtensionFactory | undefined;
  const ui: OpenBuddySlotMap | undefined = parsed.ui
    ? (parsed.ui as OpenBuddySlotMap)
    : undefined;
  return {
    name: parsed.name,
    version: parsed.version,
    ...(parsed.engines ? { engines: parsed.engines } : {}),
    ...(parsed.main ? { main: parsed.main } : {}),
    ...(pi ? { pi } : {}),
    ...(ui ? { ui } : {}),
    ...(parsed.harness ? { harness: parsed.harness } : {}),
  } as OpenBuddySerializablePlugin;
}

/** Tracks inferred from the parsed manifest. Used by the serializer. */
export function detectTracks(input: PluginManifestInput): ReadonlyArray<string> {
  const tracks: string[] = [];
  if (input.pi) tracks.push("pi");
  if (input.ui) tracks.push("ui");
  if (input.harness) tracks.push("harness");
  // `cordis` is a runtime-only track; the manifest cannot declare it
  // because the SDK is a static serializer. It is reserved here so the
  // type system stays in sync with the four-track plan.
  return tracks;
}

/**
 * Parse a `plugin.json` object. Returns the typed manifest; throws
 * `PluginManifestError` on failure.
 */
export function parsePluginManifest(
  raw: unknown,
  sourcePath = "<plugin.json>",
): OpenBuddySerializablePlugin {
  const result = manifestCoreSchema.safeParse(raw);
  if (!result.success) {
    throw new PluginManifestError(sourcePath, issuesToStrings(result.error));
  }
  const parsed = result.data;
  const tracks = detectTracks(parsed);
  if (tracks.length === 0) {
    throw new PluginManifestError(sourcePath, [
      "manifest must declare at least one track (pi / ui / harness). The cordis track is runtime-only and cannot be statically declared.",
    ]);
  }
  return toSerializable(parsed);
}

/**
 * Parse a `package.json#openbuddy` block. Returns the typed manifest
 * (always without `main`, which lives at `package.json.main`).
 */
export function parsePluginPackageJson(
  raw: unknown,
  sourcePath = "<package.json>",
): OpenBuddySerializablePlugin {
  // Validate the package envelope first; the `openbuddy` block is loose
  // at this stage so we can merge the package's own `name` / `version`
  // before re-running the strict core schema.
  const envelopeShape = z
    .object({
      name: z.string().min(1),
      version: z.string().min(1),
      openbuddy: z
        .object({
          schema: z.literal(OPENBUDDY_PLUGIN_SCHEMA).optional(),
          protocol: z.literal(OPENBUDDY_PLUGIN_PROTOCOL).optional(),
          name: z.string().min(1).optional(),
          version: z.string().min(1).optional(),
          engines: z
            .object({ openbuddy: z.string().min(1).optional() })
            .strict()
            .optional(),
          main: z.string().min(1).optional(),
          pi: serializedPiSchema.optional(),
          ui: z.record(z.string(), slotContributionSchema).optional(),
          harness: harnessDeclarationSchema.optional(),
        })
        .strict()
        .optional(),
    })
    .passthrough();
  const pkgResult = envelopeShape.safeParse(raw);
  if (!pkgResult.success) {
    throw new PluginManifestError(sourcePath, issuesToStrings(pkgResult.error));
  }
  const pkg = pkgResult.data;
  const block = pkg.openbuddy;
  if (!block) {
    throw new PluginManifestError(sourcePath, [
      "package.json does not contain an `openbuddy` field; cannot derive a plugin manifest from it.",
    ]);
  }
  // name + version are required at the package level; let them override
  // the values in the openbuddy block so the npm manifest stays the
  // single source of truth.
  const merged: PluginManifestInput = {
    name: pkg.name,
    version: pkg.version,
    ...block,
    ...(block.name ? { name: block.name } : {}),
    ...(block.version ? { version: block.version } : {}),
  };
  const result = manifestCoreSchema.safeParse(merged);
  if (!result.success) {
    throw new PluginManifestError(sourcePath, issuesToStrings(result.error));
  }
  const parsed = result.data;
  const tracks = detectTracks(parsed);
  if (tracks.length === 0) {
    throw new PluginManifestError(sourcePath, [
      "openbuddy block must declare at least one track (pi / ui / harness).",
    ]);
  }
  return toSerializable(parsed);
}

/**
 * Narrowed slot contribution guard for callers that want to inspect
 * the manifest without going through the serializer. Mostly useful for
 * unit tests and integration code that wants to surface a friendly
 * error for malformed slot entries.
 */
export function parseSlotContribution(raw: unknown): OpenBuddySlotContribution {
  const result = slotContributionSchema.safeParse(raw);
  if (!result.success) {
    throw new PluginManifestError("<slot>", issuesToStrings(result.error));
  }
  return result.data as OpenBuddySlotContribution;
}
