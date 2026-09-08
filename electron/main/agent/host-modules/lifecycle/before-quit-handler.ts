/**
 * host-modules/lifecycle/before-quit-handler.ts
 *
 * Phase 8.3 §55: 提取 agent-host.ts 的 `app.on("before-quit", ...)` 处理器到
 * 独立模块. 原代码在 agent-host.ts 末尾 ~16 行 inline.
 *
 * 设计:
 *   - install pattern: 调用方传 dispose 回调, 模块只负责 Electron 事件绑定
 *   - 模块级 singleton 状态 (quitting / disposedForQuit) 避免重入
 *   - agent-host.ts 通过 `installBeforeQuitHandler({ dispose })` 注入
 *   - 重入保护: 第一次 before-quit 设 quitting 标志 + 异步 dispose, 完成后
 *     app.exit(0); 后续 before-quit 直接 preventDefault() 等待 dispose 完成
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - dispose 是注入的, 不在模块内 hardcode
 *
 * 后续 PR 可考虑: 把 onBeforeQuit 集成进 bootstrap/app-lifecycle.ts 的
 * installAppLifecycle({ onBeforeQuit }), 这样整个 Electron 生命周期都在
 * 一个 install point 管理. 当前单独成模块是因为 dispose 逻辑属于 agent-host.
 */
import { app } from "electron";

let installed = false;
let disposeImpl: () => Promise<void> = async () => undefined;
let quitting = false;
let disposedForQuit = false;

export function installBeforeQuitHandler(deps: { dispose: () => Promise<void> }): void {
  if (installed) return;
  installed = true;
  if (deps.dispose) disposeImpl = deps.dispose;
  app.on("before-quit", (event) => {
    if (disposedForQuit) return;
    if (quitting) {
      event.preventDefault();
      return;
    }
    quitting = true;
    event.preventDefault();
    void disposeImpl().finally(() => {
      disposedForQuit = true;
      app.exit(0);
    });
  });
}

/** 测试 / 调试 helper: 还原模块级 singleton 状态. */
export function __resetBeforeQuitHandlerForTest(): void {
  installed = false;
  disposeImpl = async () => undefined;
  quitting = false;
  disposedForQuit = false;
}
