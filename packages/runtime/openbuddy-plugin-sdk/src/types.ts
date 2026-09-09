/**
 * @openbuddy/plugin-sdk — TypeScript contracts.
 *
 * Phase K.1 (DSH v6 §25). The SDK is a **thin manifest serializer** that
 * converts a `plugin.json` (or `package.json#openbuddy` block) into PI
 * ExtensionFactory descriptors. It does NOT install plugins into a
 * microkernel; that remains PI's `loadExtensions()` job. The four-track
 * shape (`pi` / `cordis` / `ui` / `harness`) is kept so the serializer
 * can produce a normalized ExtensionFactory that wraps each track.
 *
 * Reference:
 *   - docs/OPENBUDDY_PI_NATIVE_PLAN.md §25 (v4 spec)
 *   - docs/OPENBUDDY_PI_NATIVE_PLAN.md v6 changelog (manifest-only reframe)
 */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** Manifest schema id, used to detect cross-version mismatches. */
export const OPENBUDDY_PLUGIN_SCHEMA = "openbuddy.plugin.v1" as const;

/** Manifest protocol version. Bump on any breaking shape change. */
export const OPENBUDDY_PLUGIN_PROTOCOL = 1 as const;

/** The four surface kinds a plugin can opt into. */
export const openBuddyPluginTracks = ["pi", "cordis", "ui", "harness"] as const;
export type OpenBuddyPluginTrack = (typeof openBuddyPluginTracks)[number];

/**
 * Cordis Context surface, narrowed to the calls a plugin is allowed to
 * make during static initialization. We deliberately do not import the
 * `@openbuddy/cordis` package here — the SDK is a leaf library that
 * only types the contract; the real Context instance is supplied by the
 * host at load time.
 */
export interface OpenBuddyCordisSink {
  plugin(ctor: new (ctx: unknown, config?: unknown) => unknown, config?: unknown): void;
  provide(name: string, value: unknown): void;
  set(name: string, value: unknown): void;
}

/**
 * UI slot sink — mirrors the renderer-side `SlotMap` register/unregister
 * pair. Renderer-only; the host keeps its own strong-typed implementation
 * and only the narrow string-key surface is shared.
 */
export interface OpenBuddyUISink {
  register(slotKey: string, contribution: OpenBuddySlotContribution): void;
  unregister(slotKey: string): void;
}

/**
 * Harness sink — matches DeepSeek Harness's `HarnessPluginLoader.load`
 * contract. Used during the Phase L.5 DSH retirement; for now the SDK
 * records it but the default host boot ignores `harness` until the
 * loader is wired in.
 */
export interface OpenBuddyHarnessSink {
  load(declaration: OpenBuddyHarnessDeclaration): Promise<() => Promise<void>>;
}

/** A single UI slot entry. */
export type OpenBuddySlotContribution =
  | { type: "react-component"; component: string; props?: Record<string, unknown> }
  | { type: "menu-item"; label: string; accelerator?: string; onClick: string }
  | { type: "status-bar"; id: string; getText: string };

/** Manifest-side slot declarations (slotKey → contribution). */
export type OpenBuddySlotMap = Readonly<Record<string, OpenBuddySlotContribution>>;

/** Harness-side static declaration. */
export interface OpenBuddyHarnessDeclaration {
  readonly contributes?: Readonly<Record<string, unknown>>;
}

/**
 * In-memory plugin record. Mirrors what `plugin.json` / `package.json`
 * parse into. Each track is optional — a plugin can opt into any subset.
 */
export interface OpenBuddyPlugin {
  /** Canonical plugin name. Required. */
  readonly name: string;
  /** Semantic version string. Required. */
  readonly version: string;
  /** Optional semver range of compatible OpenBuddy cores. */
  readonly engines?: { readonly openbuddy?: string };
  /** Path to the main entry file (relative to the manifest). */
  readonly main?: string;

  /** Track 1 — PI Extension factory. */
  readonly pi?: ExtensionFactory | OpenBuddySerializedExtensionFactory;
  /** Track 2 — Cordis DI installer. */
  readonly cordis?: (ctx: OpenBuddyCordisSink) => void | Promise<void>;
  /** Track 3 — Renderer slot contributions. */
  readonly ui?: OpenBuddySlotMap;
  /** Track 4 — Harness declaration (DSH compatibility, transient). */
  readonly harness?: OpenBuddyHarnessDeclaration;
}

/**
 * Static PI track — used by the serializer when the manifest describes
 * the extension in JSON instead of carrying a function. This is the
 * shape that the serializer turns into a real `ExtensionFactory` via
 * `manifestToExtensionFactory` (see `./serializer.ts`).
 */
export interface OpenBuddySerializedExtensionFactory {
  /**
   * Event handlers to wire into the PI ExtensionRunner. The key is the
   * event name from the PI ExtensionAPI (`session_start`, `tool_call`,
   * `before_provider_request`, ...). Each value is the path (relative
   * to the manifest root) of a module that exports a default function
   * matching `ExtensionHandler<E, R>`.
   */
  readonly handlers?: Readonly<Record<string, string>>;
  /**
   * Tools to register. Each entry names a module file that exports
   * a `ToolDefinition` as its default export.
   */
  readonly tools?: readonly string[];
  /**
   * Slash commands to register. Each entry names a module file that
   * exports `{ name, description, handler }` shaped like
   * `RegisteredCommand` minus `name` / `sourceInfo`.
   */
  readonly commands?: readonly string[];
  /**
   * Optional inline factory (escape hatch). When set, the serializer
   * emits the function as-is and ignores `handlers` / `tools` /
   * `commands`.
   */
  readonly factory?: ExtensionFactory;
}

/**
 * Result of running the serializer. The `factory` is what gets passed
 * to PI's `loadExtensionFromFactory()` / `discoverAndLoadExtensions()`.
 * The `tracks` record is informational — it tells the host which tracks
 * were present so it can log / instrument without re-parsing.
 */
export interface OpenBuddySerializedPlugin {
  readonly name: string;
  readonly version: string;
  readonly manifestPath: string;
  readonly tracks: ReadonlyArray<OpenBuddyPluginTrack>;
  readonly factory: ExtensionFactory;
  /** Errors collected during validation, if any. */
  readonly diagnostics: ReadonlyArray<string>;
}

/**
 * Strict subset used by the serializer — it must never receive a
 * `function` for `pi`, because functions don't survive JSON.
 */
export type OpenBuddySerializablePlugin = Omit<OpenBuddyPlugin, "pi" | "cordis"> & {
  readonly pi?: OpenBuddySerializedExtensionFactory;
};

/** Lightweight phantom of `ExtensionAPI` for serializer tests. */
export type ExtensionApiStub = Pick<ExtensionAPI, "registerTool" | "registerCommand">;
