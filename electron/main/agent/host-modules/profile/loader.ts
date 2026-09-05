/**
 * host-modules/profile/loader.ts — Electron-flavoured HarnessPluginLoader.
 *
 * Stage F-2: 从 agent-host.ts:2079-2097 抽出。`ElectronHarnessPluginLoader`
 * 把 base loader 的 `exit()` 默认实现替换为 Electron 真实重启语义:
 *   `app.relaunch()` + `app.exit(0)`
 *
 * 设计:
 *   - 单 class,无 module-level mutable,无顶层副作用
 *   - 只 import `@openbuddy/plugin-host` 的 `HarnessPluginLoader` + Electron app
 *   - 通过 `export` 让 facade agent-host.ts 在 init() 时直接 `new`
 */

import { app } from "electron";
import { HarnessPluginLoader } from "@openbuddy/plugin-host";

export class ElectronHarnessPluginLoader extends HarnessPluginLoader {
  override exit(): void {
    try {
      app.relaunch();
      app.exit(0);
    } catch (error) {
      console.error("[openbuddy] failed to relaunch electron app:", error);
    }
  }
}