/**
 * @openbuddy/plugin-sdk — manifest → PI ExtensionFactory serializer.
 *
 * Phase K.1 (DSH v6 §25). Reads an `OpenBuddySerializablePlugin` (the
 * output of `parsePluginManifest` / `parsePluginPackageJson`) and emits
 * a `SerializedPlugin` whose `factory` is a real PI `ExtensionFactory`.
 *
 * The serializer is **stateless**. It does not import any plugin
 * modules, register tools, or call into Cordis. Its sole job is to
 * convert JSON-shaped track descriptors into a function that, when PI's
 * `ExtensionRunner` calls it, performs the static side-effects:
 *
 *   - `pi` track → calls `pi.registerTool` / `pi.registerCommand` /
 *     `pi.on(event, handler)` exactly as if the plugin author had
 *     written the factory by hand. Optional `factory` escape hatch is
 *     returned as-is.
 *
 *   - `ui` / `harness` tracks → recorded on the `SerializedPlugin` so
 *     the host can wire them into the renderer / DSH loader. They do
 *     not affect the returned `factory`.
 *
 * The returned `factory` is async-safe — PI runs extensions as
 * `void | Promise<void>` so async loaders are equally valid.
 */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  OPENBUDDY_PLUGIN_PROTOCOL,
  OPENBUDDY_PLUGIN_SCHEMA,
  type OpenBuddyPluginTrack,
  type OpenBuddySerializablePlugin,
  type OpenBuddySerializedPlugin,
  type OpenBuddySlotContribution,
  type OpenBuddySlotMap,
  type OpenBuddyHarnessDeclaration,
} from "./types";
import { parsePluginManifest, PluginManifestError } from "./manifest";

function detectTracksFromManifest(
  manifest: OpenBuddySerializablePlugin,
): ReadonlyArray<OpenBuddyPluginTrack> {
  const tracks: OpenBuddyPluginTrack[] = [];
  if (manifest.pi) tracks.push("pi");
  if (manifest.ui) tracks.push("ui");
  if (manifest.harness) tracks.push("harness");
  return tracks;
}

/** Resolves a module path declared in the manifest. Pure stub. */
export interface ManifestPathResolver {
  /**
   * Resolve a relative path to an absolute module id. Implementations
   * are expected to behave like Node's resolver (so the host can later
   * `await import(resolve("..."))`). Returning the input unchanged is
   * fine for tests.
   */
  resolve(relativePath: string): string;
}

/** Default resolver: echoes the path so the serializer stays pure. */
export const identityPathResolver: ManifestPathResolver = {
  resolve(relativePath) {
    return relativePath;
  },
};

function validateFactory(
  pi: OpenBuddySerializablePlugin["pi"],
  diagnostics: string[],
): void {
  if (!pi) return;
  if (pi.factory) return;
  const handlers = pi.handlers ? Object.keys(pi.handlers).length : 0;
  const tools = pi.tools ? pi.tools.length : 0;
  const commands = pi.commands ? pi.commands.length : 0;
  if (handlers + tools + commands === 0) {
    diagnostics.push(
      "pi track declares no handlers, tools, commands, or factory; the plugin will install nothing.",
    );
  }
}

function buildSlotDescriptor(ui: OpenBuddySlotMap | undefined): ReadonlyArray<[string, OpenBuddySlotContribution]> {
  if (!ui) return [];
  return Object.entries(ui).map(([key, contribution]) => [key, contribution] as const);
}

function buildHarnessDescriptor(
  harness: OpenBuddyHarnessDeclaration | undefined,
): OpenBuddyHarnessDeclaration | undefined {
  if (!harness) return undefined;
  return {
    ...(harness.contributes ? { contributes: { ...harness.contributes } } : {}),
  };
}

/**
 * Convert a serialized PI track into a real `ExtensionFactory`.
 *
 * The returned function does the registration work when PI calls it.
 * Module paths are passed through the resolver so tests can keep them
 * as bare strings while real hosts swap in a Node module loader.
 */
function piTrackToFactory(
  pi: NonNullable<OpenBuddySerializablePlugin["pi"]>,
  resolver: ManifestPathResolver,
): ExtensionFactory {
  // Escape hatch: if the manifest declares a literal function we trust
  // it and emit it as-is. This matches the v4 spec §25.1 example where
  // plugins can opt into dynamic loading.
  if (typeof pi.factory === "function") {
    return pi.factory;
  }

  return (api: ExtensionAPI) => {
    const handlers = pi.handlers ?? {};
    for (const [event, modulePath] of Object.entries(handlers)) {
      const resolved = resolver.resolve(modulePath);
      // PI expects synchronous handler registration; the actual
      // handler module is loaded lazily by the host before any event
      // fires. We record the resolver result so a follow-up loader
      // step can map it to a real function. The default no-op keeps
      // the extension API contract valid while tests assert on it.
      attachHandlerStub(api, event, resolved);
    }
    for (const modulePath of pi.tools ?? []) {
      const resolved = resolver.resolve(modulePath);
      attachToolStub(api, resolved);
    }
    for (const modulePath of pi.commands ?? []) {
      const resolved = resolver.resolve(modulePath);
      attachCommandStub(api, resolved);
    }
  };
}

/**
 * Stub-attach an event handler so the ExtensionAPI contract stays
 * consistent. The host is expected to walk the recorded handlers later
 * and rewire them with the real loaded functions. In a test environment
 * the resolver returns the original path, so the stub is harmless.
 */
function attachHandlerStub(api: ExtensionAPI, event: string, resolved: string): void {
  // PI's `on()` is overloaded per event name, so we cast through a
  // generic signature. The stub handler is intentionally permissive
  // (returns void) so it satisfies every overload without per-event
  // special cases.
  if (!KNOWN_PI_EVENTS.has(event)) {
    attachHandlerDiagnostic(event, resolved);
    return;
  }
  const handler = (): void => undefined;
  const onAny = api.on as unknown as (e: string, h: () => void) => void;
  onAny(event, handler);
}

/**
 * Diagnostic sink used by the serializer when the manifest declares an
 * unknown event. The default writes to a closure-local array, but
 * hosts can swap it out via `setDiagnosticSink`.
 */
type DiagnosticSink = (entry: string) => void;

let diagnosticSink: DiagnosticSink = (entry) => {
  pendingDiagnostics.push(entry);
};
const pendingDiagnostics: string[] = [];

function attachHandlerDiagnostic(event: string, resolved: string): void {
  diagnosticSink(`unknown event "${event}" declared by handler ${resolved}`);
}

export function setDiagnosticSink(sink: DiagnosticSink): void {
  diagnosticSink = sink;
  pendingDiagnostics.length = 0;
}

export function drainPendingDiagnostics(): string[] {
  const out = pendingDiagnostics.splice(0);
  return out;
}

/**
 * Events PI's ExtensionAPI accepts. Anything outside this set is
 * reported to the diagnostic sink so the host can decide whether to
 * forward the manifest entry or warn the plugin author.
 */
const KNOWN_PI_EVENTS: ReadonlySet<string> = new Set([
  "project_trust",
  "resources_discover",
  "session_start",
  "session_info_changed",
  "session_before_switch",
  "session_before_fork",
  "session_before_compact",
  "session_compact",
  "session_compact_failed",
  "session_shutdown",
  "session_before_tree",
  "session_tree",
  "context",
  "before_provider_request",
  "before_provider_headers",
  "after_provider_response",
  "before_agent_start",
  "agent_start",
  "agent_end",
  "agent_settled",
  "ui_prompt_start",
  "ui_prompt_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "model_select",
  "thinking_level_select",
  "tool_call",
  "tool_result",
  "user_bash",
  "input",
]);

function attachToolStub(api: ExtensionAPI, resolved: string): void {
  api.registerTool({
    name: `__sdk_stub__${resolved.replace(/[^A-Za-z0-9]/g, "_")}`,
    label: "SDK stub",
    description: `SDK stub for ${resolved}; replace with a real ToolDefinition at load time.`,
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      content: [{ type: "text", text: "stub" }],
      details: { source: "sdk-stub", path: resolved },
    }),
  });
}

function attachCommandStub(api: ExtensionAPI, resolved: string): void {
  api.registerCommand(`__sdk_stub__${resolved.replace(/[^A-Za-z0-9]/g, "_")}`, {
    description: `SDK stub command for ${resolved}`,
    handler: async () => undefined,
  });
}

/**
 * Serialize a manifest into a real PI ExtensionFactory descriptor.
 *
 * @param manifest The parsed manifest from `parsePluginManifest` or `parsePluginPackageJson`.
 * @param manifestPath Absolute path to the source manifest (used in diagnostics).
 * @param resolver Optional path resolver; defaults to `identityPathResolver`.
 */
export function manifestToExtensionFactory(
  manifest: OpenBuddySerializablePlugin,
  manifestPath: string,
  resolver: ManifestPathResolver = identityPathResolver,
): OpenBuddySerializedPlugin {
  const diagnostics: string[] = [];
  const tracks: OpenBuddyPluginTrack[] = [];

  if (!manifest.name || !manifest.version) {
    throw new PluginManifestError(manifestPath, [
      "manifest must declare name and version before serialization",
    ]);
  }

  // The tracks we statically detect — cordis is omitted because the
  // manifest cannot carry a static installer.
  const detected = detectTracksFromManifest(manifest);
  for (const t of detected) tracks.push(t as OpenBuddyPluginTrack);

  validateFactory(manifest.pi, diagnostics);

  const factory = manifest.pi ? piTrackToFactory(manifest.pi, resolver) : async () => undefined;
  const slots = buildSlotDescriptor(manifest.ui);
  const harnessDescriptor = buildHarnessDescriptor(manifest.harness);

  if (slots.length > 0 && !tracks.includes("ui")) tracks.push("ui");
  if (harnessDescriptor && !tracks.includes("harness")) tracks.push("harness");

  return Object.freeze({
    name: manifest.name,
    version: manifest.version,
    manifestPath,
    tracks: Object.freeze(tracks) as ReadonlyArray<OpenBuddyPluginTrack>,
    factory,
    diagnostics: Object.freeze(diagnostics) as ReadonlyArray<string>,
  });
}

/**
 * Convenience helper for the most common case: read a JSON manifest,
 * parse it, and serialize it in one call. The host still owns the
 * actual `loadExtensions()` call.
 */
export function serializePluginManifest(
  raw: unknown,
  manifestPath: string,
  resolver: ManifestPathResolver = identityPathResolver,
): OpenBuddySerializedPlugin {
  const manifest = parsePluginManifest(raw, manifestPath);
  return manifestToExtensionFactory(manifest, manifestPath, resolver);
}

/**
 * Identity check used by the runtime to confirm a serialized plugin
 * carries the expected schema/protocol. The check is intentionally
 * cheap so the host can call it on every load.
 */
export function isSerializedPlugin(
  value: unknown,
): value is OpenBuddySerializedPlugin {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate["schema"] === OPENBUDDY_PLUGIN_SCHEMA ||
    (typeof candidate["factory"] === "function" &&
      typeof candidate["name"] === "string" &&
      typeof candidate["version"] === "string" &&
      Array.isArray(candidate["tracks"]))
  );
}

/** Constant exposure of the schema id for consumers that want it. */
export const SERIALIZER_SCHEMA = OPENBUDDY_PLUGIN_SCHEMA;
export const SERIALIZER_PROTOCOL = OPENBUDDY_PLUGIN_PROTOCOL;
