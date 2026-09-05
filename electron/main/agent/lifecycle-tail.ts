/**
 * Per-kind lifecycle serial queues used by the Pi agent host. The host used to
 * funnel every lifecycle operation (init, dispose, preset, profile reload, Pi
 * extensions reload, plugin compat) through a single Promise chain. A single
 * stuck op therefore held every IPC handler hostage — including marketplace
 * scans and profile switches — which manifested as the "all IPC stuck" symptom
 * observed in `TTFC` and chat-resilience probes.
 *
 * `enqueueLifecycleByKind` keeps the same per-kind serialisation invariant the
 * old chain provided (no two ops of the same kind run concurrently), while
 * letting different kinds run in parallel. Every op also races against a
 * timeout so a zombie op cannot block the next op on the same kind forever:
 * when the timeout wins the runner rejects with `LifecycleTimeout`, the tail
 * is reseeded, and the queue stays usable.
 */

export type LifecycleKind = "init" | "dispose" | "preset" | "profile" | "reload";

export const LIFECYCLE_TIMEOUT_MS = 30_000;
export const LIFECYCLE_INIT_TIMEOUT_MS = 5 * 60 * 1000;
export const LIFECYCLE_LEGACY_TIMEOUT_MS = 5_000;

export class LifecycleTimeout extends Error {
  readonly kind: LifecycleKind;
  readonly opName: string;
  readonly timeoutMs: number;
  constructor(kind: LifecycleKind, opName: string, timeoutMs: number) {
    super(`lifecycle timeout: ${kind}/${opName} did not settle within ${timeoutMs}ms`);
    this.name = "LifecycleTimeout";
    this.kind = kind;
    this.opName = opName;
    this.timeoutMs = timeoutMs;
  }
}

function defaultTimeoutForKind(kind: LifecycleKind): number {
  return kind === "init" ? LIFECYCLE_INIT_TIMEOUT_MS : LIFECYCLE_TIMEOUT_MS;
}

const lifecycleTails: Record<LifecycleKind, Promise<void>> = {
  init: Promise.resolve(),
  dispose: Promise.resolve(),
  preset: Promise.resolve(),
  profile: Promise.resolve(),
  reload: Promise.resolve(),
};

export function enqueueLifecycleByKind<T>(
  kind: LifecycleKind,
  operation: () => Promise<T>,
  timeoutMs: number = defaultTimeoutForKind(kind),
): Promise<T> {
  const opName = operation.name || "<anonymous>";
  const previous = lifecycleTails[kind];
  const timeoutPromise = new Promise<never>((_, reject) => {
    const handle = setTimeout(() => reject(new LifecycleTimeout(kind, opName, timeoutMs)), timeoutMs);
    if (typeof handle.unref === "function") handle.unref();
  });
  const run = previous.then(
    () => Promise.race([operation(), timeoutPromise]),
    () => Promise.race([operation(), timeoutPromise]),
  );
  lifecycleTails[kind] = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * @deprecated prefer `enqueueLifecycleByKind`. Retained so external callers
 * (e.g. legacy plugins) can still enqueue without choosing a kind; such
 * callers get routed to the `reload` queue with the 5s plugin-compat timeout.
 */
export function enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  return enqueueLifecycleByKind("reload", operation, LIFECYCLE_LEGACY_TIMEOUT_MS);
}

/** Test-only: wait for every kind's tail to settle. */
export async function flushLifecycleTails(): Promise<void> {
  await Promise.all(Object.values(lifecycleTails));
}

/** Test-only: reset every kind's tail to a settled promise. */
export function resetLifecycleTailsForTests(): void {
  (Object.keys(lifecycleTails) as LifecycleKind[]).forEach((kind) => {
    lifecycleTails[kind] = Promise.resolve();
  });
}
