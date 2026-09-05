/**
 * Renderer-side plugin runtime for OpenBuddy.
 *
 * Mirrors the main-side `@openbuddy/plugin-host` for the WorkBuddy UI:
 *   - Holds a Cordis Context whose `rendererEvents` registry is fed live by
 *     `agentOnPluginEvent` from main, so renderer plugins can subscribe with
 *     `ctx.get("rendererEvents").on("agent/*", listener)` just like a main-side
 *     plugin would listen via `ctx.on("agent/*", ...)`.
 *   - Provides a React hook so existing UI components can read renderer
 *     contributions or live events without owning the loader themselves.
 *
 * The loader itself stays empty until the user ships their first renderer
 * plugin; this module's job is to keep the cordis surface alive and forward
 * main events.
 */
import { useEffect, useState } from "react";
import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import * as ReactDomClient from "react-dom/client";
import { Context } from "@openbuddy/cordis";
import { invoke as invokeElectron, listenRpc } from "@/lib/platform/electron-api";
import {
  createOpenBuddyRendererProfile,
  openBuddyRendererPluginIndex,
} from "@openbuddy/bundle-base/renderer";
import {
  composePluginPatches,
  parseCordisPatch,
  patchRowsToOpenBuddy,
} from "@openbuddy/plugin-host/renderer-patch";
import {
  RendererEventRegistry,
  RendererContributionRegistry,
  RendererPluginLoader,
  ClientModuleSystem,
  type ClientModuleRegistrationTarget,
  type RendererContribution,
  type RendererPlugin,
  type RendererPluginEntry,
  type RendererPluginStatus,
  createRendererContext,
  createDeepSeekClientCompatibilityModules,
  createWebHarnessTransport,
  type ClientRemoteContribution,
  type RendererPluginProfile,
  type RendererAgentApi,
  type RendererAgentEvent,
  type HarnessTransportEvent,
  type HarnessTransport,
} from "@openbuddy/renderer-host";
import * as OpenBuddyCordis from "@openbuddy/cordis";
import {
  agentListPlugins,
  agentPluginInventory,
  agentPluginEvents,
  agentPluginReadiness,
  agentPluginSnapshot,
  agentToolsList,
  agentListRendererPluginEntries,
  agentRendererPluginBootGraph,
  agentResolveRendererPluginModule,
  agentReportTransactionReceipt,
  agentOnEvent,
  agentOnPluginEvent,
  agentSessionEventLog,
  agentCurrentModel,
  agentListCommands,
  piInit,
  piNewSession,
  piLoadSession,
  piListSessions,
  piListWorkspaces,
  piSend,
  piSteer,
  piFollowUp,
  piCancel,
  piSetModel,
  piSessionInfo,
  piSessionUsage,
  type OpenBuddyPluginEvent,
  type OpenBuddyPluginInventory,
  type OpenBuddyPluginStatus,
  type OpenBuddyRemoteContribution,
} from "../agent/pi-client";
import type { PluginReadinessSnapshot } from "@openbuddy/plugin-host";

interface RendererPluginRuntime {
  context: Context;
  loader: RendererPluginLoader;
  events: RendererEventRegistry;
  contributions: RendererContributionRegistry;
  /** Harness carrier used for production event delivery when available. */
  transport: HarnessTransport;
  /** Load the built-in renderer face once before the UI mounts. */
  loadBuiltinProfile(): Promise<void>;
  /** Discover and load DeepSeek-style `dsh.client` faces from Main. */
  loadDiscoveredProfile(): Promise<void>;
  /** Re-read the main-side manifest and transactionally reconcile client faces. */
  reloadDiscoveredProfile(): Promise<void>;
	/** Translate persisted main-side events into the renderer bus. */
	replayMainEvents(): Promise<number>;
	/** 最近一次活跃事务 id(Main 端正在等待 renderer receipt 时返回它)。 */
	getPendingRendererTransactionId(): string | null;
	/** Report a renderer-side receipt for the current active transaction, if any. */
	reportRendererReceipt(surface: string, details?: Record<string, unknown>): Promise<boolean>;
	/** Drop the runtime; safe to call on HMR. */
	dispose(): void;
	/** Record a profile supplied through `loadRendererPluginProfile()` so
	 *  it survives subsequent main-side `profile/reloaded` events. */
	registerUserProfile(profile: RendererPluginProfile): void;
	/** Load a deepseek-harness `cordis.patch.yml` (or compatible fragment)
	 *  on top of the running renderer. Unlike `loader.loadCordisPatch`,
	 *  the runtime scopes the patch to entries that are not already
	 *  loaded — built-in sidebar/composer, discovered entries, and other
	 *  user profiles survive the call. */
	loadCordisPatch(source: string, scope?: Record<string, unknown>): Promise<void>;
}

// Module-level transaction receipt state shared between `buildRuntime()` (which
// calls `reportRendererReloadReceipt`) and `usePluginReadiness` (which captures
// the most recent transaction id emitted by Main and clears it on completion).
// Lives at module scope so the React effect hook, which is defined outside
// `buildRuntime()`, can read/write it.
let pendingRendererTransactionId: string | null = null;

function captureRendererReceiptTransaction(transactionId: string | null | undefined): void {
	if (typeof transactionId === "string" && transactionId.trim()) {
		pendingRendererTransactionId = transactionId;
	}
}

let singleton: RendererPluginRuntime | null = null;

function recordRendererDiagnostic(type: string, payload: unknown): void {
	const scope = globalThis as typeof globalThis & {
		__OPENBUDDY_RENDERER_DIAGNOSTICS__?: Array<{ type: string; payload: unknown }>;
	};
	const diagnostics = scope.__OPENBUDDY_RENDERER_DIAGNOSTICS__ ?? [];
	diagnostics.push({ type, payload });
	if (diagnostics.length > 50) diagnostics.splice(0, diagnostics.length - 50);
	scope.__OPENBUDDY_RENDERER_DIAGNOSTICS__ = diagnostics;
}

function entriesEqual(left: RendererPluginEntry, right: RendererPluginEntry): boolean {
	if (left.id !== right.id) return false;
	if (left.name !== right.name) return false;
	if (left.moduleId !== right.moduleId) return false;
	if (left.immediately !== right.immediately) return false;
	if (Boolean(left.disabled) !== Boolean(right.disabled)) return false;
	if (JSON.stringify(left.inject ?? null) !== JSON.stringify(right.inject ?? null)) return false;
	if (JSON.stringify(left.external ?? null) !== JSON.stringify(right.external ?? null)) return false;
	if (JSON.stringify(left.children ?? null) !== JSON.stringify(right.children ?? null)) return false;
	if (JSON.stringify(left.config ?? null) !== JSON.stringify(right.config ?? null)) return false;
	return true;
}

function materializeRendererProfile(profile: RendererPluginProfile): RendererPluginEntry[] {
  if (!profile.patches?.length) return profile.entries.map((entry) => ({ ...entry }));
  const composed = composePluginPatches(profile.entries, profile.patches as never[][]);
  return composed.map((entry) => ({
    id: entry.id,
    moduleId: entry.moduleId,
    name: entry.name,
    config: entry.config,
    inject: entry.inject,
    external: entry.external,
    immediately: entry.immediately,
    disabled: entry.disabled,
    group: entry.group,
    children: entry.children as RendererPluginEntry["children"] | undefined,
  }));
}

function rendererHarnessClientIdentity(): string | undefined {
  const storageKey = "openbuddy.harness.client-identity";
  try {
    const storage = globalThis.localStorage;
    const existing = storage?.getItem(storageKey)?.trim();
    if (existing && /^[A-Za-z0-9._:-]{1,128}$/.test(existing)) return existing;
    const generated = globalThis.crypto?.randomUUID?.() ?? "renderer-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(generated)) return undefined;
    storage?.setItem(storageKey, generated);
    return generated;
  } catch {
    return undefined;
  }
}

function buildRuntime(): RendererPluginRuntime {
  const transport = createWebHarnessTransport({
    baseUrl: async () => {
      const address = await invokeElectron<{ baseUrl?: string }>("harness:address");
      return address?.baseUrl;
    },
    authToken: async () => {
      const address = await invokeElectron<{ token?: string }>("harness:address");
      return address?.token;
    },
    clientIdentity: rendererHarnessClientIdentity,
    loadPersistedCursors: () => invokeElectron<Record<string, number>>("harness:session-cursors"),
    persistCursors: (cursor) => invokeElectron("harness:session-cursors-set", cursor),
    loadResumeToken: () => invokeElectron<string | undefined>("harness:resume-token"),
    persistResumeToken: (token) => invokeElectron("harness:resume-token-set", token),
    persistDebounceMs: 500,
  });
  const agentApi: RendererAgentApi = {
    apiVersion: 1,
    transport,
    init: (cwd) => piInit(cwd),
    newSession: (cwd, modelId) => piNewSession(cwd, modelId),
    loadSession: (sessionId, cwd) => piLoadSession(sessionId, cwd),
    listSessions: (cwd) => piListSessions(cwd),
    listWorkspaces: () => piListWorkspaces(),
    prompt: (sessionId, text) => piSend(sessionId, text),
    steer: (sessionId, text) => piSteer(sessionId, text),
    followUp: (sessionId, text) => piFollowUp(sessionId, text),
    abort: (sessionId) => piCancel(sessionId),
    setModel: (sessionId, modelId) => piSetModel(sessionId, modelId),
    currentModel: () => agentCurrentModel(),
    sessionInfo: (sessionId) => piSessionInfo(sessionId),
    sessionUsage: (sessionId) => piSessionUsage(sessionId),
    eventLog: (query) => agentSessionEventLog(query),
    listCommands: () => agentListCommands(),
    listPlugins: () => agentListPlugins(),
    toolsList: () => agentToolsList(),
    onEvent: (handler) => agentOnEvent((event) => handler(event as RendererAgentEvent)),
    onPluginEvent: (handler) => agentOnPluginEvent((event) => handler(event as RendererAgentEvent)),
    onRpcMessage: async (handler) => listenRpc(handler),
    invoke: (channel, args) => invokeElectron(channel, args),
  };
  const context = createRendererContext(new Context(), agentApi);
  let clientModules: ClientModuleSystem | null = null;
  let clientModuleTarget: ClientModuleRegistrationTarget | null = null;
  let previousModuleLoader: unknown;
  let previousBootGraph: unknown;
  let installedModuleLoader: ClientModuleRegistrationTarget | null = null;
  let installedBootGraph: unknown;
  let moduleGeneration = 0;
  const loader = new RendererPluginLoader(context, async (specifier) => {
    const builtin = openBuddyRendererPluginIndex.get(specifier);
    if (builtin) return builtin;
    if (specifier.startsWith("openbuddy:renderer/")) {
      if (clientModules) return clientModules.import(specifier);
      const moduleKey = specifier.slice("openbuddy:renderer/".length);
      const moduleUrl = await agentResolveRendererPluginModule(moduleKey);
      return import(/* @vite-ignore */ moduleUrl);
    }
    return import(/* @vite-ignore */ specifier);
  });
  const events = context.get("rendererEvents") as RendererEventRegistry;
  const contributions = context.get("rendererContributions") as RendererContributionRegistry;
	let builtinProfilePromise: Promise<void> | null = null;
	let discoveredProfilePromise: Promise<void> | null = null;
	let discoveredEntries: RendererPluginEntry[] = [];
	let discoveredReloadPromise: Promise<void> | null = null;
	let discoveredReloadRequested = false;


	async function reportRendererReloadReceipt(
		surface: string,
		details: Record<string, unknown>,
	): Promise<void> {
		const transactionId = pendingRendererTransactionId;
		pendingRendererTransactionId = null;
		if (!transactionId) return;
		try {
			await agentReportTransactionReceipt(transactionId, surface, details);
		} catch (error) {
			recordRendererDiagnostic("renderer-receipt-error", { transactionId, surface, error: String(error) });
		}
	}
	let discoveredRemoteDisposers: Array<() => Promise<void>> = [];
	let discoveredRemoteContributions: OpenBuddyRemoteContribution[] = [];
	// Profiles supplied through `loadRendererPluginProfile()` are recorded so
	// that subsequent main-side `profile/reloaded` events can re-apply them on
	// top of the freshly-reconciled discovered set. Skipping this leaves user
	// plugins stranded after a profile patch lands.
	let userProfiles: RendererPluginProfile[] = [];
  const readDiscoveredEntries = async (): Promise<RendererPluginEntry[]> => {
    const entries = await agentListRendererPluginEntries();
    return entries.map((entry) => ({
      id: entry.id,
      moduleId: entry.moduleId,
      name: entry.moduleKey ? `openbuddy:renderer/${entry.moduleKey}` : (entry.moduleUrl ?? entry.name),
      inject: entry.inject,
      external: entry.external,
      immediately: entry.immediately,
      config: entry.config,
      disabled: entry.disabled,
    }));
  };
  const createClientModules = async (entries: readonly RendererPluginEntry[]): Promise<void> => {
    // Fold in user-supplied profile entries so the runtime's
    // `openbuddy:renderer/<key>` importer can resolve them through the
    // shared ClientModuleSystem instead of falling through to `import()`.
    // Without this, a user profile entry whose name uses the canonical
    // prefix would fail to load once `clientModules` is initialised.
    const userEntries = userProfiles.flatMap((profile) => profile.entries ?? []);
    const combined = [...entries, ...userEntries.filter((user) => !entries.some((entry) => entry.id === user.id))];
    const registrationTarget: ClientModuleRegistrationTarget = {
      mode: "queue" as const,
      pendingQueue: [],
      load(registration) {
        this.pendingQueue.push(registration);
      },
    };
    const globalScope = globalThis as typeof globalThis & {
      __ModuleLoader__?: typeof registrationTarget;
      __DSH_BOOT__?: unknown;
    };
    if (!clientModuleTarget) previousModuleLoader = globalScope.__ModuleLoader__;
    if (!clientModules) previousBootGraph = globalScope.__DSH_BOOT__;
    globalScope.__ModuleLoader__ = registrationTarget;
    installedModuleLoader = registrationTarget;
    clientModuleTarget = registrationTarget;
    moduleGeneration += 1;
    let hostGraph: Awaited<ReturnType<typeof agentRendererPluginBootGraph>> | undefined;
    try {
      if (typeof agentRendererPluginBootGraph === "function") hostGraph = await agentRendererPluginBootGraph();
    } catch {
      // Unit tests and standalone renderer previews may not expose the host graph.
    }
    const hostUrls = new Map((hostGraph?.entries ?? []).map((entry) => [entry.id, entry.url]));
    const cacheBustedUrl = (raw: string): string => {
      const url = new URL(raw);
      if (/^(?:file:|https?:)$/i.test(url.protocol)) {
        url.searchParams.set("openbuddy_reload", String(moduleGeneration));
      }
      return url.href;
    };
    clientModules = new ClientModuleSystem({
      entries: combined.map((entry) => ({
        id: entry.id,
        moduleId: entry.moduleId,
        moduleKey: entry.id,
        name: entry.moduleId?.startsWith("@deepseek-ai/") ? entry.moduleId : entry.name,
        inject: Array.isArray(entry.inject) ? entry.inject : undefined,
        external: entry.external,
        immediately: entry.immediately,
      })),
      resolveModuleUrl: async (entry) => {
        const raw = hostUrls.get(entry.id) ?? await agentResolveRendererPluginModule(entry.moduleKey ?? entry.id);
        return cacheBustedUrl(raw);
      },
      loadBundle: async (_entry, url) => {
        if (/^file:/i.test(url)) return;
        if (typeof document === "undefined") return;
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.async = true;
          script.src = url;
          script.onload = () => { script.remove(); resolve(); };
          script.onerror = () => { script.remove(); reject(new Error(`renderer-module: bundle failed to load ${url}`)); };
          document.head.append(script);
        });
      },
      importModule: async (_entry, url) => import(/* @vite-ignore */ url),
      staticModules: {
        react: React,
        "react/jsx-runtime": ReactJsxRuntime,
        "react-dom": ReactDom,
        "react-dom/client": ReactDomClient,
        "@openbuddy/cordis": OpenBuddyCordis,
        "@cordisjs/core": OpenBuddyCordis,
        "@deepseek-ai/cordis": OpenBuddyCordis,
        ...createDeepSeekClientCompatibilityModules(React),
      },
      registrationTarget,
    });
    const graph = await clientModules.bootGraph();
    const bootGraph = hostGraph
      ? { ...hostGraph, entries: hostGraph.entries.map((entry) => ({ ...entry, url: cacheBustedUrl(entry.url) })) }
      : graph;
    (globalThis as typeof globalThis & { __DSH_BOOT__?: unknown }).__DSH_BOOT__ = bootGraph;
    installedBootGraph = bootGraph;
    await Promise.all(combined.filter((entry) => entry.immediately).map((entry) => clientModules!.prefetch(entry.id)));
  };
  const mountDiscoveredRemotes = async (): Promise<void> => {
    const remote = context.get("remote") as {
      $mountLocal?: (contribution: ClientRemoteContribution) => () => Promise<void>;
    } | undefined;
    if (!remote?.$mountLocal) return;
    const piClient = await import("../agent/pi-client");
    let listRemoteContributions: (() => Promise<OpenBuddyRemoteContribution[]>) | undefined;
    try {
      listRemoteContributions = (piClient as typeof piClient & {
        agentListRemoteContributions?: () => Promise<OpenBuddyRemoteContribution[]>;
      }).agentListRemoteContributions;
    } catch {
      return;
    }
    if (typeof listRemoteContributions !== "function") return;
    const next = await listRemoteContributions();
    const previous = discoveredRemoteContributions;
    const disposeAll = async (disposers: Array<() => Promise<void>>): Promise<void> => {
      const errors: unknown[] = [];
      for (const dispose of disposers.slice().reverse()) {
        try { await dispose(); } catch (error) { errors.push(error); }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "renderer-plugin: remote disposal failed");
    };
    const previousDisposers = discoveredRemoteDisposers;
    discoveredRemoteDisposers = [];
    discoveredRemoteContributions = [];
    try {
      await disposeAll(previousDisposers);
    } catch (error) {
      // A disposer may be idempotent but asynchronous. Keep the old handles
      // available so a later profile reload can retry cleanup instead of
      // losing the only reference to a partially detached contribution.
      discoveredRemoteDisposers = previousDisposers;
      discoveredRemoteContributions = previous;
      throw error;
    }
    const existing = new Set((context.get("typert") as { remotes?: { list?: () => Array<{ package?: string }> } } | undefined)?.remotes?.list?.().map((entry) => entry.package).filter((value): value is string => Boolean(value)) ?? []);
    const mounted: Array<() => Promise<void>> = [];
    try {
      for (const contribution of next) {
        if (existing.has(contribution.package)) continue;
        mounted.push(remote.$mountLocal(contribution as unknown as ClientRemoteContribution));
      }
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      try { await disposeAll(mounted); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
      const restored: Array<() => Promise<void>> = [];
      try {
        for (const contribution of previous) {
          if (!existing.has(contribution.package)) restored.push(remote.$mountLocal(contribution as unknown as ClientRemoteContribution));
        }
      } catch (restoreError) {
        cleanupErrors.push(restoreError);
        try { await disposeAll(restored); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
        discoveredRemoteDisposers = [];
        discoveredRemoteContributions = [];
        throw new AggregateError([error, ...cleanupErrors], "renderer-plugin: remote mount rollback failed");
      }
      discoveredRemoteDisposers = restored;
      discoveredRemoteContributions = previous;
      if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "renderer-plugin: remote mount cleanup failed");
      throw error;
    }
    discoveredRemoteDisposers = mounted;
    discoveredRemoteContributions = next;
  };
  // Re-apply user-supplied profiles without going through the loader's
  // full `reconcile` pass: `reconcile` treats every entry in the store as
  // a candidate for removal when it isn't in the user profile, which would
  // evict freshly-loaded discovered entries. Instead, add any user entry
  // that isn't currently loaded (e.g. it was torn down during a profile
  // reload) and skip the rest.
  const applyUserProfiles = async (): Promise<void> => {
    for (const profile of userProfiles) {
      try {
        const missing: RendererPluginEntry[] = [];
        for (const entry of materializeRendererProfile(profile)) {
          let current: string | undefined;
          try {
            current = loader.resolve(entry.id).status.state;
          } catch {
            // entry unknown to the loader yet — needs to be loaded
          }
          if (current === "loaded" || current === "pending" || current === "disabled") continue;
          if (current === "failed") {
            // The loader keeps a `failed` entry in the store so callers can
            // surface the error. Retry by removing it first so the
            // duplicate-entry guard does not fire on the reload below.
            try { await loader.remove(entry.id); } catch { /* best-effort */ }
          }
          missing.push(entry);
        }
        if (missing.length) await loader.load(missing);
      } catch (error) {
        events.emit("renderer/profile-reload-failed", { error: String(error), source: "user-profile" });
      }
    }
  };
  return {
    context,
    loader,
    events,
    contributions,
    transport,
    loadBuiltinProfile() {
      if (!builtinProfilePromise) {
        const profile = createOpenBuddyRendererProfile();
        builtinProfilePromise = loader.loadProfile(profile).then(() => undefined);
      }
      return builtinProfilePromise;
    },
	async loadDiscoveredProfile() {
		if (!discoveredProfilePromise) {
			discoveredProfilePromise = (async () => {
					discoveredEntries = await readDiscoveredEntries();
					await createClientModules(discoveredEntries);
					await loader.load(discoveredEntries);
					await mountDiscoveredRemotes();
				await applyUserProfiles();
			})();
		}
		await discoveredProfilePromise;
	},
	async reloadDiscoveredProfile() {
		if (discoveredReloadPromise) {
			discoveredReloadRequested = true;
			recordRendererDiagnostic("profile-reload-coalesced", {});
			return discoveredReloadPromise;
		}
		recordRendererDiagnostic("profile-reload-start", { previous: discoveredEntries.map((entry) => entry.id) });
		discoveredReloadPromise = (async () => {
				do {
				discoveredReloadRequested = false;
				await Promise.all([builtinProfilePromise, discoveredProfilePromise]);
				const startedAt = Date.now();
				const next = await readDiscoveredEntries();
				const previous = {
					clientModules,
					clientModuleTarget,
					installedModuleLoader,
					installedBootGraph,
					moduleGeneration,
					globalModuleLoader: (globalThis as typeof globalThis & { __ModuleLoader__?: unknown }).__ModuleLoader__,
					globalBootGraph: (globalThis as typeof globalThis & { __DSH_BOOT__?: unknown }).__DSH_BOOT__,
					entries: [...discoveredEntries],
				};
				let candidateModules: ClientModuleSystem | null = null;
				try {
					await createClientModules(next);
					candidateModules = clientModules !== previous.clientModules ? clientModules : null;
					for (const entry of [...discoveredEntries].reverse()) {
						if (loader.resolve(entry.id).status.state !== "unloaded") await loader.remove(entry.id);
					}
					await loader.load([...next]);
					await mountDiscoveredRemotes();
					await applyUserProfiles();
					discoveredEntries = next;
					recordRendererDiagnostic("profile-reload-complete", { next: next.map((entry) => entry.id), loader: loader.list().map((entry) => ({ id: entry.id, state: entry.state })) });
					previous.clientModules?.dispose();
				} catch (error) {
					recordRendererDiagnostic("profile-reload-error", { next: next.map((entry) => entry.id), error: String(error) });
					const failedCandidate = clientModules !== previous.clientModules ? clientModules : candidateModules;
					failedCandidate?.dispose();
					const globalScope = globalThis as typeof globalThis & { __ModuleLoader__?: unknown; __DSH_BOOT__?: unknown };
					clientModules = previous.clientModules;
					clientModuleTarget = previous.clientModuleTarget;
					installedModuleLoader = previous.installedModuleLoader;
					installedBootGraph = previous.installedBootGraph;
					moduleGeneration = previous.moduleGeneration;
					globalScope.__ModuleLoader__ = previous.globalModuleLoader;
					globalScope.__DSH_BOOT__ = previous.globalBootGraph;
					discoveredEntries = previous.entries;
					try {
						const rollbackIds = new Set([...previous.entries, ...next].map((entry) => entry.id));
						const stale = loader.list().filter((entry) => rollbackIds.has(entry.id));
						for (const entry of stale.reverse()) await loader.remove(entry.id);
						if (previous.entries.length) await loader.load(previous.entries);
						await applyUserProfiles();
						await reportRendererReloadReceipt("renderer", {
							rolledBack: true,
							entries: previous.entries.length,
							elapsedMs: Date.now() - startedAt,
						});
					} catch (rollbackError) {
						await reportRendererReloadReceipt("renderer", {
							rolledBack: false,
							rollbackError: String(rollbackError),
							elapsedMs: Date.now() - startedAt,
						});
						throw new AggregateError([error, rollbackError], "renderer-plugin: profile reload rollback failed");
					}
					throw error;
				}
			} while (discoveredReloadRequested);
		})().finally(() => {
			discoveredReloadPromise = null;
			discoveredReloadRequested = false;
		});
		return discoveredReloadPromise;
	},
    async replayMainEvents() {
      const history = (await agentPluginEvents()) as OpenBuddyPluginEvent[];
      const fallbackHistory = history.length > 0 ? history : await agentSessionEventLog({ limit: 2000 });
      for (const event of fallbackHistory) {
        events.emit(event.type, event.payload);
        if (event.type === "profile/reloaded" || event.type === "pi/extensions-reloaded" || event.type === "typert/registry-changed") {
          recordRendererDiagnostic("profile-reload-replay", { event: event.type, sequence: event.sequence });
          await this.reloadDiscoveredProfile();
        }
      }
      return fallbackHistory.reduce((highest, event) => Math.max(highest, event.sequence ?? 0), 0);
    },

	getPendingRendererTransactionId(): string | null {
		return pendingRendererTransactionId;
	},
	async reportRendererReceipt(surface: string, details?: Record<string, unknown>): Promise<boolean> {
		if (!pendingRendererTransactionId) return false;
		await reportRendererReloadReceipt(surface, details ?? {});
		return true;
	},
	
	    dispose() {
      void loader.dispose().catch(() => undefined);
      for (const dispose of discoveredRemoteDisposers.splice(0).reverse()) void dispose();
      discoveredRemoteContributions = [];
      const globalScope = globalThis as typeof globalThis & { __ModuleLoader__?: unknown; __DSH_BOOT__?: unknown };
      // Restore globals only when this runtime currently owns them. A
      // subsequent reload may have replaced the boot graph already;
      // unconditionally resetting would clobber the newer installation.
      if (installedModuleLoader && globalScope.__ModuleLoader__ === installedModuleLoader) {
        globalScope.__ModuleLoader__ = previousModuleLoader;
      }
      if (installedBootGraph && globalScope.__DSH_BOOT__ === installedBootGraph) {
        globalScope.__DSH_BOOT__ = previousBootGraph;
      }
      clientModuleTarget = null;
      clientModules?.dispose();
      clientModules = null;
      installedModuleLoader = null;
      installedBootGraph = undefined;
		events.emit("renderer/disposed", {});
	},
	registerUserProfile(profile: RendererPluginProfile) {
		if (!userProfiles.includes(profile)) userProfiles = [...userProfiles, profile];
	},
	async loadCordisPatch(source: string, scope: Record<string, unknown> = {}) {
		const parsed = parseCordisPatch(source);
		const expressionScope = { ...scope, ctx: context };
		const layers = parsed.layers.map((layer) => patchRowsToOpenBuddy(layer.rows, expressionScope));
		const composed = composePluginPatches([], layers as never[][]);
		const desired = composed.map((entry) => ({
			id: entry.id,
			moduleId: entry.moduleId,
			name: entry.name,
			config: entry.config,
			inject: entry.inject,
			external: entry.external,
			immediately: entry.immediately,
			disabled: entry.disabled,
			group: entry.group,
			children: entry.children as RendererPluginEntry["children"] | undefined,
		}));
		const missing: RendererPluginEntry[] = [];
		const updates: RendererPluginEntry[] = [];
		for (const entry of desired) {
			let current: string | undefined;
			try { current = loader.resolve(entry.id).status.state; } catch { /* unknown */ }
			if (current === undefined || current === "failed") {
				// Unknown to the loader, or in a lingering failed state. Clean
				// up the failed entry before retrying so the loader's
				// duplicate-id guard does not fire.
				if (current === "failed") {
					try { await loader.remove(entry.id); } catch { /* best-effort */ }
				}
				missing.push(entry);
				continue;
			}
			if (current === "disabled") {
				// The loader keeps disabled entries in the store but does not
				// start them; respect that state unless the patch explicitly
				// re-enables the entry.
				if (entry.disabled === false) updates.push(entry);
				continue;
			}
			// current === "loaded" || "pending". Compare the entry shape so a
			// patch can flip `disabled`, swap `config`, or change `inject`.
			const existing = loader.resolve(entry.id).options;
			if (!entriesEqual(existing, entry)) updates.push(entry);
		}
		if (missing.length) await loader.load(missing);
		for (const entry of updates) {
			try { await loader.update(entry.id, entry); }
			catch (error) { events.emit("plugin/failed", { id: entry.id, name: entry.name, error: String(error) }); }
		}
	},
  };
}

/** Lazily construct the shared runtime so SSR / tests can avoid it. */

/**
 * Wire renderer transaction receipts at the runtime layer so the "renderer"
 * surface stays closable even when no UI component mounts
 * `usePluginReadiness`. Captures the active transaction id from main on
 * `plugin/transaction-start`, clears it on completion/failure, and on the
 * "renderer" phase of a transaction reconciles the discovered profile graph
 * before delivering the receipt.
 *
 * Idempotent: registering twice is a no-op (uses a module-level flag).
 */
let transactionReceiptsWired = false;
export function wireTransactionReceipts(runtime: RendererPluginRuntime): void {
  if (transactionReceiptsWired) return;
  transactionReceiptsWired = true;
  runtime.events.on("plugin/transaction-start", (payload) => {
    const id = (payload as { transactionId?: unknown } | null | undefined)?.transactionId;
    captureRendererReceiptTransaction(typeof id === "string" ? id : null);
  });
  runtime.events.on("plugin/transaction-complete", () => {
    pendingRendererTransactionId = null;
  });
  runtime.events.on("plugin/transaction-failed", () => {
    pendingRendererTransactionId = null;
  });
  runtime.events.on("plugin/transaction-phase", (payload) => {
    const phase = (payload as { phase?: unknown } | null | undefined)?.phase;
    if (phase !== "renderer") return;
    void (async () => {
      try {
        await runtime.reloadDiscoveredProfile();
        await runtime.reportRendererReceipt("renderer", { reloaded: true });
      } catch (error) {
        recordRendererDiagnostic("renderer-phase-receipt-error", { error: String(error) });
        try {
          await runtime.reportRendererReceipt("renderer", { reloaded: false, error: String(error) });
        } catch (nested) {
          recordRendererDiagnostic("renderer-phase-receipt-error-nested", { error: String(nested) });
        }
      }
    })();
  });
}
export function getRendererPluginRuntime(): RendererPluginRuntime {
  if (!singleton) singleton = buildRuntime();
  return singleton;
}

/** Load a profile of renderer plugins on top of the shared runtime.
 *  The profile is registered for re-application on subsequent main-side
 *  `profile/reloaded` events. Entries already present in the loader
 *  (built-in sidebar/composer, discovered entries, earlier user profiles)
 *  are not touched — only missing entries are added. */
export async function loadRendererPluginProfile(
	profile: RendererPluginProfile,
): Promise<RendererPluginStatus[]> {
	const runtime = getRendererPluginRuntime();
	runtime.registerUserProfile(profile);
	const missing: RendererPluginEntry[] = [];
	const updates: RendererPluginEntry[] = [];
	for (const entry of materializeRendererProfile(profile)) {
		let current: string | undefined;
		try { current = runtime.loader.resolve(entry.id).status.state; } catch { /* unknown */ }
		if (current === undefined || current === "failed") {
			if (current === "failed") {
				try { await runtime.loader.remove(entry.id); } catch { /* best-effort */ }
			}
			missing.push(entry);
			continue;
		}
		if (current === "disabled") {
			if (entry.disabled === false) updates.push(entry);
			continue;
		}
		if (!entriesEqual(runtime.loader.resolve(entry.id).options, entry)) updates.push(entry);
	}
	if (missing.length) await runtime.loader.load(missing);
	for (const entry of updates) await runtime.loader.update(entry.id, entry);
	return runtime.loader.list();
}

/** Convenience for the common case: load a single renderer plugin module. */
export async function loadRendererPlugin(
  plugin: RendererPlugin,
  config?: unknown,
): Promise<() => Promise<void>> {
  const runtime = getRendererPluginRuntime();
  const entry: RendererPluginEntry = {
    id: plugin.id ?? plugin.name ?? "renderer-plugin",
    name: plugin.name ?? "renderer-plugin",
    config,
  };
  await runtime.loader.loadPlugins([entry], new Map([[entry.id, plugin]]));
  // Tear down ONLY the entry this call loaded. The previous implementation
  // called `loader.dispose()`, which evicts every other plugin the runtime
  // is hosting (built-in sidebar/composer, discovered entries, other
  // `loadRendererPlugin` callers). Per-entry dispose keeps unrelated
  // plugins alive.
  return async () => {
    try { await runtime.loader.remove(entry.id); }
    catch (error) { runtime.events.emit("plugin/failed", { id: entry.id, name: entry.name, error: String(error) }); }
  };
}

/** Load a deepseek-harness `cordis.patch.yml` (or compatible fragment)
 *  through the shared renderer runtime. Scoped to entries that aren't
 *  already loaded so built-in sidebar/composer, discovered entries, and
 *  other user-supplied profiles survive the call. */
export async function loadCordisPatch(
  source: string,
  scope: Record<string, unknown> = {},
): Promise<void> {
  const runtime = getRendererPluginRuntime();
  await runtime.loadCordisPatch(source, scope);
}

/** Subscribe to live main → renderer plugin events; re-emits replayed history. */
export async function startRendererPluginEventBridge(): Promise<() => void> {
  const runtime = getRendererPluginRuntime();
  wireTransactionReceipts(runtime);
  let replaying = true;
  const pending: OpenBuddyPluginEvent[] = [];
  let lastReplayedSequence = 0;
  let stopped = false;
  let ipcUnlisten: (() => void) | undefined;
  let transportClose: (() => void | Promise<void>) | undefined;
  let transportAbort: AbortController | undefined;
  let transportDisconnected = false;
  const deliveredSequences = new Set<number>();

  const eventFromTransport = (event: HarnessTransportEvent): OpenBuddyPluginEvent | undefined => {
    const payload = event.payload && typeof event.payload === "object"
      ? event.payload as Record<string, unknown>
      : undefined;
    if (event.type === "session/event") {
      const nested = payload?.payload && typeof payload.payload === "object"
        ? payload.payload as Record<string, unknown>
        : undefined;
      const eventSequence = typeof payload?.eventSequence === "number"
        ? payload.eventSequence
        : typeof payload?.sequence === "number" ? payload.sequence : undefined;
      if (nested && typeof nested.type === "string") {
        return {
          type: nested.type,
          payload: nested.payload,
          ...(eventSequence === undefined ? {} : { sequence: eventSequence }),
          ...(typeof nested.timestamp === "string" ? { timestamp: nested.timestamp } : {}),
          ...(typeof nested.sessionId === "string" ? { sessionId: nested.sessionId } : {}),
        };
      }
      return { type: event.type, payload: event.payload, ...(eventSequence === undefined ? {} : { sequence: eventSequence }) };
    }
    if (event.type === "plugin/event") {
      if (payload && typeof payload.type === "string") {
        return {
          type: payload.type,
          payload: payload.payload,
          ...(typeof payload.sequence === "number" ? { sequence: payload.sequence } : {}),
        };
      }
      return { type: event.type, payload: event.payload };
    }
    return { type: event.type, payload: event.payload };
  };

  const deliverLive = (event: OpenBuddyPluginEvent): void => {
    runtime.events.emit(event.type, event.payload);
		if (event.type === "profile/reloaded" || event.type === "pi/extensions-reloaded" || event.type === "typert/registry-changed") {
			void runtime.reloadDiscoveredProfile().catch((error) => {
				recordRendererDiagnostic("profile-reload-failed", { event: event.type, error: String(error) });
				runtime.events.emit("renderer/profile-reload-failed", { error: String(error) });
			});
    }
  };
  const handleLive = (event: OpenBuddyPluginEvent): void => {
    recordRendererDiagnostic("plugin-event-received", { type: event.type, sequence: event.sequence, replaying });
    if (replaying) {
      pending.push(event);
      return;
    }
    if (typeof event.sequence === "number") {
      if (deliveredSequences.has(event.sequence)) return;
      deliveredSequences.add(event.sequence);
    }
    deliverLive(event);
  };

  const subscribeIpc = async (): Promise<void> => {
    if (stopped || ipcUnlisten) return;
    ipcUnlisten = await agentOnPluginEvent(handleLive);
    recordRendererDiagnostic("plugin-event-ipc-subscribed", {});
  };

  const onTransportDisconnect = (): void => {
    if (stopped || transportDisconnected) return;
    transportDisconnected = true;
    void (async () => {
      transportAbort?.abort();
      const close = transportClose;
      transportClose = undefined;
      if (close) await close();
      await subscribeIpc();
    })();
  };

  const harnessAvailable = async (): Promise<boolean> => {
    try {
      const address = await Promise.race([
        invokeElectron<{ baseUrl?: string }>("harness:address"),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 200)),
      ]);
      return typeof address?.baseUrl === "string" && address.baseUrl.length > 0;
    } catch {
      return false;
    }
  };

  // Prefer the Harness carrier so renderer plugins use the same protocol as
  // external DeepSeek Harness clients. Keep the preload event channel as a
  // fallback for older/dev launches where the server is not ready yet.
  if (await harnessAvailable()) {
    recordRendererDiagnostic("plugin-event-transport-attempt", {});
    transportAbort = new AbortController();
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const opened = await Promise.race([
        runtime.transport.open(
          transportAbort.signal,
          (event) => {
            const mapped = eventFromTransport(event);
            if (mapped) handleLive(mapped);
          },
          onTransportDisconnect,
        ),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            transportAbort?.abort();
            reject(new Error("OpenBuddy Harness transport open timed out"));
          }, 5_000);
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
      });
      transportClose = opened.close;
      recordRendererDiagnostic("plugin-event-transport-open", {});
      await subscribeIpc();
    } catch {
      transportAbort.abort();
      transportAbort = undefined;
      await subscribeIpc();
      recordRendererDiagnostic("plugin-event-transport-fallback", {});
    }
  } else {
    await subscribeIpc();
  }

  await runtime.loadBuiltinProfile();
  await runtime.loadDiscoveredProfile();
  lastReplayedSequence = await runtime.replayMainEvents();
  recordRendererDiagnostic("plugin-event-replay-complete", { lastReplayedSequence, pending: pending.length });
  replaying = false;
  const queued = pending
    .filter((event) => typeof event.sequence !== "number" || event.sequence > lastReplayedSequence)
    .sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER));
  for (const event of queued) handleLive(event);
  // A profile can be installed while the initial replay is in flight. The
  // event may already have been consumed by the carrier before the renderer
  // subscribes, so reconcile once after the bridge becomes live.
  void runtime.reloadDiscoveredProfile().catch((error) => {
    recordRendererDiagnostic("profile-reload-startup-failed", { error: String(error) });
  });
  return () => {
    stopped = true;
    ipcUnlisten?.();
    ipcUnlisten = undefined;
    transportAbort?.abort();
    transportAbort = undefined;
    const close = transportClose;
    transportClose = undefined;
    if (close) void close();
    runtime.dispose();
    singleton = null;
  };
}

/** React hook: latest snapshot of contributions for the given kind. */
export function useRendererContributions(kind: RendererContribution["kind"]): RendererContribution[] {
  const runtime = getRendererPluginRuntime();
  const [snapshot, setSnapshot] = useState<RendererContribution[]>(() =>
    runtime.contributions.list().filter((c) => c.kind === kind && c.payload.internal !== true),
  );
  useEffect(() => {
    const refresh = () => setSnapshot(runtime.contributions.list().filter((c) => c.kind === kind && c.payload.internal !== true));
    refresh();
    return runtime.contributions.subscribe(refresh);
  }, [kind, runtime]);
  return snapshot;
}

export interface RendererSlotEntry {
  options: Record<string, unknown>;
  component: unknown;
  registrant?: string;
}

/** React bridge for DeepSeek Harness slots. The slot registry remains the
 * source of truth; this hook only projects live entries into WorkBuddy's
 * existing component tree and never replaces the host UI shell. */
export function useRendererSlot(name: string): RendererSlotEntry[] {
  const runtime = getRendererPluginRuntime();
  const [snapshot, setSnapshot] = useState<RendererSlotEntry[]>(() => {
    const slots = runtime.context.get("slots") as { entriesOfSlot?: (slot: string) => RendererSlotEntry[]; entries?: (slot: string) => RendererSlotEntry[] } | undefined;
    return slots?.entriesOfSlot?.(name) ?? slots?.entries?.(name) ?? [];
  });
  useEffect(() => {
    const slots = runtime.context.get("slots") as {
      entriesOfSlot?: (slot: string) => RendererSlotEntry[];
      entries?: (slot: string) => RendererSlotEntry[];
      subscribe?: (slot: string, listener: () => void) => () => void;
    } | undefined;
    const refresh = () => setSnapshot([...(slots?.entriesOfSlot?.(name) ?? slots?.entries?.(name) ?? [])]);
    refresh();
    return slots?.subscribe?.(name, refresh) ?? (() => undefined);
  }, [name, runtime]);
  return snapshot;
}

export function useRendererSlotEntries(name: string): RendererSlotEntry[] {
  return useRendererSlot(name);
}

/** React hook: merged Cordis and Pi plugin statuses. */
export function useMainPluginStatus(): OpenBuddyPluginStatus[] {
  const inventory = useMainPluginInventory();
  return [...inventory.entries, ...inventory.piExtensions].map((entry) => ({
    ...entry,
    kind: entry.kind ?? "cordis",
  }));
}

/** React hook for the unified main-side Cordis/Pi/renderer inventory. */
export function useMainPluginInventory(refreshKey = 0): OpenBuddyPluginInventory {
  const runtime = getRendererPluginRuntime();
  const [snapshot, setSnapshot] = useState<OpenBuddyPluginInventory>({ entries: [], piExtensions: [], renderers: [], packages: [], providers: [] });
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const inventory = typeof agentPluginInventory === "function"
          ? await agentPluginInventory()
          : { entries: await agentListPlugins(), piExtensions: [], renderers: [], packages: [], providers: [] } as OpenBuddyPluginInventory;
        if (!cancelled) setSnapshot(inventory);
      } catch {
        /* main may not be ready yet */
      }
    };
    void refresh();
    const offs: Array<() => void> = [
    runtime.events.on("plugin/loaded", refresh),
      runtime.events.on("plugin/unloaded", refresh),
      runtime.events.on("plugin/failed", refresh),
      runtime.events.on("plugin/provider-registry-changed", refresh),
      runtime.events.on("plugin/ready", refresh),
      runtime.events.on("profile/loaded", refresh),
      runtime.events.on("profile/reloaded", refresh),
      runtime.events.on("pi/extensions-reloaded", refresh),
      runtime.events.on("plugin/transaction-complete", refresh),
      runtime.events.on("plugin/transaction-failed", refresh),
      runtime.events.on("profile/failed", refresh),
      runtime.events.on("pi/extensions-resolved", refresh),
      runtime.events.on("pi/extension-failed", refresh),
      runtime.events.on("pi/extension-disabled", refresh),
    ];
    return () => {
      cancelled = true;
      offs.forEach((off) => off());
    };
  }, [refreshKey, runtime]);
  return snapshot;
}

export function usePluginSnapshot(refreshKey = 0): import("@openbuddy/plugin-host").PluginSnapshot | null {
  const [snapshot, setSnapshot] = useState<import("@openbuddy/plugin-host").PluginSnapshot | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await agentPluginSnapshot();
        if (!cancelled) setSnapshot(next);
      } catch {
        /* Main may not be ready yet. */
      }
    };
    void refresh();
    const off = getRendererPluginRuntime().events.on("plugin/snapshot", refresh);
    return () => { cancelled = true; off(); };
  }, [refreshKey]);
  return snapshot;
}

/** React hook for the cross-runtime Pi/Harness plugin readiness phase. */
export function usePluginReadiness(refreshKey = 0): PluginReadinessSnapshot {
  const runtime = getRendererPluginRuntime();
  const [snapshot, setSnapshot] = useState<PluginReadinessSnapshot>(() => ({
    version: 1,
    phase: "idle",
    generation: 0,
    updatedAt: new Date(0).toISOString(),
    main: { loaded: 0, pending: 0, failed: 0, disabled: 0, degraded: 0 },
    pi: { loaded: 0, pending: 0, failed: 0, disabled: 0, degraded: 0 },
  }));
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void agentPluginReadiness().then((value) => {
        if (!cancelled) setSnapshot(value);
      }).catch(() => undefined);
    };
    refresh();
    const offs = [
      runtime.events.on("plugin/readiness", refresh),
      runtime.events.on("plugin/transaction-start", refresh),
      runtime.events.on("plugin/transaction-start", (payload) => {
        const id = (payload as { transactionId?: unknown } | null | undefined)?.transactionId;
        captureRendererReceiptTransaction(typeof id === "string" ? id : null);
      }),
      runtime.events.on("plugin/transaction-complete", refresh),
      runtime.events.on("plugin/transaction-complete", () => {
        pendingRendererTransactionId = null;
      }),
      runtime.events.on("plugin/transaction-failed", refresh),
      runtime.events.on("plugin/transaction-failed", () => {
        pendingRendererTransactionId = null;
      }),
      runtime.events.on("pi/extensions-reloaded", refresh),
    ];
    return () => {
      cancelled = true;
      offs.forEach((off) => off());
    };
  }, [refreshKey, runtime]);
  return snapshot;
}
