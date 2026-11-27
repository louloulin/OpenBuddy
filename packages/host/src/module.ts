import type { createSettings } from "@openbuddy/services/settings/settings";
import type { PiEngine } from "@openbuddy/engine/pi-engine";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { Emit, HostShell, SafeStorage } from "@openbuddy/kernel";
export interface EngineOptions {
  userDataDir: string;
  emit: Emit;
  safeStorage: SafeStorage;
  /** Host shell port; its optional `trash` is handed to the engine (desktop: Electron `shell.trashItem`). */
  shell: HostShell;
  /**
   * Network port for host-originated HTTP (desktop: Electron `net.fetch`, which follows the
   * system proxy). Defaults to the runtime's global fetch (tests / gateway). The Pi package
   * market uses this so a proxied desktop can reach npm (S15).
   */
  fetchImpl?: typeof fetch;
  /** Trusted host-provided extensions; never accepted in renderer IPC. */
  extensionFactories?: ExtensionFactory[];
  /** App version for the update check (desktop: `app.getVersion()`). */
  appVersion?: string;
  /** Release manifest URL; when unset the renderer reports 未配置更新源 instead of guessing. */
  updateFeed?: string;
  /**
   * The embedding app, for `host_capabilities`: its kind and the commands/events it serves
   * itself (desktop: native dialogs, windows, clipboard, export; window/focus events).
   */
  platform?: { kind: string; commands?: readonly string[]; events?: readonly string[] };
  /**
   * 自动化 (W4): how often the scheduler checks due tasks (ms). 0 disables the timer — tests and
   * headless runs drive `automation_tick` instead.
   */
  automationTickMs?: number;
}
export type Handler = (
  payload: Record<string, unknown>,
) => unknown | Promise<unknown>;
type Settings = ReturnType<typeof createSettings>;
/**
 * What every command handler closes over (20261115-md R4). Built once by
 * `createEngineHandlers` after the engine has initialized; modules only read it.
 */
export interface HostContext {
  options: EngineOptions;
  settings: Settings;
  /** Redacting event sink handed to the engine. */
  emit: Emit;
  engine: PiEngine;
  /** Read-modify-write of the persisted config. */
  update: (fn: (c: ReturnType<Settings["config"]["read"]>) => void) => void;
  /** Names of the commands the assembled host serves (read lazily, after assembly). */
  servedCommands: () => readonly string[];
}
/** One group of commands from the §5.3 module table. */
export interface HostModule {
  id: string;
  commands: Record<string, Handler>;
}
export type HostModuleFactory = (ctx: HostContext) => HostModule;
