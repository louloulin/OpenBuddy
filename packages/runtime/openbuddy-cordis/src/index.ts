/**
 * @openbuddy/cordis — OpenBuddy's Cordis surface.
 *
 * A thin wrapper over `@cordisjs/core` that adds:
 * - `OpenBuddyService` base class mirroring DeepSeek Harness's `Service` shape,
 *   but with `static provide` default-name sugar so a subclass that omits the
 *   second `super()` argument still claims its own lowercase class name.
 * - `Branded` opaque-id helper for cross-boundary IDs (session, agent, etc).
 * - `Debug` tagged template that defers to `ctx.logger` if the service
 *   implements it; falls back to `console.debug`.
 *
 * Vendoring policy: this package does NOT re-export Cordis internals. It is
 * the only place OpenBuddy code imports `@cordisjs/core`, so swapping the
 * runtime later (e.g. for a vendored copy) is a single-package change.
 */
import { Context, Service as CordisService } from '@cordisjs/core'

export type Branded<B> = string & { readonly __brand: B }

/** Wrap a string into a branded id at the trust boundary. */
export function brand<B extends string>(value: string): Branded<B> {
  return value as Branded<B>
}

/**
 * Subclass entry point: declares the service name `ctx.<provide>`.
 *
 * Behavior matches `@cordisjs/core` Service. The `static provide` default
 * exists so a class named `class Foo` lands at `ctx.foo` without an
 * explicit second `super()` argument — same convention DeepSeek Harness uses.
 */
export class OpenBuddyService<T = unknown> extends CordisService<T> {
  static override provide: any = CordisService.provide

  constructor(ctx: Context, name?: string) {
    super(ctx, name ?? "openbuddy" as never)
  }
}

/** Object-shape plugin: `{ apply(ctx) }` with optional `inject` / `Config`. */
export interface Plugin {
  name?: string
  inject?: readonly string[]
  Config?: unknown
  apply(ctx: Context): void | Promise<void>
}

/** Create a tagged debug logger, optionally routed through `ctx.logger`. */
export function debug(ctx: Context, tag: string): (msg: string) => void {
  const target = (ctx as unknown as { logger?: { debug?: (t: string, m: string) => void } })
    .logger
  if (target?.debug) return (msg) => target.debug!(tag, msg)
  return (msg) => console.debug(`[${tag}]`, msg)
}

/** Reverse `pkg/services` namespace — runs an effect only for matched services. */
export function forEach<T>(
  ctx: Context,
  pick: (key: string) => boolean,
  handler: (svc: T, key: string) => void | (() => void),
): () => void {
  const disposers: Array<() => void> = []
  for (const key of Object.keys((ctx as unknown as { [k: string]: unknown }))) {
    if (!pick(key)) continue
    const out = handler((ctx as unknown as Record<string, T>)[key]!, key)
    if (typeof out === 'function') disposers.push(out)
  }
  return () => {
    for (const d of disposers) try { d() } catch { /* ignore */ }
  }
}

export { Context }
// Re-export the remaining public surface from `@cordisjs/core`.
export * from '@cordisjs/core'

declare module '@cordisjs/core' {
  interface Events<C> {
    [event: string]: (...args: any[]) => any
    'pi/ready': (payload: { sessionId: string; cwd: string }) => void
    'pi/dispose': (payload: { sessionId: string }) => void
  }
}
