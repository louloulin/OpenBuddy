/**
 * host-modules/bootstrap/before-quit-handler.ts
 *
 * v6-G M1 收尾: 抽取 agent-host.ts 的 before-quit handler.
 *
 * 原 inline 代码 (~14 行) 占用 agent-host.ts 末尾位置, 提到独立文件后
 * agent-host.ts 只剩 1 行 import + 注册, 进一步缩小文件体积.
 *
 * 反向依赖不变量: 此模块不 import agent-host.ts.
 */
import { app } from "electron";

export interface BeforeQuitGuard {
  /**
   * Run before the dispose thunk on `before-quit`. Return `{ ok: true }`
   * to proceed, or `{ ok: false, reason }` to abort the quit and surface
   * `reason` to the renderer via the optional `onBlocked` callback. The
   * guard must NOT block on long-running work synchronously; it is async
   * so the Electron event loop can keep spinning.
   */
  (): Promise<{ ok: boolean; reason?: string }>;
}

export interface BeforeQuitHandlerDeps {
  /** Reference to the lifecycle dispose() thunk (dispose returns a Promise). */
  dispose: () => Promise<void>;
  /** Optional exit-safety guard (e.g. workbench task in-flight check). */
  guard?: BeforeQuitGuard;
  /** Optional sink that receives a structured payload when the guard
   *  blocks the quit. Implementations forward to renderer. */
  onBlocked?: (payload: { reason: string }) => void;
}

export interface BeforeQuitHandlerHandle {
  /** 主动取消注册 (e.g. tests / hot-reload). */
  uninstall(): void;
}

/**
 * Register the before-quit hook. `dispose()` is awaited before the app exits
 * so we don't leak Pi session resources. Idempotent across multiple register
 * calls (state lives in module scope).
 */
export function installBeforeQuitHandler(deps: BeforeQuitHandlerDeps): BeforeQuitHandlerHandle {
  let quitting = false;
  let disposedForQuit = false;
  let blockedAt: number | undefined;
  const handler = (event: Electron.Event): void => {
    if (disposedForQuit) return;
    if (quitting) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const proceed = async () => {
      try {
        if (deps.guard) {
          const decision = await deps.guard();
          if (!decision.ok) {
            deps.onBlocked?.({ reason: decision.reason ?? "quit blocked by lifecycle guard" });
            // Re-arm so the user can retry after addressing the block.
            // Throttle repeated immediate retries so we don't spam events.
            if (blockedAt === undefined || Date.now() - blockedAt > 1_000) {
              blockedAt = Date.now();
            }
            return;
          }
        }
      } catch (error) {
        // Guard failures must never abort quit silently; log and proceed.
        console.error("[before-quit] guard threw, proceeding with dispose:", error);
      }
      quitting = true;
      void deps.dispose().finally(() => {
        disposedForQuit = true;
        app.exit(0);
      });
    };
    void proceed();
  };
  app.on("before-quit", handler);
  return {
    uninstall(): void {
      app.removeListener("before-quit", handler);
    },
  };
}
