/**
 * @deprecated Phase L.3 — see docs/OPENBUDDY_PI_NATIVE_PLAN.md §11.2.
 *
 * Phase L.3 step 1 reduced this module from 1545 LOC to ~80 LOC. The full
 * removal chain (committed in L.3 step 2):
 *
 *   - `electron/main/deepseek/deepseek-generic.ts`        1545 → 80 → 0 (L.3)
 *   - `electron/main/deepseek/deepseek-compat.ts`         445 → 0 (L.3 step 2)
 *   - `electron/main/deepseek/deepseek-compat.test.ts`    2039 → 0 (L.3 step 2)
 *
 * This shim remains only to satisfy the two external import sites:
 *   - `electron/main/deepseek/deepseek-compat.ts`         uses `resolveDeepSeekGenericModule`
 *   - `electron/main/agent/host-modules/workbench-scope.ts` uses `readGenericService`
 *
 * Both call sites fall through to `undefined` in production — `node_modules/@deepseek-ai/`
 * is empty — so the shim is a no-op for real traffic. L.3 step 2 deletes the file
 * along with `deepseek-compat.ts`.
 */

/**
 * Bag of arbitrary methods exposed under a service key. DSH packages used to
 * register these on the cordis `ctx` under one of `sharedServiceKeys`. With
 * the DSH packaging path retired (K.2 + L.2), the type stays as a transparent
 * marker so legacy imports keep typechecking until L.3 step 2 removes them.
 */
export type DeepSeekGenericService = Record<string, unknown>;

const sharedServiceKeys: readonly RegExp[] = [
  /^@deepseek-ai\/dsh-/u,
  /^@deepseek-ai\/cordis-plugin-/u,
];

const explicitDeepSeekPackages = new Set<string>([
  "@deepseek-ai/dsh-session-query",
]);

function packageBase(specifier: string): string {
  return specifier.replace(/\/(?:client|remote|types|invariant|grammar|brand|protocol|loader|list-agents)$/u, "");
}

/**
 * Recognize a `@deepseek-ai/dsh-*` (or `@deepseek-ai/cordis-plugin-*`) package
 * specifier that would have been routed through this shim under the legacy
 * DSH packaging path. Pure predicate; no side effects.
 */
export function isGenericDeepSeekSpecifier(specifier: string): boolean {
  const base = packageBase(specifier);
  if (explicitDeepSeekPackages.has(base)) return false;
  return sharedServiceKeys.some((pattern) => pattern.test(base));
}

/**
 * Legacy module shim — returns a no-op plugin module for `@deepseek-ai/dsh-*`
 * specifiers so `HarnessPluginLoader.load()` (which still routes through
 * `deepseek-compat.ts → resolveDeepSeekModule`) can satisfy `normalizePlugin`
 * without throwing "plugin does not export apply(ctx, config)". The no-op
 * shape has zero runtime effect — `apply()` registers no cordis services,
 * registers no tools, and the LLM never sees it. L.3 step 2 deletes this
 * function alongside `deepseek-compat.ts`.
 */
export function resolveDeepSeekGenericModule(
  specifier: string,
): Record<string, unknown> | undefined {
  if (!isGenericDeepSeekSpecifier(specifier)) return undefined;
  const packageName = packageBase(specifier);
  const noopDispose = () => undefined;
  const noopPlugin = {
    name: packageName,
    apply: async (_ctx: unknown, _config?: unknown): Promise<() => void> => noopDispose,
  };
  if (specifier.endsWith("/remote")) {
    return { default: noopPlugin, TYPERT_REMOTE: noopPlugin };
  }
  if (specifier.endsWith("/invariant")) {
    return { name: `${packageName}-invariant`, apply: () => undefined };
  }
  return { default: noopPlugin, name: packageName, apply: noopPlugin.apply };
}

// ---------------------------------------------------------------------------
// Generic-service registry (cordis-fiber-survival bag)
// ---------------------------------------------------------------------------
//
// `workbench-scope.ts` keeps a persistent bag of "generic" services so they
// survive cordis fiber dispose/reload cycles — cordis's `ctx.set` registers
// an effect whose cleanup wipes the slot on unload. The bag is always empty
// in production because no DSH packages ever populate it, but the read/write
// surface stays so workbench-scope's lookup logic compiles unchanged. L.3
// step 2 retires workbench-scope's call site alongside this shim.

const genericServiceRegistry = new Map<string, DeepSeekGenericService>();

export function readGenericService(serviceKey: string): DeepSeekGenericService | undefined {
  return genericServiceRegistry.get(serviceKey);
}

export function writeGenericService(serviceKey: string, service: DeepSeekGenericService): void {
  genericServiceRegistry.set(serviceKey, service);
}

/** Test helper: wipe the persistent generic-service registry. */
export function __resetGenericServiceRegistryForTest(): void {
  genericServiceRegistry.clear();
}