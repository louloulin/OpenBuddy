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

export interface BeforeQuitHandlerDeps {
  /** Reference to the lifecycle dispose() thunk (dispose returns a Promise). */
  dispose: () => Promise<void>;
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
  const handler = (event: Electron.Event): void => {
    if (disposedForQuit) return;
    if (quitting) {
      event.preventDefault();
      return;
    }
    quitting = true;
    event.preventDefault();
    void deps.dispose().finally(() => {
      disposedForQuit = true;
      app.exit(0);
    });
  };
  app.on("before-quit", handler);
  return {
    uninstall(): void {
      app.removeListener("before-quit", handler);
    },
  };
}
