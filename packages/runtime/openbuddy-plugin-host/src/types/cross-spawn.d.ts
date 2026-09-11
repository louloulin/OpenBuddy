/**
 * Minimal local type declarations for cross-spawn.
 *
 * `cross-spawn` already has `@types/cross-spawn` upstream, but we avoid
 * adding a new `@types/*` dependency for a single typed helper used in
 * one file. The signatures below match the parts of `cross-spawn@7` that
 * `profile-manager.ts` actually consumes.
 *
 * If this file ever drifts from upstream, delete it and add
 * `@types/cross-spawn` to `devDependencies` instead.
 */
declare module "cross-spawn" {
  import { ChildProcess } from "node:child_process";

  export interface CrossSpawnOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    argv0?: string;
    stdio?: Array<"pipe" | "ignore" | "inherit"> | string;
    detached?: boolean;
    uid?: number;
    gid?: number;
    shell?: boolean | string;
    windowsVerbatimArguments?: boolean;
    windowsHide?: boolean;
    maxBuffer?: number;
    killSignal?: string | number;
  }

  /**
   * Spawn `command` with `args`. Resolves to a Node `ChildProcess`.
   *
   * On Windows the library transparently resolves `.cmd` / `.bat` shims
   * (the part the host plugin host relies on, see the comment above
   * `spawnAsync` in `profile-manager.ts`).
   */
  function crossSpawn(
    command: string,
    args?: ReadonlyArray<string>,
    options?: CrossSpawnOptions,
  ): ChildProcess;

  export default crossSpawn;
}
